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
const content = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'game-content.json'), 'utf8'),
);

const PLAY_MODES = new Set(['individual', 'team']);
const CASE_LENGTHS = new Set(['quick', 'standard', 'extended']);
const PACING_MODES = new Set(['logical', 'hybrid']);
const EVIDENCE_MARKS = new Set(['important', 'explained', 'red-herring']);
const SUSPECT_STATUSES = new Set(['unknown', 'suspicious', 'cleared']);
const CHAPTER_IDS = new Set(content.chapters.map((chapter) => chapter.id));
const EVIDENCE_IDS = new Set(content.evidence.map((evidence) => evidence.id));
const SUSPECT_IDS = new Set(content.suspects.map((suspect) => suspect.id));
const LEAD_IDS = new Set(content.leads.map((lead) => lead.id));
const HINT_IDS = new Set(content.hints.case_hints.map((hint) => hint.id));

const ANSWER_OPTIONS = {
  q2: [
    "Stop Blake from exposing Morgan's 2006 scholarship fraud",
    'Hide stolen reunion money',
    'Prevent an affair from becoming public',
    'Avoid repaying a large loan',
    'Revenge for a stolen song',
  ],
  q3: [
    'Bronze Most Likely to Succeed trophy',
    'Poisoned reunion drink',
    'Camera tripod',
    'Time-capsule lock',
  ],
  q4: [
    'The group photo metadata showing 8:31 p.m.',
    'The threatening handwritten note',
    'The duplicate catering charge',
    "Jace's loan record",
  ],
};

const CASE_PROFILES = {
  quick: {
    label: 'Quick Case',
    description: 'Essential clues, fewer required interviews, and shorter minimum pacing.',
    timeScale: 0.25,
    requiredSuspects: 4,
    requiredQuestions: 2,
    requiredLeads: 1,
    requiredConnections: 0,
    evidenceIds: content.evidence
      .map((item) => item.id)
      .filter((id) => !['E16', 'E17', 'E18', 'E19', 'E20', 'E21', 'E22'].includes(id)),
    availableLeadIds: ['money', 'secrets', 'prank'],
    timedEvidenceSeconds: 10,
  },
  standard: {
    label: 'Standard Case',
    description: 'The complete core mystery with optional side evidence and balanced pacing.',
    timeScale: 0.5,
    requiredSuspects: 6,
    requiredQuestions: 4,
    requiredLeads: 2,
    requiredConnections: 1,
    evidenceIds: content.evidence.map((item) => item.id),
    availableLeadIds: content.leads.map((item) => item.id),
    timedEvidenceSeconds: 30,
  },
  extended: {
    label: 'Extended Case',
    description: 'All suspects, more lead work, more corroboration, and full dramatic pacing.',
    timeScale: 1,
    requiredSuspects: 12,
    requiredQuestions: 8,
    requiredLeads: 4,
    requiredConnections: 2,
    evidenceIds: content.evidence.map((item) => item.id),
    availableLeadIds: content.leads.map((item) => item.id),
    timedEvidenceSeconds: 60,
  },
};

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json({ limit: '300kb' }));
app.use(express.static(path.join(__dirname, 'public')));

if (process.env.NODE_ENV === 'production' && APP_SECRET === 'development-only-change-me') {
  console.warn('WARNING: Set APP_SECRET before public deployment.');
}

function normalizeMobile(value) {
  return String(value || '').replace(/\D/g, '').slice(-10);
}

function normalizeSessionCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function nowIso() {
  return new Date().toISOString();
}

function sign(payload, hours = 24 * 30) {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Date.now() + hours * 3600_000 }),
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', APP_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function verify(token, type) {
  try {
    const [body, signature] = String(token || '').split('.');
    if (!body || !signature) return null;
    const expected = crypto.createHmac('sha256', APP_SECRET).update(body).digest('base64url');
    if (!secureEqual(signature, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Date.now() || payload.type !== type) return null;
    return payload;
  } catch {
    return null;
  }
}

function authPlayer(req, res, next) {
  const payload = verify(
    (req.headers.authorization || '').replace(/^Bearer\s+/i, ''),
    'player',
  );
  if (!payload) return res.status(401).json({ error: 'Session expired. Please resume your case.' });
  req.auth = payload;
  return next();
}

function authHost(req, res, next) {
  const payload = verify(
    (req.headers.authorization || '').replace(/^Bearer\s+/i, ''),
    'host',
  );
  if (!payload) return res.status(401).json({ error: 'Host login required.' });
  req.auth = payload;
  return next();
}

const loginAttempts = new Map();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function attemptKey(req, type, identity) {
  return `${type}:${req.ip}:${String(identity || '').toLowerCase()}`;
}

function checkAttemptLimit(key, res) {
  const entry = loginAttempts.get(key);
  if (!entry) return true;
  const now = Date.now();
  if (entry.lockedUntil && entry.lockedUntil > now) {
    const retrySeconds = Math.ceil((entry.lockedUntil - now) / 1000);
    res.set('Retry-After', String(retrySeconds));
    res.status(429).json({
      error: `Too many failed attempts. Try again in ${Math.ceil(retrySeconds / 60)} minute(s).`,
    });
    return false;
  }
  if (now - entry.firstAttempt > ATTEMPT_WINDOW_MS) {
    loginAttempts.delete(key);
  }
  return true;
}

function recordFailedAttempt(key) {
  const now = Date.now();
  const existing = loginAttempts.get(key);
  const entry = !existing || now - existing.firstAttempt > ATTEMPT_WINDOW_MS
    ? { count: 0, firstAttempt: now, lockedUntil: 0 }
    : existing;
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) entry.lockedUntil = now + LOCK_MS;
  loginAttempts.set(key, entry);
}

