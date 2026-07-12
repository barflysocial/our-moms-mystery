const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const compression = require('compression');
const QRCode = require('qrcode');
const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_SECRET = process.env.APP_SECRET || 'development-only-change-me';
const HOST_PIN = String(process.env.HOST_PIN || '2006');
const GAME = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'cases.json'), 'utf8'));
const CASE_IDS = new Set(GAME.caseOrder);
const CASE_LENGTHS = new Set(Object.keys(GAME.profiles));
const PLAY_MODES = new Set(['individual', 'team']);
const VERSION_MODES = new Set(['rotating', 'random', 'fixed']);

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json({ limit: '300kb' }));
app.use(express.static(path.join(__dirname, 'public')));

if (process.env.NODE_ENV === 'production' && APP_SECRET === 'development-only-change-me') {
  console.warn('WARNING: Set APP_SECRET before public deployment.');
}

function nowIso() { return new Date().toISOString(); }
function normalizeMobile(value) { return String(value || '').replace(/\D/g, '').slice(-10); }
function normalizeSessionCode(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); }
function secureEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sign(payload, hours = 24 * 30) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + hours * 3600_000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', APP_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verify(token, type) {
  try {
    const [body, signature] = String(token || '').split('.');
    if (!body || !signature) return null;
    const expected = crypto.createHmac('sha256', APP_SECRET).update(body).digest('base64url');
    if (!secureEqual(signature, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.type !== type || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function authPlayer(req, res, next) {
  const payload = verify((req.headers.authorization || '').replace(/^Bearer\s+/i, ''), 'player');
  if (!payload) return res.status(401).json({ error: 'Session expired. Resume your case with your mobile number and PIN.' });
  req.auth = payload;
  return next();
}

function authHost(req, res, next) {
  const payload = verify((req.headers.authorization || '').replace(/^Bearer\s+/i, ''), 'host');
  if (!payload) return res.status(401).json({ error: 'Host login required.' });
  req.auth = payload;
  return next();
}

const loginAttempts = new Map();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
function attemptKey(req, type, identity) { return `${type}:${req.ip}:${String(identity || '').toLowerCase()}`; }
function checkAttemptLimit(key, res) {
  const entry = loginAttempts.get(key);
  if (!entry) return true;
  const now = Date.now();
  if (entry.lockedUntil > now) {
    const seconds = Math.ceil((entry.lockedUntil - now) / 1000);
    res.set('Retry-After', String(seconds));
    res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(seconds / 60)} minute(s).` });
    return false;
  }
  if (now - entry.firstAttempt > ATTEMPT_WINDOW_MS) loginAttempts.delete(key);
  return true;
}
function recordFailedAttempt(key) {
  const now = Date.now();
  const old = loginAttempts.get(key);
  const entry = !old || now - old.firstAttempt > ATTEMPT_WINDOW_MS
    ? { count: 0, firstAttempt: now, lockedUntil: 0 } : old;
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) entry.lockedUntil = now + LOCK_MS;
  loginAttempts.set(key, entry);
}
function clearAttempts(key) { loginAttempts.delete(key); }
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of loginAttempts.entries()) {
    if (Math.max(entry.lockedUntil || 0, entry.firstAttempt + ATTEMPT_WINDOW_MS) < now) loginAttempts.delete(key);
  }
}, 10 * 60 * 1000).unref();

function caseFor(player) {
  return GAME.cases[CASE_IDS.has(player.case_version) ? player.case_version : 'A'];
}
function profileFor(playerOrLength) {
  const key = typeof playerOrLength === 'string' ? playerOrLength : playerOrLength.case_length;
  return GAME.profiles[key] || GAME.profiles.standard;
}
function chapterIndex(id) { return GAME.chapters.findIndex((chapter) => chapter.id === id); }
function createTimer(chapter) { return { chapter, activeSeconds: 0, lastActiveAt: nowIso() }; }

function initialProgress(caseLength) {
  return {
    serverVersion: 3,
    chapter: 'C00',
    briefingsViewed: [],
    chaptersCompleted: [],
    evidenceUnlocked: ['E01', 'E02'],
    evidenceViewed: [],
    suspectsOpened: [],
    questionsAsked: [],
    followupsAsked: [],
    leadsCompleted: [],
    deductionsSolved: [],
    deductionAttempts: {},
    hintsUsed: [],
    discoveries: [],
    notes: [],
    theory: { suspectId: '', motiveId: '', weaponId: '', clueId: '' },
    paused: false,
    timer: createTimer('C00'),
    updatedAt: nowIso(),
  };
}

function unique(values) { return [...new Set(Array.isArray(values) ? values : [])]; }
function normalizeProgress(player) {
  const fresh = initialProgress(player.case_length);
  const raw = player.progress;
  if (!raw || raw.serverVersion !== 3) return fresh;
  const caseData = caseFor(player);
  const evidenceIds = new Set(caseData.evidence.map((item) => item.id));
  const briefingIds = new Set(caseData.briefings.map((item) => item.id));
  const suspectIds = new Set(caseData.suspects.map((item) => item.id));
  const leadIds = new Set(caseData.leads.map((item) => item.id));
  const deductionIds = new Set(caseData.deductions.map((item) => item.id));
  const hintIds = new Set(caseData.hints.map((item) => item.id));
  const p = { ...fresh, ...raw, serverVersion: 3 };
  p.chapter = GAME.chapters.some((c) => c.id === p.chapter) ? p.chapter : 'C00';
  p.chaptersCompleted = unique(p.chaptersCompleted).filter((id) => GAME.chapters.some((c) => c.id === id));
  p.briefingsViewed = unique(p.briefingsViewed).filter((id) => briefingIds.has(id));
  p.evidenceUnlocked = unique(p.evidenceUnlocked).filter((id) => evidenceIds.has(id));
  p.evidenceViewed = unique(p.evidenceViewed).filter((id) => evidenceIds.has(id));
  p.suspectsOpened = unique(p.suspectsOpened).filter((id) => suspectIds.has(id));
  p.questionsAsked = unique(p.questionsAsked).slice(0, 100);
  p.followupsAsked = unique(p.followupsAsked).slice(0, 50);
  p.leadsCompleted = unique(p.leadsCompleted).filter((id) => leadIds.has(id));
  p.deductionsSolved = unique(p.deductionsSolved).filter((id) => deductionIds.has(id));
  p.deductionAttempts = p.deductionAttempts && typeof p.deductionAttempts === 'object' ? p.deductionAttempts : {};
  p.hintsUsed = unique(p.hintsUsed).filter((key) => {
    const [id, level] = String(key).split(':');
    return hintIds.has(id) && [1,2,3].includes(Number(level));
  });
  p.discoveries = (Array.isArray(p.discoveries) ? p.discoveries : []).filter((d) => d?.text).slice(0, 100);
  p.notes = (Array.isArray(p.notes) ? p.notes : []).filter((n) => n?.text).slice(0, 100)
    .map((n) => ({ id: String(n.id), text: String(n.text).slice(0,500), createdAt: n.createdAt || nowIso() }));
  p.theory = p.theory && typeof p.theory === 'object' ? p.theory : fresh.theory;
  p.paused = Boolean(p.paused);
  p.timer = p.timer?.chapter === p.chapter ? {
    chapter: p.chapter,
    activeSeconds: Math.max(0, Number(p.timer.activeSeconds) || 0),
    lastActiveAt: p.timer.lastActiveAt || nowIso(),
  } : createTimer(p.chapter);
  return p;
}

function tickTimer(progress) {
  const now = Date.now();
  const previous = Date.parse(progress.timer?.lastActiveAt || nowIso());
  if (!progress.paused && Number.isFinite(previous)) {
    progress.timer.activeSeconds += Math.min(300, Math.max(0, (now - previous) / 1000));
  }
  progress.timer.lastActiveAt = new Date(now).toISOString();
}

function minimumSeconds(player, chapterId) {
  if (process.env.TEST_BYPASS_TIMERS === '1') return 0;
  const chapter = GAME.chapters.find((item) => item.id === chapterId);
  return Math.ceil(Number(chapter?.minSeconds || 0) * Number(profileFor(player).timeScale || 1));
}
function timerRemaining(player, progress) {
  return Math.max(0, Math.ceil(minimumSeconds(player, progress.chapter) - Number(progress.timer?.activeSeconds || 0)));
}

function addDiscovery(progress, text, source) {
  if (!text) return;
  if (progress.discoveries.some((item) => item.source === source || item.text === text)) return;
  progress.discoveries.unshift({ id: crypto.randomUUID(), text, source, createdAt: nowIso() });
}

function computeUnlocked(player, progress) {
  const caseData = caseFor(player);
  const profile = profileFor(player);
  const allowed = new Set(profile.evidenceIds);
  const unlocked = new Set(['E01','E02']);
  const current = chapterIndex(progress.chapter);
  for (const evidence of caseData.evidence) {
    if (!allowed.has(evidence.id)) continue;
    const rule = evidence.unlock || {};
    if (rule.type === 'auto') unlocked.add(evidence.id);
    if (rule.type === 'chapter' && chapterIndex(rule.chapter) <= current) unlocked.add(evidence.id);
    if (rule.type === 'evidence' && (rule.requires || []).every((id) => progress.evidenceViewed.includes(id))) unlocked.add(evidence.id);
    if (rule.type === 'lead' && progress.leadsCompleted.includes(rule.lead)) unlocked.add(evidence.id);
  }
  progress.evidenceUnlocked = [...unlocked];
  progress.evidenceViewed = progress.evidenceViewed.filter((id) => unlocked.has(id));
}

function chapterTasks(player, progress, accusation = null) {
  const profile = profileFor(player);
  const caseData = caseFor(player);
  const killerFollowup = `${caseData.solution.killerId}:F1`;
  const briefing = briefingForChapter(caseData, progress.chapter);
  const briefingTask = { text: `Review ${briefing?.title || 'the detective briefing'}`, done: Boolean(briefing && progress.briefingsViewed.includes(briefing.id)) };
  switch (progress.chapter) {
    case 'C00': return [
      briefingTask,
      { text: 'Open the case introduction', done: progress.evidenceViewed.includes('E01') },
      { text: 'Review the guest directory', done: progress.evidenceViewed.includes('E02') },
    ];
    case 'C01': return [
      briefingTask,
      { text: 'Review the official reunion photograph', done: progress.evidenceViewed.includes('E03') },
      { text: "Read Blake's final remarks", done: progress.evidenceViewed.includes('E04') },
      { text: `Review ${profile.requiredSuspects} suspect profiles`, done: progress.suspectsOpened.length >= profile.requiredSuspects },
    ];
    case 'C02': return [
      briefingTask,
      { text: 'Review the crime scene, warning note, and phone draft', done: ['E05','E06','E07'].every((id) => progress.evidenceViewed.includes(id)) },
      { text: `Ask ${profile.requiredQuestions} interview questions`, done: progress.questionsAsked.length >= profile.requiredQuestions },
    ];
    case 'C03': return [
      briefingTask,
      { text: `Complete ${profile.requiredLeads} lead path${profile.requiredLeads === 1 ? '' : 's'}`, done: progress.leadsCompleted.length >= profile.requiredLeads },
      { text: "Review Blake's leverage list", done: progress.evidenceViewed.includes('E09') },
    ];
    case 'C04': {
      const requiredEvidence = player.case_length === 'extended' ? ['E10','E11','E12','E13','E14','E15'] : ['E10','E11','E12','E13','E14'];
      return [
        briefingTask,
        { text: 'Review the final documentary and physical evidence', done: requiredEvidence.every((id) => progress.evidenceViewed.includes(id)) },
        { text: 'Ask the evidence-gated alibi follow-up', done: progress.followupsAsked.includes(killerFollowup) },
        { text: `Solve ${profile.requiredDeductions} guided deduction${profile.requiredDeductions === 1 ? '' : 's'}`, done: progress.deductionsSolved.length >= profile.requiredDeductions },
      ];
    }
    case 'C05': return [briefingTask, { text: 'Lock your final accusation', done: Boolean(accusation) }];
    default: return [];
  }
}

function canAdvance(player, progress) {
  return progress.chapter !== 'C05'
    && chapterTasks(player, progress).every((task) => task.done)
    && timerRemaining(player, progress) === 0;
}

function advanceIfReady(player, progress, events) {
  if (!canAdvance(player, progress)) return;
  const old = progress.chapter;
  if (!progress.chaptersCompleted.includes(old)) progress.chaptersCompleted.push(old);
  const next = GAME.chapters[chapterIndex(old) + 1];
  if (next) {
    progress.chapter = next.id;
    progress.timer = createTimer(next.id);
    computeUnlocked(player, progress);
    events.push({ type: 'chapter', message: `${next.title} unlocked. Detective briefing available.` });
  }
}

function prepareProgress(player) {
  const p = normalizeProgress(player);
  tickTimer(p);
  computeUnlocked(player, p);
  const events = [];
  advanceIfReady(player, p, events);
  p.updatedAt = nowIso();
  return { progress: p, events };
}

function findSuspect(caseData, id) { return caseData.suspects.find((item) => item.id === id); }
function findBriefing(caseData, id) { return caseData.briefings.find((item) => item.id === id); }
function briefingForChapter(caseData, chapterId) { return caseData.briefings.find((item) => item.chapter === chapterId); }
function findEvidence(caseData, id) { return caseData.evidence.find((item) => item.id === id); }
function findDeduction(caseData, id) { return caseData.deductions.find((item) => item.id === id); }

function nextObjective(player, progress) {
  const caseData = caseFor(player);
  const profile = profileFor(player);
  if (progress.paused) return { type:'resume', label:'Resume Case', description:'Your progress is saved. Review unlocked files or resume when your table is ready.' };
  const remaining = timerRemaining(player, progress);
  const objective = (type, id, label, description, hintId) => ({ type,id,label,description,hintId });
  const briefing = briefingForChapter(caseData, progress.chapter);
  if (briefing && !progress.briefingsViewed.includes(briefing.id)) {
    return objective('briefing', briefing.id, briefing.title, briefing.objective, `H_${progress.chapter}`);
  }
  if (progress.chapter === 'C00') {
    if (!progress.evidenceViewed.includes('E01')) return objective('evidence','E01','Open the Case Introduction','Learn what happened before the reunion became a crime scene.','H_C00');
    if (!progress.evidenceViewed.includes('E02')) return objective('evidence','E02','Review the Guest Directory','Meet all twelve possible suspects.','H_C00');
  }
  if (progress.chapter === 'C01') {
    if (!progress.evidenceViewed.includes('E03')) return objective('evidence','E03','Examine the Reunion Photograph','Establish what the room and suspects looked like before the murder.','H_C01');
    if (!progress.evidenceViewed.includes('E04')) return objective('evidence','E04',"Read Blake's Final Remarks",'Identify the secret Blake planned to reveal.','H_C01');
    if (progress.suspectsOpened.length < profile.requiredSuspects) return objective('casefiles','suspects','Review Suspect Profiles',`${profile.requiredSuspects - progress.suspectsOpened.length} more profile(s) needed.`, 'H_C01');
  }
  if (progress.chapter === 'C02') {
    for (const id of ['E05','E06','E07']) if (!progress.evidenceViewed.includes(id)) {
      const item = findEvidence(caseData,id); return objective('evidence',id,`Review ${item.title}`,item.teaser,'H_C02');
    }
    if (progress.questionsAsked.length < profile.requiredQuestions) return objective('casefiles','suspects','Interview the Class',`${profile.requiredQuestions - progress.questionsAsked.length} more question(s) needed.`, 'H_C02');
  }
  if (progress.chapter === 'C03') {
    if (progress.leadsCompleted.length < profile.requiredLeads) return objective('leads','leads','Choose an Investigation Lead',`${profile.requiredLeads - progress.leadsCompleted.length} more lead path(s) needed.`, 'H_C03');
    if (!progress.evidenceViewed.includes('E09')) return objective('evidence','E09',"Review Blake's Leverage List",'Compare the wording beside each suspect with Blake’s threat.','H_C03');
  }
  if (progress.chapter === 'C04') {
    for (const id of ['E10','E11','E12','E13','E14']) if (!progress.evidenceViewed.includes(id) && progress.evidenceUnlocked.includes(id)) {
      const item = findEvidence(caseData,id); return objective('evidence',id,`Review ${item.title}`,item.teaser,'H_C04');
    }
    const killer = caseData.solution.killerId;
    if (!progress.followupsAsked.includes(`${killer}:F1`)) {
      const suspect = findSuspect(caseData,killer);
      return objective('suspect',killer,`Question ${suspect.name}`,'A new follow-up challenges a measurable part of this suspect’s alibi.','H_C04');
    }
    const available = caseData.deductions.find((d) => d.requires.every((id) => progress.evidenceViewed.includes(id)) && !progress.deductionsSolved.includes(d.id));
    if (available && progress.deductionsSolved.length < profile.requiredDeductions) return objective('deduction',available.id,available.title,available.question,`H_${available.id}`);
    if (player.case_length === 'extended' && !progress.evidenceViewed.includes('E15') && progress.evidenceUnlocked.includes('E15')) {
      return objective('evidence','E15',`Review ${findEvidence(caseData,'E15').title}`,'Confirm the timeline with an independent record.','H_C04');
    }
  }
  if (progress.chapter === 'C05') return objective('accuse','final','Build Your Final Theory','Answer one question at a time, review the theory, then lock it.','H_C04');
  if (remaining > 0) return objective('wait','timer','Review Your Case Files',`The next chapter will open in about ${remaining} second(s) of active play.`, `H_${progress.chapter}`);
  return objective('home','home','Continue Investigation','Review the chapter checklist and available case files.',`H_${progress.chapter}`);
}

function currentHint(caseData, progress, objective) {
  if (objective.type === 'briefing') return null;
  const hintId = objective.hintId || `H_${progress.chapter}`;
  const hint = caseData.hints.find((item) => item.id === hintId) || caseData.hints.find((item) => item.chapter === progress.chapter);
  if (!hint) return null;
  const revealed = hint.levels.map((text,index) => ({ level:index+1,text,used:progress.hintsUsed.includes(`${hint.id}:${index+1}`) })).filter((item) => item.used);
  const nextLevel = [1,2,3].find((level) => !progress.hintsUsed.includes(`${hint.id}:${level}`)) || null;
  return { id: hint.id, title: hint.title, revealed, nextLevel };
}

function publicEvidence(caseData, progress) {
  return caseData.evidence.filter((item) => progress.evidenceUnlocked.includes(item.id)).map((item) => {
    const viewed = progress.evidenceViewed.includes(item.id);
    return {
      id:item.id,title:item.title,type:item.type,chapter:item.chapter,teaser:item.teaser,viewed,
      ...(viewed ? { facts:item.facts, why:item.why, nextLabel:item.nextLabel } : {}),
    };
  });
}

function publicSuspects(caseData, progress) {
  const interviewsOpen = chapterIndex(progress.chapter) >= chapterIndex('C02');
  return caseData.suspects.map((suspect) => ({
    id:suspect.id,name:suspect.name,role:suspect.role,initials:suspect.initials,publicMotive:suspect.publicMotive,
    opened:progress.suspectsOpened.includes(suspect.id),
    questions: interviewsOpen ? suspect.questions.map((q) => {
      const key = `${suspect.id}:${q.id}`; const asked = progress.questionsAsked.includes(key);
      return { id:q.id,text:q.text,asked,...(asked ? { answer:q.answer } : {}) };
    }) : [],
    followups: interviewsOpen ? suspect.followups.filter((q) => q.requires.every((id) => progress.evidenceViewed.includes(id)) || progress.followupsAsked.includes(`${suspect.id}:${q.id}`)).map((q) => {
      const asked = progress.followupsAsked.includes(`${suspect.id}:${q.id}`);
      return { id:q.id,text:q.text,asked,recommended:Boolean(q.recommended),...(asked ? { answer:q.answer } : {}) };
    }) : [],
  }));
}

function publicDeductions(caseData, progress) {
  return caseData.deductions.filter((d) => d.requires.every((id) => progress.evidenceViewed.includes(id))).map((d) => ({
    id:d.id,title:d.title,question:d.question,options:d.options,solved:progress.deductionsSolved.includes(d.id),attempts:Number(progress.deductionAttempts[d.id] || 0),
  }));
}

function detectiveIdentity(player) {
  const isTeam = player.play_mode === 'team' && Boolean(player.team_name);
  const soloName = /^detective\b/i.test(player.name) ? player.name : `Detective ${player.name}`;
  const teamSpeaker = /detective team$/i.test(player.team_name || '') ? player.team_name : `${player.team_name} Detective Team`;
  return {
    isTeam,
    speaker:isTeam ? teamSpeaker : soloName,
    address:isTeam ? `Detectives of ${player.team_name}` : soloName,
  };
}

function personalizeBriefing(item, player) {
  const identity = detectiveIdentity(player);
  const paragraphs = item.paragraphs.map((text) => String(text));
  if (paragraphs.length) paragraphs[0] = `${identity.address}, your next briefing follows. ${paragraphs[0]}`;
  return {
    ...item,
    kicker:item.kicker.replace(/^Detective briefing/i, identity.isTeam ? 'Detective team briefing' : 'Detective briefing'),
    speaker:identity.speaker,
    paragraphs,
    narrationText:paragraphs.join(' '),
  };
}

function publicBriefings(caseData, progress, player) {
  const current = chapterIndex(progress.chapter);
  return caseData.briefings
    .filter((item) => chapterIndex(item.chapter) <= current && (item.chapter === progress.chapter || progress.briefingsViewed.includes(item.id)))
    .map((item) => ({ ...personalizeBriefing(item,player), viewed:progress.briefingsViewed.includes(item.id) }));
}

function publicGame(player, progress, accusation = null) {
  const caseData = caseFor(player);
  const objective = nextObjective(player, progress);
  const tasks = chapterTasks(player, progress, accusation);
  return {
    app: GAME.app,
    profile: { key:player.case_length, ...profileFor(player) },
    chapters: GAME.chapters.map((chapter) => ({ ...chapter, status: progress.chaptersCompleted.includes(chapter.id) ? 'complete' : chapter.id === progress.chapter ? 'active' : 'locked' })),
    currentChapter: GAME.chapters.find((chapter) => chapter.id === progress.chapter),
    currentObjective: objective,
    currentBriefing: publicBriefings(caseData, progress, player).find((item) => item.chapter === progress.chapter) || null,
    briefings: publicBriefings(caseData, progress, player),
    chapterTasks: tasks,
    minimumSecondsRemaining: timerRemaining(player, progress),
    progressPercent: Math.min(100, Math.round((progress.chaptersCompleted.length / 6) * 100)),
    evidence: publicEvidence(caseData, progress),
    suspects: publicSuspects(caseData, progress),
    leads: chapterIndex(progress.chapter) >= chapterIndex('C03') ? caseData.leads.map((lead) => ({ ...lead, completed:progress.leadsCompleted.includes(lead.id) })) : [],
    deductions: publicDeductions(caseData, progress),
    hint: currentHint(caseData, progress, objective),
    accusationOptions: caseData.accusationOptions,
    spoilerNotice: 'Your table may have a different solution from nearby tables. Keep the final reveal private.',
  };
}

function safePlayer(player, progress) {
  return {
    id:player.id,name:player.name,displayName:player.team_name || player.name,playMode:player.play_mode,teamName:player.team_name,
    caseLength:player.case_length,sessionId:player.session_id,checkedInAt:player.checked_in_at,
    progress:{
      chapter:progress.chapter,chaptersCompleted:progress.chaptersCompleted,briefingsViewed:progress.briefingsViewed,evidenceViewed:progress.evidenceViewed,
      suspectsOpened:progress.suspectsOpened,questionsAsked:progress.questionsAsked,followupsAsked:progress.followupsAsked,
      leadsCompleted:progress.leadsCompleted,deductionsSolved:progress.deductionsSolved,hintsUsed:progress.hintsUsed,
      discoveries:progress.discoveries,notes:progress.notes,theory:progress.theory,paused:progress.paused,updatedAt:progress.updatedAt,
    },
  };
}

function rankFor(score) {
  if (score >= 95) return 'Master Detective';
  if (score >= 80) return 'Lead Investigator';
  if (score >= 60) return 'Case Solver';
  if (score >= 40) return 'Curious Sleuth';
  return 'Reunion Rookie';
}

function scoreAccusation(caseData, answers, hintsUsed) {
  let score = 0;
  if (answers.q1 === caseData.solution.killerId) score += 40;
  if (answers.q2 === caseData.solution.motiveId) score += 20;
  if (answers.q3 === caseData.solution.weaponId) score += 15;
  if (answers.q4 === caseData.solution.clueId) score += 15;
  const text = String(answers.q5 || '').toLowerCase();
  if (caseData.solution.keywords.filter((word) => text.includes(word.toLowerCase())).length >= 3) score += 10;
  return Math.max(0, score - hintsUsed.length * 2);
}

function decorateAccusation(accusation, caseData, player) {
  if (!accusation) return null;
  const identity = detectiveIdentity(player);
  return {
    score:Number(accusation.score),rank:accusation.rank_name,answers:accusation.answers,submittedAt:accusation.submitted_at,
    solution:{
      killer:caseData.solution.killerName,
      motive:caseData.solution.motive,
      weapon:caseData.solution.weapon,
      keyClue:caseData.solution.clue,
      investigatorLabel:identity.speaker,
      reconstruction:`${identity.address}, your reconstruction is complete. ${caseData.solution.detectiveReconstruction}`,
      sequence:caseData.solution.sequence,
      confession:caseData.solution.confession,
    },
  };
}

async function assignCaseVersion(session, mobile) {
  if (session.version_mode === 'fixed' && CASE_IDS.has(session.fixed_version)) return session.fixed_version;
  const played = new Set(await db.playerVersionsByMobile(mobile));
  let candidates = GAME.caseOrder.filter((id) => !played.has(id));
  if (!candidates.length) candidates = [...GAME.caseOrder];
  if (session.version_mode === 'random') return candidates[crypto.randomInt(candidates.length)];
  const counts = await db.versionCounts(session.id);
  const minimum = Math.min(...candidates.map((id) => Number(counts[id] || 0)));
  return candidates.find((id) => Number(counts[id] || 0) === minimum) || candidates[0];
}

function validateRegistration(body) {
  const sessionCode = normalizeSessionCode(body.sessionCode || 'OURMOMS');
  const name = String(body.name || '').trim().slice(0,50);
  const mobile = normalizeMobile(body.mobile);
  const pin = String(body.pin || '');
  const playMode = String(body.playMode || 'individual');
  const teamName = String(body.teamName || '').trim().slice(0,50);
  const caseLength = String(body.caseLength || 'standard');
  if (sessionCode.length < 4) return { error:'Invalid event code.' };
  if (name.length < 2) return { error:'Enter a name or detective alias.' };
  if (mobile.length !== 10) return { error:'Enter a 10-digit mobile number so your case can be saved.' };
  if (!/^\d{4}$/.test(pin)) return { error:'Choose a 4-digit PIN.' };
  if (!PLAY_MODES.has(playMode)) return { error:'Choose individual or table play.' };
  if (playMode === 'team' && teamName.length < 2) return { error:'Enter a table or team name.' };
  if (!CASE_LENGTHS.has(caseLength)) return { error:'Choose a valid case length.' };
  return { sessionCode,name,mobile,pin,playMode,teamName,caseLength };
}

function ensureProgressAllowed(progress, alreadyDone = false) {
  if (!progress.paused) return null;
  if (alreadyDone) return null;
  return 'Resume the case before unlocking new information.';
}

async function persistPlayer(player, progress) {
  progress.updatedAt = nowIso();
  return db.savePlayerState(player.id, progress);
}

app.get('/api/health', (req,res) => res.json({ ok:true,db:process.env.DATABASE_URL ? 'postgres':'local-json',version:'3.2.0',cases:GAME.caseOrder.length }));

app.get('/api/config', async (req,res) => {
  const code = normalizeSessionCode(req.query.session || 'OURMOMS');
  const session = await db.getSessionByCode(code);
  res.json({
    title:GAME.app.title,subtitle:GAME.app.subtitle,defaultSession:'OURMOMS',
    session:session ? { code:session.code,title:session.title,venue:session.venue,isOpen:session.is_open } : null,
    profiles:Object.fromEntries(Object.entries(GAME.profiles).map(([key,p]) => [key,{ label:p.publicLabel,time:p.time,description:p.description }]))
  });
});

app.post('/api/register', async (req,res) => {
  try {
    const values = validateRegistration(req.body || {});
    if (values.error) return res.status(400).json({ error:values.error });
    const session = await db.getSessionByCode(values.sessionCode);
    if (!session) return res.status(404).json({ error:'Event session not found.' });
    if (!session.is_open) return res.status(403).json({ error:'Registration is currently closed.' });
    const caseVersion = await assignCaseVersion(session, values.mobile);
    const player = await db.createPlayer({
      sessionId:session.id,name:values.name,mobile:values.mobile,pinHash:await bcrypt.hash(values.pin,10),
      playMode:values.playMode,teamName:values.teamName,caseLength:values.caseLength,caseVersion,progress:initialProgress(values.caseLength),
    });
    const { progress } = prepareProgress(player);
    await persistPlayer(player, progress);
    return res.json({
      token:sign({ type:'player',playerId:player.id,sessionId:session.id }),
      session:{ code:session.code,title:session.title,venue:session.venue },player:safePlayer(player,progress),game:publicGame(player,progress),accusation:null,
    });
  } catch (error) {
    return res.status(error.code === 'DUPLICATE' ? 409 : 500).json({ error:error.message || 'Unable to register.' });
  }
});

app.post('/api/resume', async (req,res) => {
  const code = normalizeSessionCode(req.body?.sessionCode || 'OURMOMS');
  const mobile = normalizeMobile(req.body?.mobile);
  const pin = String(req.body?.pin || '');
  if (code.length < 4 || mobile.length !== 10 || !/^\d{4}$/.test(pin)) return res.status(400).json({ error:'Enter a valid mobile number and 4-digit PIN.' });
  const key = attemptKey(req,'player',`${code}:${mobile}`);
  if (!checkAttemptLimit(key,res)) return;
  const session = await db.getSessionByCode(code);
  const player = session ? await db.findPlayerByMobile(session.id,mobile) : null;
  if (!player || !(await bcrypt.compare(pin,player.pin_hash))) {
    recordFailedAttempt(key); return res.status(401).json({ error:'Mobile number or PIN did not match.' });
  }
  clearAttempts(key);
  const { progress } = prepareProgress(player);
  const saved = await persistPlayer(player,progress);
  const accusation = await db.getAccusation(player.id);
  return res.json({ token:sign({type:'player',playerId:player.id,sessionId:session.id}),session:{code:session.code,title:session.title,venue:session.venue},player:safePlayer(saved,progress),game:publicGame(saved,progress,accusation),accusation:decorateAccusation(accusation,caseFor(saved),saved) });
});

app.get('/api/me', authPlayer, async (req,res) => {
  const player = await db.getPlayer(req.auth.playerId);
  if (!player || player.session_id !== req.auth.sessionId) return res.status(404).json({ error:'Player not found.' });
  const session = await db.getSessionById(player.session_id);
  const { progress } = prepareProgress(player);
  const saved = await persistPlayer(player,progress);
  const accusation = await db.getAccusation(player.id);
  return res.json({ session:{code:session.code,title:session.title,venue:session.venue},player:safePlayer(saved,progress),game:publicGame(saved,progress,accusation),accusation:decorateAccusation(accusation,caseFor(saved),saved) });
});

app.get('/api/game', authPlayer, async (req,res) => {
  const player = await db.getPlayer(req.auth.playerId);
  if (!player || player.session_id !== req.auth.sessionId) return res.status(404).json({ error:'Player not found.' });
  const { progress } = prepareProgress(player);
  const accusation = await db.getAccusation(player.id);
  await persistPlayer(player,progress);
  return res.json({ game:publicGame(player,progress,accusation) });
});

app.put('/api/progress', authPlayer, (req,res) => res.status(400).json({ error:'Direct progress replacement is disabled.' }));

app.post('/api/action', authPlayer, async (req,res) => {
  try {
    const player = await db.getPlayer(req.auth.playerId);
    if (!player || player.session_id !== req.auth.sessionId) return res.status(404).json({ error:'Player not found.' });
    if (await db.getAccusation(player.id)) return res.status(409).json({ error:'This completed case is locked.' });
    const caseData = caseFor(player);
    const { progress, events } = prepareProgress(player);
    const action = String(req.body?.action || '');
    const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
    let feedback = null;

    if (action === 'heartbeat') {
      // Timer and auto-advance are handled below.
    } else if (action === 'view_briefing') {
      const id = String(payload.briefingId || '');
      const briefing = findBriefing(caseData,id);
      if (!briefing || chapterIndex(briefing.chapter) > chapterIndex(progress.chapter)) return res.status(403).json({ error:'This briefing is not available yet.' });
      const already = progress.briefingsViewed.includes(id);
      const pausedError = ensureProgressAllowed(progress,already); if (pausedError) return res.status(409).json({ error:pausedError });
      if (!already) {
        progress.briefingsViewed.push(id);
        events.push({type:'briefing',message:`${briefing.title} added to your briefing archive.`});
      }
    } else if (action === 'view_evidence') {
      const id = String(payload.evidenceId || '');
      const evidence = findEvidence(caseData,id);
      if (!evidence || !progress.evidenceUnlocked.includes(id)) return res.status(403).json({ error:'This evidence is not available yet.' });
      const already = progress.evidenceViewed.includes(id);
      const pausedError = ensureProgressAllowed(progress,already); if (pausedError) return res.status(409).json({ error:pausedError });
      if (!already) {
        progress.evidenceViewed.push(id); addDiscovery(progress,evidence.autoNote,`evidence:${id}`);
        events.push({type:'evidence',message:`${evidence.title} added to your case files.`});
      }
    } else if (action === 'open_suspect') {
      const id = String(payload.suspectId || '');
      if (!findSuspect(caseData,id)) return res.status(400).json({ error:'Unknown suspect.' });
      const already = progress.suspectsOpened.includes(id);
      const pausedError = ensureProgressAllowed(progress,already); if (pausedError) return res.status(409).json({ error:pausedError });
      if (!already) progress.suspectsOpened.push(id);
    } else if (action === 'ask_question') {
      if (progress.paused) return res.status(409).json({ error:'Resume the case before conducting a new interview.' });
      if (chapterIndex(progress.chapter) < chapterIndex('C02')) return res.status(403).json({ error:'Interviews open after the murder is announced.' });
      const suspect = findSuspect(caseData,String(payload.suspectId || ''));
      if (!suspect) return res.status(400).json({ error:'Unknown suspect.' });
      const followup = Boolean(payload.followup);
      const list = followup ? suspect.followups : suspect.questions;
      const question = list.find((item) => item.id === String(payload.questionId || ''));
      if (!question) return res.status(400).json({ error:'Unknown interview question.' });
      if (followup && !question.requires.every((id) => progress.evidenceViewed.includes(id))) return res.status(403).json({ error:'Review the required evidence first.' });
      const key = `${suspect.id}:${question.id}`;
      const target = followup ? progress.followupsAsked : progress.questionsAsked;
      if (!target.includes(key)) {
        target.push(key); addDiscovery(progress,question.autoNote,`interview:${key}`);
        events.push({type:'interview',message:`New statement recorded from ${suspect.name}.`});
      }
    } else if (action === 'complete_lead') {
      if (progress.paused) return res.status(409).json({ error:'Resume the case before following a new lead.' });
      if (chapterIndex(progress.chapter) < chapterIndex('C03')) return res.status(403).json({ error:'Lead paths open in Chapter 3.' });
      const lead = caseData.leads.find((item) => item.id === String(payload.leadId || ''));
      if (!lead) return res.status(400).json({ error:'Unknown lead.' });
      if (!progress.leadsCompleted.includes(lead.id)) {
        progress.leadsCompleted.push(lead.id); events.push({type:'lead',message:`${lead.title} evidence unlocked.`});
      }
    } else if (action === 'submit_deduction') {
      if (progress.paused) return res.status(409).json({ error:'Resume the case before solving a deduction.' });
      const deduction = findDeduction(caseData,String(payload.deductionId || ''));
      if (!deduction || !deduction.requires.every((id) => progress.evidenceViewed.includes(id))) return res.status(403).json({ error:'This deduction is not available yet.' });
      if (!progress.deductionsSolved.includes(deduction.id)) {
        progress.deductionAttempts[deduction.id] = Number(progress.deductionAttempts[deduction.id] || 0) + 1;
        if (String(payload.optionId || '') === deduction.correct) {
          progress.deductionsSolved.push(deduction.id); addDiscovery(progress,deduction.autoNote,`deduction:${deduction.id}`);
          feedback = { correct:true,message:deduction.success }; events.push({type:'deduction',message:`${deduction.title} solved.`});
        } else feedback = { correct:false,message:deduction.wrong };
      } else feedback = { correct:true,message:'You already solved this deduction.' };
    } else if (action === 'use_hint') {
      const hint = caseData.hints.find((item) => item.id === String(payload.hintId || ''));
      const level = Number(payload.level);
      if (!hint || ![1,2,3].includes(level)) return res.status(400).json({ error:'Invalid hint.' });
      if (level > 1 && !progress.hintsUsed.includes(`${hint.id}:${level-1}`)) return res.status(409).json({ error:'Reveal hints in order.' });
      const key = `${hint.id}:${level}`;
      if (!progress.hintsUsed.includes(key)) progress.hintsUsed.push(key);
    } else if (action === 'add_note') {
      const text = String(payload.text || '').trim();
      if (!text) return res.status(400).json({ error:'Write a note before saving.' });
      if (text.length > 500) return res.status(400).json({ error:'Keep notes under 500 characters.' });
      progress.notes.unshift({id:crypto.randomUUID(),text,createdAt:nowIso()});
    } else if (action === 'delete_note') {
      progress.notes = progress.notes.filter((note) => note.id !== String(payload.noteId || ''));
    } else if (action === 'set_theory') {
      const options = caseData.accusationOptions;
      const theory = payload.theory || {};
      const valid = (items,id) => !id || items.some((item) => item.id === id);
      if (!valid(options.killers,theory.suspectId) || !valid(options.motives,theory.motiveId) || !valid(options.weapons,theory.weaponId) || !valid(options.clues,theory.clueId)) return res.status(400).json({ error:'Invalid theory selection.' });
      progress.theory = { suspectId:String(theory.suspectId || ''),motiveId:String(theory.motiveId || ''),weaponId:String(theory.weaponId || ''),clueId:String(theory.clueId || '') };
    } else if (action === 'set_paused') {
      progress.paused = Boolean(payload.paused); progress.timer.lastActiveAt = nowIso();
    } else return res.status(400).json({ error:'Unknown game action.' });

    computeUnlocked(player,progress);
    advanceIfReady(player,progress,events);
    computeUnlocked(player,progress);
    const saved = await persistPlayer(player,progress);
    return res.json({ player:safePlayer(saved,progress),game:publicGame(saved,progress),events,feedback });
  } catch (error) {
    return res.status(500).json({ error:error.message || 'Unable to save the game action.' });
  }
});

app.post('/api/accusation', authPlayer, async (req,res) => {
  try {
    const player = await db.getPlayer(req.auth.playerId);
    if (!player || player.session_id !== req.auth.sessionId) return res.status(404).json({ error:'Player not found.' });
    if (await db.getAccusation(player.id)) return res.status(409).json({ error:'Your final accusation has already been submitted.' });
    const { progress } = prepareProgress(player);
    if (progress.chapter !== 'C05' || !progress.chaptersCompleted.includes('C04')) return res.status(403).json({ error:'Complete the investigation before accusing anyone.' });
    const caseData = caseFor(player);
    const finalBriefing = briefingForChapter(caseData,'C05');
    if (finalBriefing && !progress.briefingsViewed.includes(finalBriefing.id)) return res.status(403).json({ error:'Review the final detective briefing before locking your accusation.' });
    const answers = req.body?.answers || {};
    const options = caseData.accusationOptions;
    if (!options.killers.some((i) => i.id === answers.q1) || !options.motives.some((i) => i.id === answers.q2) || !options.weapons.some((i) => i.id === answers.q3) || !options.clues.some((i) => i.id === answers.q4)) return res.status(400).json({ error:'Complete every required accusation question.' });
    if (String(answers.q5 || '').length > 1000) return res.status(400).json({ error:'Keep the explanation under 1,000 characters.' });
    const score = scoreAccusation(caseData,answers,progress.hintsUsed);
    const accusation = await db.createAccusation(player.id,answers,score,rankFor(score));
    if (!progress.chaptersCompleted.includes('C05')) progress.chaptersCompleted.push('C05');
    const saved = await persistPlayer(player,progress);
    return res.json({ accusation:decorateAccusation(accusation,caseData,saved),player:safePlayer(saved,progress),game:publicGame(saved,progress,accusation) });
  } catch (error) {
    return res.status(error.code === 'DUPLICATE' ? 409 : 500).json({ error:error.message || 'Unable to submit accusation.' });
  }
});

app.get('/api/leaderboard', async (req,res) => {
  const session = await db.getSessionByCode(normalizeSessionCode(req.query.session || 'OURMOMS'));
  if (!session) return res.status(404).json({ error:'Session not found.' });
  return res.json({ leaderboard:await db.leaderboard(session.id) });
});

app.post('/api/host/login', async (req,res) => {
  const code = normalizeSessionCode(req.body?.sessionCode || 'OURMOMS');
  const pin = String(req.body?.pin || '');
  if (code.length < 4 || !/^\d{4,12}$/.test(pin)) return res.status(400).json({ error:'Enter a valid session code and host PIN.' });
  const key = attemptKey(req,'host',code); if (!checkAttemptLimit(key,res)) return;
  if (!secureEqual(pin,HOST_PIN)) { recordFailedAttempt(key); return res.status(401).json({ error:'Incorrect host PIN.' }); }
  const session = await db.getSessionByCode(code);
  if (!session) { recordFailedAttempt(key); return res.status(404).json({ error:'Session not found.' }); }
  clearAttempts(key);
  return res.json({ token:sign({type:'host',sessionId:session.id},12),session });
});

function hostPlayer(player) {
  const p = normalizeProgress(player);
  const inactiveMinutes = Math.max(0,(Date.now()-Date.parse(p.updatedAt || player.created_at))/60000);
  let status = player.score != null ? 'Completed' : p.paused ? 'Paused' : 'Playing';
  if (status === 'Playing' && inactiveMinutes >= 15) status = 'May need help';
  return { id:player.id,displayName:player.team_name || player.name,playMode:player.play_mode,caseLength:player.case_length,chapter:p.chapter,status,lastActiveAt:p.updatedAt,score:player.score ?? null,rank:player.rank_name || null };
}

app.post('/api/host/session', authHost, async (req,res) => {
  const code = normalizeSessionCode(req.body?.code);
  const versionMode = String(req.body?.versionMode || 'rotating');
  const fixedVersion = String(req.body?.fixedVersion || '');
  if (code.length < 4) return res.status(400).json({ error:'Session code must be at least 4 characters.' });
  if (!VERSION_MODES.has(versionMode)) return res.status(400).json({ error:'Invalid case assignment mode.' });
  if (versionMode === 'fixed' && !CASE_IDS.has(fixedVersion)) return res.status(400).json({ error:'Choose a valid fixed case.' });
  try {
    const session = await db.createSession({
      code,
      title:String(req.body?.title || GAME.app.title).trim().slice(0,100),
      venue:String(req.body?.venue || GAME.app.venue).trim().slice(0,120),
      pacingMode:'logical',
      versionMode,
      fixedVersion:versionMode === 'fixed' ? fixedVersion : null,
    });
    return res.json({ session });
  } catch (error) {
    return res.status(error.code === 'DUPLICATE' ? 409 : 500).json({ error:error.message || 'Unable to create session.' });
  }
});

app.get('/api/host/session', authHost, async (req,res) => {
  const session = await db.getSessionById(req.auth.sessionId);
  if (!session) return res.status(404).json({ error:'Session not found.' });
  const raw = await db.listPlayers(session.id);
  const players = raw.map(hostPlayer);
  const counts = { registered:players.length,playing:players.filter((p)=>p.status==='Playing').length,paused:players.filter((p)=>p.status==='Paused').length,help:players.filter((p)=>p.status==='May need help').length,completed:players.filter((p)=>p.status==='Completed').length };
  return res.json({ session,counts,players,leaderboard:await db.leaderboard(session.id),versionDistribution:await db.versionCounts(session.id) });
});

app.post('/api/host/open', authHost, async (req,res) => {
  if (typeof req.body?.isOpen !== 'boolean') return res.status(400).json({ error:'isOpen must be true or false.' });
  return res.json({ session:await db.setSessionOpen(req.auth.sessionId,req.body.isOpen) });
});

app.post('/api/host/version-mode', authHost, async (req,res) => {
  const mode = String(req.body?.versionMode || '');
  const fixed = String(req.body?.fixedVersion || '');
  if (!VERSION_MODES.has(mode)) return res.status(400).json({ error:'Invalid case assignment mode.' });
  if (mode === 'fixed' && !CASE_IDS.has(fixed)) return res.status(400).json({ error:'Choose a valid fixed case.' });
  return res.json({ session:await db.setSessionVersionMode(req.auth.sessionId,mode,mode === 'fixed' ? fixed : null) });
});

app.post('/api/host/reset-player', authHost, async (req,res) => {
  const player = await db.getPlayer(req.body?.playerId);
  if (!player || player.session_id !== req.auth.sessionId) return res.status(404).json({ error:'Player not found.' });
  await db.resetPlayer(player.id,initialProgress(player.case_length));
  return res.json({ ok:true });
});

app.get('/api/host/qr', authHost, async (req,res) => {
  const session = await db.getSessionById(req.auth.sessionId);
  if (!session) return res.status(404).json({ error:'Session not found.' });
  const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const url = `${base}/?session=${encodeURIComponent(session.code)}`;
  return res.json({ url,dataUrl:await QRCode.toDataURL(url,{width:500,margin:2}) });
});

app.use('/api',(req,res)=>res.status(404).json({ error:'API endpoint not found.' }));
app.use((req,res,next)=> req.method === 'GET' ? res.sendFile(path.join(__dirname,'public','index.html')) : next());
app.use((req,res)=>res.status(404).json({ error:'Not found.' }));

db.init().then(()=>app.listen(PORT,()=>console.log(`Reunion mystery v3.2.0 running on http://localhost:${PORT}`))).catch((error)=>{ console.error(error); process.exit(1); });