function clearAttempts(key) {
  loginAttempts.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of loginAttempts.entries()) {
    if ((entry.lockedUntil || entry.firstAttempt + ATTEMPT_WINDOW_MS) < now) {
      loginAttempts.delete(key);
    }
  }
}, 10 * 60 * 1000).unref();

function profileFor(caseLength) {
  return CASE_PROFILES[caseLength] || CASE_PROFILES.standard;
}

function chapterIndex(chapterId) {
  return content.chapters.findIndex((chapter) => chapter.id === chapterId);
}

function createTimer(chapter = 'C00') {
  return {
    chapter,
    activeSeconds: 0,
    lastActiveAt: nowIso(),
  };
}

function initialProgress(caseLength) {
  return {
    serverVersion: 2,
    chapter: 'C00',
    chaptersCompleted: [],
    evidenceViewed: [],
    evidenceUnlocked: ['E01', 'E02'],
    suspectsOpened: [],
    questionsAsked: [],
    followupsAsked: [],
    notes: [],
    evidenceMarks: {},
    suspectStatuses: {},
    connections: [],
    leadsCompleted: [],
    hintsUsed: [],
    paused: false,
    caseLength,
    timer: createTimer('C00'),
    updatedAt: nowIso(),
  };
}

function uniqueValid(values, validSet) {
  return [...new Set(Array.isArray(values) ? values.filter((value) => validSet.has(value)) : [])];
}

function normalizeProgress(raw, caseLength) {
  if (!raw || raw.serverVersion !== 2) return initialProgress(caseLength);
  const progress = {
    ...initialProgress(caseLength),
    ...raw,
    serverVersion: 2,
    caseLength,
  };
  progress.chapter = CHAPTER_IDS.has(progress.chapter) ? progress.chapter : 'C00';
  progress.chaptersCompleted = uniqueValid(progress.chaptersCompleted, CHAPTER_IDS);
  progress.evidenceViewed = uniqueValid(progress.evidenceViewed, EVIDENCE_IDS);
  progress.evidenceUnlocked = uniqueValid(progress.evidenceUnlocked, EVIDENCE_IDS);
  progress.suspectsOpened = uniqueValid(progress.suspectsOpened, SUSPECT_IDS);
  progress.leadsCompleted = uniqueValid(progress.leadsCompleted, LEAD_IDS);
  progress.hintsUsed = [...new Set(Array.isArray(progress.hintsUsed) ? progress.hintsUsed : [])]
    .filter((key) => {
      const [id, level] = String(key).split(':');
      return HINT_IDS.has(id) && [1, 2, 3].includes(Number(level));
    });
  progress.questionsAsked = [...new Set(Array.isArray(progress.questionsAsked) ? progress.questionsAsked : [])];
  progress.followupsAsked = [...new Set(Array.isArray(progress.followupsAsked) ? progress.followupsAsked : [])];
  progress.notes = (Array.isArray(progress.notes) ? progress.notes : [])
    .filter((note) => note && typeof note.text === 'string')
    .slice(0, 100)
    .map((note) => ({
      id: String(note.id),
      text: note.text.slice(0, 500),
      createdAt: note.createdAt || nowIso(),
    }));
  progress.connections = (Array.isArray(progress.connections) ? progress.connections : [])
    .filter((connection) => EVIDENCE_IDS.has(connection?.a) && EVIDENCE_IDS.has(connection?.b))
    .slice(0, 100);
  progress.evidenceMarks = progress.evidenceMarks && typeof progress.evidenceMarks === 'object'
    ? progress.evidenceMarks
    : {};
  progress.suspectStatuses = progress.suspectStatuses && typeof progress.suspectStatuses === 'object'
    ? progress.suspectStatuses
    : {};
  progress.paused = Boolean(progress.paused);
  progress.timer = progress.timer && progress.timer.chapter === progress.chapter
    ? {
      chapter: progress.chapter,
      activeSeconds: Math.max(0, Number(progress.timer.activeSeconds) || 0),
      lastActiveAt: progress.timer.lastActiveAt || nowIso(),
    }
    : createTimer(progress.chapter);
  return progress;
}

function tickTimer(progress) {
  const now = Date.now();
  if (!progress.timer || progress.timer.chapter !== progress.chapter) {
    progress.timer = createTimer(progress.chapter);
    return progress;
  }
  const previous = Date.parse(progress.timer.lastActiveAt || nowIso());
  if (!progress.paused && Number.isFinite(previous)) {
    const elapsed = Math.max(0, (now - previous) / 1000);
    progress.timer.activeSeconds += Math.min(elapsed, 300);
  }
  progress.timer.lastActiveAt = new Date(now).toISOString();
  return progress;
}

function effectiveMinimumSeconds(chapterId, caseLength) {
  if (process.env.TEST_BYPASS_TIMERS === '1') return 0;
  const chapter = content.chapters.find((item) => item.id === chapterId);
  if (!chapter) return 0;
  return Math.ceil(Number(chapter.min_seconds || 0) * profileFor(caseLength).timeScale);
}

function timerRemaining(progress) {
  return Math.max(
    0,
    Math.ceil(effectiveMinimumSeconds(progress.chapter, progress.caseLength)
      - Number(progress.timer?.activeSeconds || 0)),
  );
}

function evidenceAvailable(caseLength, evidenceId) {
  return profileFor(caseLength).evidenceIds.includes(evidenceId);
}

function computeUnlocked(progress) {
  const unlocked = new Set(['E01', 'E02']);
  const currentIndex = chapterIndex(progress.chapter);

  for (const evidence of content.evidence) {
    if (!evidenceAvailable(progress.caseLength, evidence.id)) continue;
    const rule = evidence.unlock || {};
    if (rule.type === 'auto') unlocked.add(evidence.id);
    if (rule.type === 'chapter') {
      const requiredIndex = chapterIndex(rule.chapter);
      if (requiredIndex >= 0 && requiredIndex <= currentIndex) unlocked.add(evidence.id);
    }
    if (rule.type === 'evidence' && (rule.requires || []).every((id) => progress.evidenceViewed.includes(id))) {
      unlocked.add(evidence.id);
    }
    if (rule.type === 'lead' && progress.leadsCompleted.includes(rule.lead)) {
      unlocked.add(evidence.id);
    }
  }

  for (const leadId of progress.leadsCompleted) {
    const lead = content.leads.find((item) => item.id === leadId);
    for (const evidenceId of lead?.evidence || []) {
      if (evidenceAvailable(progress.caseLength, evidenceId)) unlocked.add(evidenceId);
    }
  }

  if (progress.caseLength === 'quick' && currentIndex >= chapterIndex('C03')) unlocked.add('E09');

  if (
    currentIndex >= chapterIndex('C04')
    && progress.evidenceViewed.includes('E05')
    && progress.evidenceViewed.includes('E11')
    && Number(progress.timer?.activeSeconds || 0) >= profileFor(progress.caseLength).timedEvidenceSeconds
  ) {
    unlocked.add('E13');
  }
  if (progress.evidenceViewed.includes('E11') && progress.followupsAsked.includes('S07:F2')) unlocked.add('E14');
  if (progress.evidenceViewed.includes('E12') && progress.followupsAsked.includes('S05:F2')) unlocked.add('E15');
  if (progress.leadsCompleted.includes('messages')) unlocked.add('E16');
  if (progress.leadsCompleted.includes('money')) unlocked.add('E17');
  if (progress.evidenceViewed.includes('E09') && progress.questionsAsked.some((key) => key.startsWith('S06:'))) unlocked.add('E18');
  if (progress.leadsCompleted.includes('coverup')) unlocked.add('E19');
  if (progress.questionsAsked.includes('S09:Q3') || progress.questionsAsked.includes('S09:Q4')) unlocked.add('E20');
  if (progress.leadsCompleted.includes('ownership')) unlocked.add('E21');
  if (progress.evidenceViewed.includes('E10') && progress.followupsAsked.includes('S12:F2')) unlocked.add('E22');

  progress.evidenceUnlocked = [...unlocked].filter((id) => evidenceAvailable(progress.caseLength, id));
  progress.evidenceViewed = progress.evidenceViewed.filter((id) => progress.evidenceUnlocked.includes(id));
  return progress;
}

function prepareProgress(player) {
  const progress = normalizeProgress(player.progress, player.case_length);
  tickTimer(progress);
  computeUnlocked(progress);
  progress.updatedAt = nowIso();
  return progress;
}

function chapterRequirements(progress, accusation = null) {
  const profile = profileFor(progress.caseLength);
  const marks = Object.values(progress.evidenceMarks || {});
  switch (progress.chapter) {
    case 'C00':
      return [
        { text: 'Open the case introduction', done: progress.evidenceViewed.includes('E01') },
        { text: 'Open the suspect directory', done: progress.evidenceViewed.includes('E02') },
        { text: 'Choose a case length', done: CASE_LENGTHS.has(progress.caseLength) },
      ];
    case 'C01':
      return [
        { text: 'Review the group photo', done: progress.evidenceViewed.includes('E03') },
        { text: "Review Blake's remarks", done: progress.evidenceViewed.includes('E04') },
        {
          text: `Open at least ${profile.requiredSuspects} suspect profiles`,
          done: progress.suspectsOpened.length >= profile.requiredSuspects,
        },
      ];
    case 'C02':
      return [
        {
          text: 'Review the crime scene, threat, and phone draft',
          done: ['E05', 'E06', 'E07'].every((id) => progress.evidenceViewed.includes(id)),
        },
        {
          text: `Ask at least ${profile.requiredQuestions} interview questions`,
          done: progress.questionsAsked.length >= profile.requiredQuestions,
        },
        { text: 'Save one notebook note', done: progress.notes.length >= 1 },
      ];
    case 'C03':
      return [
        {
          text: `Complete at least ${profile.requiredLeads} lead path${profile.requiredLeads === 1 ? '' : 's'}`,
          done: progress.leadsCompleted.length >= profile.requiredLeads,
        },
        { text: "Review Blake's blackmail list", done: progress.evidenceViewed.includes('E09') },
        {
          text: 'Mark one clue explained or red herring',
          done: marks.some((value) => value === 'explained' || value === 'red-herring'),
        },
      ];
    case 'C04': {
      const coreEvidence = ['E10', 'E11', 'E12'];
      const extendedEvidence = progress.caseLength === 'extended' ? ['E13', 'E14', 'E15'] : [];
      return [
        {
          text: progress.caseLength === 'extended'
            ? 'Review the envelope, metadata, letter, pin, test frame, and trophy report'
            : 'Review the envelope, metadata, and letter',
          done: [...coreEvidence, ...extendedEvidence]
            .every((id) => progress.evidenceViewed.includes(id)),
        },
        {
          text: 'Ask Morgan about the false photo alibi',
          done: progress.followupsAsked.includes('S01:F1'),
        },
        {
          text: profile.requiredConnections
            ? `Create ${profile.requiredConnections} evidence connection${profile.requiredConnections === 1 ? '' : 's'}`
            : 'Evidence connection is optional in Quick Case',
          done: progress.connections.length >= profile.requiredConnections,
        },
      ];
    }
    case 'C05':
      return [{ text: 'Submit your final accusation', done: Boolean(accusation) }];
    default:
      return [];
  }
}

function chapterCanComplete(progress) {
  const tasks = chapterRequirements(progress);
  return tasks.every((task) => task.done) && timerRemaining(progress) === 0;
}

function safePlayer(player, progress) {
  return {
    id: player.id,
    name: player.name,
    displayName: player.team_name || player.name,
    playMode: player.play_mode,
    teamName: player.team_name,
    caseLength: player.case_length,
    sessionId: player.session_id,
    progress: {
      ...progress,
      chapterTasks: chapterRequirements(progress),
      minimumSeconds: effectiveMinimumSeconds(progress.chapter, progress.caseLength),
      minimumSecondsRemaining: timerRemaining(progress),
    },
    checkedInAt: player.checked_in_at,
  };
}

function safeHostPlayer(player) {
  return {
    id: player.id,
    displayName: player.team_name || player.name,
    playMode: player.play_mode,
    caseLength: player.case_length,
    checkedInAt: player.checked_in_at,
    chapter: player.progress?.chapter || 'C00',
    evidenceViewedCount: player.progress?.evidenceViewed?.length || 0,
    paused: Boolean(player.progress?.paused),
    score: Number.isFinite(Number(player.score)) ? Number(player.score) : null,
    rankName: player.rank_name || null,
    submittedAt: player.submitted_at || null,
  };
}

function rankFor(score) {
  return content.finale.rankings.find((ranking) => score >= ranking.min)?.name
    || 'Detention Detective';
}

function solvedAnswers(answers) {
  const form = content.finale.accusation_form;
  return answers.q1 === form.q1.correct
    && answers.q2 === form.q2.correct
    && answers.q3 === form.q3.correct
    && answers.q4 === form.q4.correct;
}

function scoreAnswers(answers, hintsUsed) {
  let score = 0;
  const form = content.finale.accusation_form;
  if (answers.q1 === form.q1.correct) score += form.q1.points;
  if (answers.q2 === form.q2.correct) score += form.q2.points;
  if (answers.q3 === form.q3.correct) score += form.q3.points;
  if (answers.q4 === form.q4.correct) score += form.q4.points;
  const text = String(answers.q5 || '').toLowerCase();
  const hits = form.q5.keywords.filter((keyword) => text.includes(String(keyword).toLowerCase())).length;
  if (hits >= 6) score += 10;
  else if (hits >= 4) score += 7;
  else if (hits >= 2) score += 4;
  score -= Math.min(
    20,
    (hintsUsed || []).length * content.hints.global_rules.penalty_per_hint,
  );
  return Math.max(0, score);
}

function decorateAccusation(accusation) {
  if (!accusation) return null;
  const solved = solvedAnswers(accusation.answers || {});
  return {
    score: Number(accusation.score),
    rankName: accusation.rank_name,
    submittedAt: accusation.submitted_at,
    solved,
    reveal: solved ? content.finale.correct_reveal : content.finale.incorrect_reveal,
    fullSolution: content.finale.correct_reveal,
    confession: content.finale.confession,
  };
}

function publicGameFor(player, progress) {
  const askedQuestions = new Set(progress.questionsAsked);
  const askedFollowups = new Set(progress.followupsAsked);
  const viewedEvidence = new Set(progress.evidenceViewed);
  const unlockedEvidence = new Set(progress.evidenceUnlocked);
  const usedHints = new Set(progress.hintsUsed);
  const profile = profileFor(progress.caseLength);

  return {
    version: content.version,
    app_meta: content.app_meta,
    mode: content.mode,
    caseProfile: {
      key: progress.caseLength,
      ...profile,
      evidenceIds: undefined,
      availableLeadIds: undefined,
    },
    caseProfiles: Object.fromEntries(
      Object.entries(CASE_PROFILES).map(([key, value]) => [key, {
        label: value.label,
        description: value.description,
      }]),
    ),
    chapters: content.chapters.map((chapter) => {
      const accessible = chapter.index <= chapterIndex(progress.chapter);
      return {
        id: chapter.id,
        title: chapter.title,
        estimated: chapter.estimated,
        index: chapter.index,
        min_seconds: effectiveMinimumSeconds(chapter.id, progress.caseLength),
        ...(accessible ? {
          intro_headline: chapter.intro_headline,
          intro_body: chapter.intro_body,
          completion_button: chapter.completion_button,
        } : {}),
      };
    }),
    leads: chapterIndex(progress.chapter) >= chapterIndex('C03')
      ? content.leads
        .filter((lead) => profile.availableLeadIds.includes(lead.id))
        .map((lead) => ({
          id: lead.id,
          title: lead.title,
          description: lead.description,
          evidence: lead.evidence,
          suspects: lead.suspects,
        }))
      : [],
    suspects: content.suspects.map((suspect) => ({
      id: suspect.id,
      name: suspect.name,
      label: suspect.label,
      role: suspect.role,
      public: suspect.public,
      initial: suspect.initial,
      notebook_tags: suspect.notebook_tags,
      questions: suspect.questions.map((question) => {
        const key = `${suspect.id}:${question.id}`;
        return {
          id: question.id,
          q: question.q,
          asked: askedQuestions.has(key),
          ...(askedQuestions.has(key) ? { a: question.a } : {}),
        };
      }),
      followups: suspect.followups.map((followup) => {
        const key = `${suspect.id}:${followup.id}`;
        const unlocked = followup.requires.every((id) => viewedEvidence.has(id));
        return {
          id: followup.id,
          requires: followup.requires,
          unlocked,
          asked: askedFollowups.has(key),
          ...(unlocked ? { q: followup.q } : {}),
          ...(askedFollowups.has(key) ? { a: followup.a, impact: followup.impact } : {}),
        };
      }),
    })),
    evidence: content.evidence
      .filter((evidence) => evidenceAvailable(progress.caseLength, evidence.id))
      .map((evidence) => {
        const unlocked = unlockedEvidence.has(evidence.id);
        return unlocked ? {
          id: evidence.id,
          title: evidence.title,
          chapter: evidence.chapter,
          kind: evidence.kind,
          unlocked: true,
          viewed: viewedEvidence.has(evidence.id),
          summary: evidence.summary,
          content: evidence.content,
          details: evidence.details,
        } : {
          id: evidence.id,
          title: 'Locked Evidence',
          chapter: evidence.chapter,
          kind: 'locked',
          unlocked: false,
          viewed: false,
        };
      }),
    notebook: {
      tabs: content.notebook.tabs,
      quick_actions: content.notebook.quick_actions,
      suggested_auto_entries: [
        progress.evidenceViewed.includes('E11') ? '8:31 p.m. - Official group photo captured.' : null,
        progress.evidenceViewed.includes('E05') ? '8:34-8:39 p.m. - Estimated murder window.' : null,
        progress.evidenceViewed.includes('E05') ? 'A bronze trophy is missing from the display.' : null,
        progress.evidenceViewed.includes('E07') ? "Blake's phone draft names M.T. and an original file." : null,
        progress.questionsAsked.includes('S01:Q3') ? 'Morgan claims the photo covered the murder window.' : null,
      ].filter(Boolean),
    },
    hints: {
      global_rules: {
        levels: content.hints.global_rules.levels,
        penalty_per_hint: content.hints.global_rules.penalty_per_hint,
        never_lock_player: true,
        accessibility: content.hints.global_rules.accessibility,
      },
      case_hints: content.hints.case_hints.map((hint) => ({
        id: hint.id,
        topic: hint.topic,
        revealed: Object.fromEntries(
          [1, 2, 3]
            .filter((level) => usedHints.has(`${hint.id}:${level}`))
            .map((level) => [level, hint[`h${level}`]]),
        ),
      })),
    },
    finale: {
      accusation_form: {
        q1: {
          label: content.finale.accusation_form.q1.label,
          type: 'single_select',
        },
        q2: {
          label: content.finale.accusation_form.q2.label,
          type: 'single_select',
          options: ANSWER_OPTIONS.q2,
        },
        q3: {
          label: content.finale.accusation_form.q3.label,
          type: 'single_select',
          options: ANSWER_OPTIONS.q3,
        },
        q4: {
          label: content.finale.accusation_form.q4.label,
          type: 'single_select',
          options: ANSWER_OPTIONS.q4,
        },
        q5: {
          label: content.finale.accusation_form.q5.label,
          type: 'short_text',
        },
      },
      confirmation: content.finale.confirmation,
      rankings: content.finale.rankings,
    },
    timedRelease: {
      evidenceId: 'E13',
      secondsRequired: profile.timedEvidenceSeconds,
      secondsRemaining: progress.chapter === 'C04'
        ? Math.max(0, Math.ceil(profile.timedEvidenceSeconds - Number(progress.timer?.activeSeconds || 0)))
        : null,
    },
  };
}

async function hydratePlayer(player) {
  const progress = prepareProgress(player);
  const saved = await db.savePlayerState(player.id, progress, player.case_length);
  return { player: saved, progress };
}

function validateRegistration(body) {
  const sessionCode = normalizeSessionCode(body.sessionCode || 'OURMOMS');
  const name = String(body.name || '').trim();
  const mobile = normalizeMobile(body.mobile);
  const pin = String(body.pin || '');
  const playMode = String(body.playMode || 'individual');
  const teamName = String(body.teamName || '').trim();
  const caseLength = String(body.caseLength || 'standard');

  if (sessionCode.length < 4) return { error: 'Enter a valid event code.' };
  if (!name || name.length > 40) return { error: 'Enter a first name or alias up to 40 characters.' };
  if (mobile.length !== 10) return { error: 'Enter a valid 10-digit mobile number.' };
  if (!/^\d{4}$/.test(pin)) return { error: 'Create a 4-digit PIN.' };
  if (!PLAY_MODES.has(playMode)) return { error: 'Choose individual or table-team play.' };
  if (!CASE_LENGTHS.has(caseLength)) return { error: 'Choose Quick, Standard, or Extended case length.' };
  if (playMode === 'team' && (!teamName || teamName.length > 50)) {
    return { error: 'Enter a team name up to 50 characters.' };
  }
  return { sessionCode, name, mobile, pin, playMode, teamName, caseLength };
}

function validateAccusationAnswers(answers) {
  if (!answers || typeof answers !== 'object') return 'Complete the accusation form.';
  if (!SUSPECT_IDS.has(answers.q1)) return 'Choose a valid suspect.';
  if (!ANSWER_OPTIONS.q2.includes(answers.q2)) return 'Choose a valid motive.';
  if (!ANSWER_OPTIONS.q3.includes(answers.q3)) return 'Choose a valid weapon.';
  if (!ANSWER_OPTIONS.q4.includes(answers.q4)) return 'Choose a valid alibi clue.';
  if (String(answers.q5 || '').length > 1000) return 'Keep the explanation under 1,000 characters.';
  return null;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, db: process.env.DATABASE_URL ? 'postgres' : 'local-json', version: 2 });
});

app.get('/api/config', async (req, res) => {
  const sessionCode = normalizeSessionCode(req.query.session || 'OURMOMS');
  const session = await db.getSessionByCode(sessionCode);
  res.json({
    title: content.app_meta.title,
    subtitle: content.app_meta.subtitle,
    defaultSession: 'OURMOMS',
    session: session ? {
      code: session.code,
      title: session.title,
      venue: session.venue,
      isOpen: session.is_open,
    } : null,
    caseProfiles: Object.fromEntries(
      Object.entries(CASE_PROFILES).map(([key, value]) => [key, {
        label: value.label,
        description: value.description,
      }]),
    ),
  });
});

app.get('/api/game', authPlayer, async (req, res) => {
  const player = await db.getPlayer(req.auth.playerId);
  if (!player || player.session_id !== req.auth.sessionId) {
    return res.status(404).json({ error: 'Player not found.' });
  }
  const hydrated = await hydratePlayer(player);
  return res.json({ game: publicGameFor(hydrated.player, hydrated.progress) });
});

app.post('/api/register', async (req, res) => {
  try {
    const values = validateRegistration(req.body || {});
    if (values.error) return res.status(400).json({ error: values.error });
    const session = await db.getSessionByCode(values.sessionCode);
    if (!session) return res.status(404).json({ error: 'Event session not found.' });
    if (!session.is_open) return res.status(403).json({ error: 'Registration is currently closed.' });

    const pinHash = await bcrypt.hash(values.pin, 10);
    const player = await db.createPlayer({
      sessionId: session.id,
      name: values.name,
      mobile: values.mobile,
      pinHash,
      playMode: values.playMode,
      teamName: values.teamName.slice(0, 50),
      caseLength: values.caseLength,
      progress: initialProgress(values.caseLength),
    });
    const progress = prepareProgress(player);
    return res.json({
      token: sign({ type: 'player', playerId: player.id, sessionId: session.id }),
      session: { code: session.code, title: session.title, venue: session.venue },
      player: safePlayer(player, progress),
      game: publicGameFor(player, progress),
    });
  } catch (error) {
    return res.status(error.code === 'DUPLICATE' ? 409 : 500).json({
      error: error.message || 'Unable to register.',
    });
  }
});

app.post('/api/resume', async (req, res) => {
  const sessionCode = normalizeSessionCode(req.body?.sessionCode || 'OURMOMS');
  const mobile = normalizeMobile(req.body?.mobile);
  const pin = String(req.body?.pin || '');
  if (sessionCode.length < 4 || mobile.length !== 10 || !/^\d{4}$/.test(pin)) {
    return res.status(400).json({ error: 'Enter a valid event code, mobile number, and 4-digit PIN.' });
  }

  const key = attemptKey(req, 'player', `${sessionCode}:${mobile}`);
  if (!checkAttemptLimit(key, res)) return undefined;

  const session = await db.getSessionByCode(sessionCode);
  const player = session ? await db.findPlayerByMobile(session.id, mobile) : null;
  const valid = player && await bcrypt.compare(pin, player.pin_hash);
  if (!session || !valid) {
    recordFailedAttempt(key);
    return res.status(401).json({ error: 'Mobile number or PIN did not match.' });
  }
  clearAttempts(key);

  const hydrated = await hydratePlayer(player);
  const accusation = decorateAccusation(await db.getAccusation(player.id));
  return res.json({
    token: sign({ type: 'player', playerId: player.id, sessionId: session.id }),
    session: { code: session.code, title: session.title, venue: session.venue },
    player: safePlayer(hydrated.player, hydrated.progress),
    game: publicGameFor(hydrated.player, hydrated.progress),
    accusation,
  });
});

app.get('/api/me', authPlayer, async (req, res) => {
  const player = await db.getPlayer(req.auth.playerId);
  if (!player || player.session_id !== req.auth.sessionId) {
    return res.status(404).json({ error: 'Player not found.' });
  }
  const session = await db.getSessionById(player.session_id);
  const hydrated = await hydratePlayer(player);
  const accusation = decorateAccusation(await db.getAccusation(player.id));
  return res.json({
    session: { code: session.code, title: session.title, venue: session.venue },
    player: safePlayer(hydrated.player, hydrated.progress),
    game: publicGameFor(hydrated.player, hydrated.progress),
    accusation,
  });
});

app.put('/api/progress', authPlayer, (req, res) => {
  res.status(400).json({
    error: 'Direct progress replacement is disabled. Use validated game actions.',
  });
});

app.post('/api/action', authPlayer, async (req, res) => {
  try {
    const player = await db.getPlayer(req.auth.playerId);
    if (!player || player.session_id !== req.auth.sessionId) {
      return res.status(404).json({ error: 'Player not found.' });
    }
    if (await db.getAccusation(player.id)) {
      return res.status(409).json({ error: 'This case is complete and its final state is locked.' });
    }

    const action = String(req.body?.action || '');
    const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
    const progress = prepareProgress(player);

    switch (action) {
      case 'heartbeat':
        break;

      case 'view_evidence': {
        const evidenceId = String(payload.evidenceId || '');
        computeUnlocked(progress);
        if (!progress.evidenceUnlocked.includes(evidenceId)) {
          return res.status(403).json({ error: 'This evidence is still locked.' });
        }
        if (!progress.evidenceViewed.includes(evidenceId)) progress.evidenceViewed.push(evidenceId);
        break;
      }

      case 'open_suspect': {
        const suspectId = String(payload.suspectId || '');
        if (!SUSPECT_IDS.has(suspectId)) return res.status(400).json({ error: 'Unknown suspect.' });
        if (!progress.suspectsOpened.includes(suspectId)) progress.suspectsOpened.push(suspectId);
        break;
      }

      case 'ask_question': {
        const suspectId = String(payload.suspectId || '');
        const questionId = String(payload.questionId || '');
        const followup = Boolean(payload.followup);
        const suspect = content.suspects.find((item) => item.id === suspectId);
        if (!suspect) return res.status(400).json({ error: 'Unknown suspect.' });
        if (followup) {
          const question = suspect.followups.find((item) => item.id === questionId);
          if (!question) return res.status(400).json({ error: 'Unknown follow-up question.' });
          if (!question.requires.every((id) => progress.evidenceViewed.includes(id))) {
            return res.status(403).json({ error: 'Review the required evidence before asking this follow-up.' });
          }
          const key = `${suspectId}:${questionId}`;
          if (!progress.followupsAsked.includes(key)) progress.followupsAsked.push(key);
        } else {
          if (!suspect.questions.some((item) => item.id === questionId)) {
            return res.status(400).json({ error: 'Unknown interview question.' });
          }
          const key = `${suspectId}:${questionId}`;
          if (!progress.questionsAsked.includes(key)) progress.questionsAsked.push(key);
        }
        break;
      }

      case 'complete_lead': {
        const leadId = String(payload.leadId || '');
        const profile = profileFor(progress.caseLength);
        if (chapterIndex(progress.chapter) < chapterIndex('C03')) {
          return res.status(403).json({ error: 'Lead investigations open in Chapter 3.' });
        }
        if (!profile.availableLeadIds.includes(leadId)) {
          return res.status(400).json({ error: 'That lead is not part of this case length.' });
        }
        if (!progress.leadsCompleted.includes(leadId)) progress.leadsCompleted.push(leadId);
        break;
      }

      case 'add_note': {
        const text = String(payload.text || '').trim();
        if (!text) return res.status(400).json({ error: 'Write a note before saving.' });
        if (text.length > 500) return res.status(400).json({ error: 'Keep notes under 500 characters.' });
        if (progress.notes.length >= 100) return res.status(400).json({ error: 'Notebook limit reached.' });
        progress.notes.unshift({ id: crypto.randomUUID(), text, createdAt: nowIso() });
        break;
      }

      case 'delete_note': {
        const noteId = String(payload.noteId || '');
        progress.notes = progress.notes.filter((note) => String(note.id) !== noteId);
        break;
      }

      case 'mark_evidence': {
        const evidenceId = String(payload.evidenceId || '');
        const status = String(payload.status || '');
        if (!progress.evidenceUnlocked.includes(evidenceId)) {
          return res.status(403).json({ error: 'Unlock the evidence before marking it.' });
        }
        if (!EVIDENCE_MARKS.has(status)) return res.status(400).json({ error: 'Invalid evidence status.' });
        progress.evidenceMarks[evidenceId] = status;
        break;
      }

      case 'assess_suspect': {
        const suspectId = String(payload.suspectId || '');
        const status = String(payload.status || '');
        if (!SUSPECT_IDS.has(suspectId) || !SUSPECT_STATUSES.has(status)) {
          return res.status(400).json({ error: 'Invalid suspect assessment.' });
        }
        progress.suspectStatuses[suspectId] = status;
        break;
      }

      case 'connect_evidence': {
        const a = String(payload.a || '');
        const b = String(payload.b || '');
        if (a === b || !progress.evidenceUnlocked.includes(a) || !progress.evidenceUnlocked.includes(b)) {
          return res.status(400).json({ error: 'Choose two different unlocked evidence items.' });
        }
        const exists = progress.connections.some(
          (connection) => (connection.a === a && connection.b === b)
            || (connection.a === b && connection.b === a),
        );
        if (!exists) progress.connections.push({ a, b, createdAt: nowIso() });
        break;
      }

      case 'use_hint': {
        const hintId = String(payload.hintId || '');
        const level = Number(payload.level);
        if (!HINT_IDS.has(hintId) || ![1, 2, 3].includes(level)) {
          return res.status(400).json({ error: 'Invalid hint.' });
        }
        const key = `${hintId}:${level}`;
        if (!progress.hintsUsed.includes(key)) progress.hintsUsed.push(key);
        break;
      }

      case 'set_paused': {
        progress.paused = Boolean(payload.paused);
        progress.timer.lastActiveAt = nowIso();
        break;
      }

      case 'set_case_length': {
        const caseLength = String(payload.caseLength || '');
        if (!CASE_LENGTHS.has(caseLength)) return res.status(400).json({ error: 'Invalid case length.' });
        if (progress.chapter !== 'C00' || progress.chaptersCompleted.length > 0) {
          return res.status(409).json({ error: 'Case length can only be changed during the prologue.' });
        }
        progress.caseLength = caseLength;
        player.case_length = caseLength;
        break;
      }

      case 'complete_chapter': {
        const chapterId = String(payload.chapterId || '');
        if (chapterId !== progress.chapter || chapterId === 'C05') {
          return res.status(400).json({ error: 'Only the active investigation chapter can be completed.' });
        }
        const tasks = chapterRequirements(progress);
        const incomplete = tasks.filter((task) => !task.done).map((task) => task.text);
        const remaining = timerRemaining(progress);
        if (incomplete.length || remaining > 0) {
          return res.status(409).json({
            error: incomplete.length
              ? 'Finish the chapter objectives first.'
              : `Continue investigating for about ${remaining} more second(s).`,
            incomplete,
            minimumSecondsRemaining: remaining,
          });
        }
        if (!progress.chaptersCompleted.includes(chapterId)) progress.chaptersCompleted.push(chapterId);
        const next = content.chapters[chapterIndex(chapterId) + 1];
        if (next) {
          progress.chapter = next.id;
          progress.timer = createTimer(next.id);
        }
        break;
      }

      default:
        return res.status(400).json({ error: 'Unknown game action.' });
    }

    computeUnlocked(progress);
    progress.updatedAt = nowIso();
    const saved = await db.savePlayerState(player.id, progress, player.case_length);
    return res.json({
      player: safePlayer(saved, progress),
      game: publicGameFor(saved, progress),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to save game action.' });
  }
});

app.post('/api/accusation', authPlayer, async (req, res) => {
  try {
    const player = await db.getPlayer(req.auth.playerId);
    if (!player || player.session_id !== req.auth.sessionId) {
      return res.status(404).json({ error: 'Player not found.' });
    }
    if (await db.getAccusation(player.id)) {
      return res.status(409).json({ error: 'Your final accusation has already been submitted.' });
    }

    const progress = prepareProgress(player);
    if (progress.chapter !== 'C05' || !progress.chaptersCompleted.includes('C04')) {
      return res.status(403).json({ error: 'Complete the investigation before submitting an accusation.' });
    }
    const answers = req.body?.answers || {};
    const validationError = validateAccusationAnswers(answers);
    if (validationError) return res.status(400).json({ error: validationError });

    const score = scoreAnswers(answers, progress.hintsUsed);
    const rankName = rankFor(score);
    const accusation = await db.createAccusation(player.id, answers, score, rankName);
    if (!progress.chaptersCompleted.includes('C05')) progress.chaptersCompleted.push('C05');
    progress.updatedAt = nowIso();
    await db.savePlayerState(player.id, progress, player.case_length);
    return res.json({
      accusation: decorateAccusation(accusation),
      player: safePlayer(player, progress),
    });
  } catch (error) {
    return res.status(error.code === 'DUPLICATE' ? 409 : 500).json({
      error: error.message || 'Unable to submit accusation.',
    });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  const sessionCode = normalizeSessionCode(req.query.session || 'OURMOMS');
  const session = await db.getSessionByCode(sessionCode);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  return res.json({ leaderboard: await db.leaderboard(session.id) });
});

app.post('/api/host/login', async (req, res) => {
  const sessionCode = normalizeSessionCode(req.body?.sessionCode || 'OURMOMS');
  const pin = String(req.body?.pin || '');
  if (sessionCode.length < 4 || !/^\d{4,12}$/.test(pin)) {
    return res.status(400).json({ error: 'Enter a valid session code and host PIN.' });
  }
  const key = attemptKey(req, 'host', sessionCode);
  if (!checkAttemptLimit(key, res)) return undefined;
  if (!secureEqual(pin, HOST_PIN)) {
    recordFailedAttempt(key);
    return res.status(401).json({ error: 'Incorrect host PIN.' });
  }
  const session = await db.getSessionByCode(sessionCode);
  if (!session) {
    recordFailedAttempt(key);
    return res.status(404).json({ error: 'Session not found.' });
  }
  clearAttempts(key);
  return res.json({
    token: sign({ type: 'host', sessionId: session.id }, 12),
    session,
  });
});

app.get('/api/host/session', authHost, async (req, res) => {
  const session = await db.getSessionById(req.auth.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  const players = await db.listPlayers(session.id);
  return res.json({
    session,
    players: players.map(safeHostPlayer),
    leaderboard: await db.leaderboard(session.id),
  });
});

app.post('/api/host/session', authHost, async (req, res) => {
  const code = normalizeSessionCode(req.body?.code);
  const pacingMode = String(req.body?.pacingMode || 'logical');
  if (code.length < 4) return res.status(400).json({ error: 'Session code must be at least 4 characters.' });
  if (!PACING_MODES.has(pacingMode)) return res.status(400).json({ error: 'Invalid pacing mode.' });
  try {
    const session = await db.createSession({
      code,
      title: String(req.body?.title || content.app_meta.title).trim().slice(0, 100),
      venue: String(req.body?.venue || content.app_meta.venue).trim().slice(0, 120),
      pacingMode,
    });
    return res.json({ session });
  } catch (error) {
    return res.status(error.code === 'DUPLICATE' ? 409 : 500).json({
      error: error.message || 'Unable to create session.',
    });
  }
});

app.post('/api/host/reset-player', authHost, async (req, res) => {
  const player = await db.getPlayer(req.body?.playerId);
  if (!player || player.session_id !== req.auth.sessionId) {
    return res.status(404).json({ error: 'Player not found.' });
  }
  await db.resetPlayer(player.id, initialProgress(player.case_length));
  return res.json({ ok: true });
});

app.post('/api/host/open', authHost, async (req, res) => {
  if (typeof req.body?.isOpen !== 'boolean') {
    return res.status(400).json({ error: 'isOpen must be true or false.' });
  }
  const session = await db.setSessionOpen(req.auth.sessionId, req.body.isOpen);
  return res.json({ session });
});

app.get('/api/host/qr', authHost, async (req, res) => {
  const session = await db.getSessionById(req.auth.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const url = `${base}/?session=${encodeURIComponent(session.code)}`;
  return res.json({
    url,
    dataUrl: await QRCode.toDataURL(url, { width: 500, margin: 2 }),
  });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

app.use((req, res, next) => {
  if (req.method === 'GET') {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  return next();
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

db.init()
  .then(() => app.listen(PORT, () => {
    console.log(`Reunion mystery app running on http://localhost:${PORT}`);
  }))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
