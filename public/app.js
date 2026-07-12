const API = '';
const params = new URLSearchParams(location.search);
const rememberedSession = localStorage.getItem('reunionLastSession');

const state = {
  content: null,
  token: localStorage.getItem('reunionToken'),
  player: null,
  accusation: null,
  session: params.get('session') || rememberedSession || 'OURMOMS',
  view: 'home',
  modal: null,
  search: '',
  hostToken: sessionStorage.getItem('hostToken'),
  hostData: null,
};

const $ = (selector) => document.querySelector(selector);
const app = $('#app');

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('');
}

function toast(text) {
  const element = $('#toast');
  if (!element) return;
  element.textContent = text;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 2400);
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token && !options.host) headers.Authorization = `Bearer ${state.token}`;
  if (options.host && state.hostToken) headers.Authorization = `Bearer ${state.hostToken}`;
  const response = await fetch(API + path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function syncSession(code) {
  const normalized = String(code || 'OURMOMS').toUpperCase();
  state.session = normalized;
  localStorage.setItem('reunionLastSession', normalized);
  const url = new URL(location.href);
  url.searchParams.set('session', normalized);
  history.replaceState({}, '', url);
}

function applyPlayerPayload(payload) {
  if (payload.session?.code) syncSession(payload.session.code);
  if (payload.player) state.player = payload.player;
  if (payload.game) state.content = payload.game;
  if (Object.prototype.hasOwnProperty.call(payload, 'accusation')) state.accusation = payload.accusation;
}

function progress() {
  return state.player?.progress || {};
}

function hasEvidence(id) {
  return state.content?.evidence?.some((evidence) => evidence.id === id && evidence.unlocked);
}

function viewedEvidence(id) {
  return progress().evidenceViewed?.includes(id);
}

function currentChapter() {
  return state.content?.chapters?.find((chapter) => chapter.id === progress().chapter)
    || state.content?.chapters?.[0];
}

function currentChapterIndex() {
  return state.content?.chapters?.findIndex((chapter) => chapter.id === progress().chapter) ?? 0;
}

function overallPct() {
  const total = Math.max(1, state.content?.chapters?.length || 6);
  const completed = Math.min(total, progress().chaptersCompleted?.length || 0);
  return Math.min(100, Math.round((completed / total) * 100));
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.ceil(Number(seconds) || 0));
  if (value < 60) return `${value}s`;
  const minutes = Math.floor(value / 60);
  const remainder = value % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

async function gameAction(action, payload = {}, options = {}) {
  try {
    const result = await api('/api/action', {
      method: 'POST',
      body: JSON.stringify({ action, payload }),
    });
    applyPlayerPayload(result);
    if (!options.silent) render();
    return result;
  } catch (error) {
    if (error.status === 401) {
      localStorage.removeItem('reunionToken');
      state.token = null;
      state.player = null;
      state.content = null;
      render();
    }
    if (!options.silent) toast(error.message);
    throw error;
  }
}

function nav(active) {
  const items = [
    ['home', '⌂', 'Home'],
    ['suspects', '♟', 'Suspects'],
    ['evidence', '▤', 'Evidence'],
    ['notebook', '✎', 'Notes'],
    ['hints', '?', 'Hints'],
  ];
  return `<nav class="bottomnav">${items.map(([view, icon, label]) => `
    <button class="${active === view ? 'active' : ''}" onclick="go('${view}')">
      <i>${icon}</i>${label}
    </button>
  `).join('')}</nav>`;
}

function shell(inner, active = state.view) {
  return `<div class="app">
    <header class="topbar">
      <div class="toprow">
        <div class="brand">
          <div class="mini-crest">06</div>
          <div>
            <h1>Reunion at Our Mom's</h1>
            <p>${esc(state.player.displayName)} · ${esc(state.session)}</p>
          </div>
        </div>
        <button class="iconbtn" aria-label="${progress().paused ? 'Resume' : 'Pause'} case" onclick="togglePause()">
          ${progress().paused ? '▶' : 'Ⅱ'}
        </button>
      </div>
      <div class="progressline"><span style="width:${overallPct()}%"></span></div>
    </header>
    <main class="content">${inner}</main>
    ${nav(active)}
  </div>${renderModal()}`;
}

function go(view) {
  state.view = view;
  state.modal = null;
  render();
  window.scrollTo(0, 0);
}

function chapterAccessible(chapter) {
  return chapter.index <= currentChapterIndex()
    || progress().chaptersCompleted?.includes(chapter.id);
}

function renderHome() {
  const chapter = currentChapter();
  const p = progress();
  return shell(`
    <section class="welcome-card">
      <span class="badge">${esc(p.caseLength || 'standard')} case</span>
      <h2>Welcome, ${esc(state.player.displayName)}</h2>
      <p>${p.paused ? 'Your case is paused. Resume when your table is ready.' : esc(chapter.intro_headline)}</p>
      <button class="btn gold" onclick="go('${chapter.id === 'C05' ? 'accuse' : 'chapter'}')">
        ${chapter.id === 'C05' ? 'Make Final Accusation' : 'Continue Investigation'}
      </button>
    </section>
    <div class="homegrid">
      <button class="homebtn" onclick="go('chapter')"><b>Current Chapter</b><span>${esc(chapter.title)}</span></button>
      <button class="homebtn" onclick="go('suspects')"><b>Suspects</b><span>${p.suspectsOpened?.length || 0}/12 reviewed</span></button>
      <button class="homebtn" onclick="go('evidence')"><b>Evidence</b><span>${p.evidenceViewed?.length || 0} examined</span></button>
      <button class="homebtn" onclick="go('notebook')"><b>Notebook</b><span>${p.notes?.length || 0} notes saved</span></button>
      <button class="homebtn" onclick="go('hints')"><b>Hints</b><span>${p.hintsUsed?.length || 0} used · -${(p.hintsUsed?.length || 0) * 2} pts</span></button>
      <button class="homebtn" onclick="showLeaderboard()"><b>Leaderboard</b><span>See completed cases</span></button>
    </div>
    <h2 class="section-title">Case Progress</h2>
    ${state.content.chapters.map((item) => `
      <div class="chapter-card ${chapterAccessible(item) ? '' : 'locked'}">
        <div class="chapter-head">
          <div><h3>${esc(item.title)}</h3><p class="muted small">${esc(item.estimated)}</p></div>
          <span class="badge ${p.chaptersCompleted?.includes(item.id) ? 'good' : item.id === p.chapter ? 'warn' : ''}">
            ${p.chaptersCompleted?.includes(item.id) ? 'Complete' : item.id === p.chapter ? 'Active' : 'Locked'}
          </span>
        </div>
      </div>
    `).join('')}
  `, 'home');
}

function chapterExtras(chapter) {
  if (chapter.id === 'C00') {
    return `<div class="card">
      <h3>Choose case length</h3>
      <p class="muted small">Each mode now changes required interviews, lead paths, evidence depth, and minimum pacing.</p>
      <div class="action-row">${Object.entries(state.content.caseProfiles).map(([key, profile]) => `
        <button class="chip ${progress().caseLength === key ? 'selected' : ''}" onclick="chooseLength('${key}')">${esc(profile.label)}</button>
      `).join('')}</div>
      <p class="small muted">${esc(state.content.caseProfiles[progress().caseLength]?.description || '')}</p>
    </div>
    <div class="action-row">
      <button class="btn secondary" onclick="openEvidence('E01')">Open Case Introduction</button>
      <button class="btn secondary" onclick="openEvidence('E02')">Open Directory</button>
    </div>`;
  }
  if (chapter.id === 'C01') {
    return `<div class="grid2">
      <button class="btn secondary" onclick="openEvidence('E03')">Group Photo</button>
      <button class="btn secondary" onclick="openEvidence('E04')">Blake's Remarks</button>
    </div>`;
  }
  if (chapter.id === 'C02') {
    return `<div class="grid2">
      <button class="btn secondary" onclick="openEvidence('E05')">Crime Scene</button>
      <button class="btn secondary" onclick="go('suspects')">Interview Suspects</button>
    </div>`;
  }
  if (chapter.id === 'C03') {
    return `<h3>Choose leads to investigate</h3>${state.content.leads.map((lead) => `
      <div class="lead ${progress().leadsCompleted?.includes(lead.id) ? 'done' : ''}">
        <h3>${esc(lead.title)}</h3>
        <p>${esc(lead.description)}</p>
        <button class="btn ${progress().leadsCompleted?.includes(lead.id) ? 'secondary' : ''}" onclick="completeLead('${lead.id}')">
          ${progress().leadsCompleted?.includes(lead.id) ? 'Lead Completed' : 'Investigate Lead'}
        </button>
      </div>
    `).join('')}`;
  }
  if (chapter.id === 'C04') {
    const timed = state.content.timedRelease;
    return `<div class="grid2">
      <button class="btn secondary" onclick="openEvidence('E10')">Scholarship Envelope</button>
      <button class="btn secondary" ${hasEvidence('E11') ? '' : 'disabled'} onclick="openEvidence('E11')">Photo Metadata</button>
    </div>
    <div class="action-row">
      <button class="btn secondary" ${hasEvidence('E12') ? '' : 'disabled'} onclick="openEvidence('E12')">Blake's Letter</button>
      <button class="btn secondary" onclick="openSuspect('S01')">Interview Morgan</button>
    </div>
    ${timed?.secondsRemaining > 0 ? `<div class="card"><p class="small muted">A dramatic evidence release becomes available after about ${formatDuration(timed.secondsRemaining)} of active Chapter 4 investigation.</p></div>` : ''}`;
  }
  if (chapter.id === 'C05') {
    return '<button class="btn gold" onclick="go(\'accuse\')">Open Final Accusation</button>';
  }
  return '';
}

function renderChapter() {
  const chapter = currentChapter();
  const tasks = progress().chapterTasks || [];
  const remaining = progress().minimumSecondsRemaining || 0;
  const canComplete = tasks.every((task) => task.done) && remaining === 0;
  return shell(`
    <span class="badge">Chapter ${chapter.index}</span>
    <h2 class="section-title">${esc(chapter.title)}</h2>
    <p>${esc(chapter.intro_body)}</p>
    <div class="card">
      <h3>Objectives</h3>
      <ul class="tasks">${tasks.map((task) => `<li class="${task.done ? 'done' : ''}">${esc(task.text)}</li>`).join('')}</ul>
      ${remaining > 0 ? `<p class="small muted">Minimum active investigation remaining: <b>${formatDuration(remaining)}</b>. Paused or long-idle time does not count.</p>` : ''}
    </div>
    ${chapterExtras(chapter)}
    <div style="height:12px"></div>
    ${chapter.id !== 'C05' ? `
      <button class="btn" ${canComplete ? '' : 'disabled'} onclick="completeChapter('${chapter.id}')">
        ${esc(chapter.completion_button || 'Complete Chapter')}
      </button>
    ` : ''}
  `, 'chapter');
}

function renderSuspects() {
  const query = state.search.toLowerCase();
  const suspects = state.content.suspects.filter((suspect) => (
    `${suspect.name} ${suspect.label} ${suspect.role}`.toLowerCase().includes(query)
  ));
  return shell(`
    <h2 class="section-title">Suspects</h2>
    <p class="muted">Every required interview is available. Stronger follow-ups are sent only after their evidence is actually unlocked.</p>
    <input class="search" placeholder="Search suspects" value="${esc(state.search)}" oninput="state.search=this.value;render()">
    <div class="suspect-grid">${suspects.map((suspect) => `
      <button class="suspect" onclick="openSuspect('${suspect.id}')">
        <div class="avatar">${initials(suspect.name)}</div>
        <div><h3>${esc(suspect.name)}</h3><p>${esc(suspect.label)} · ${esc(suspect.role)}</p></div><span>›</span>
      </button>
    `).join('')}</div>
  `, 'suspects');
}

function evidenceIcon(kind) {
  return {
    intro: '★', directory: '12', photo: '▣', transcript: '“”', report: '⚠', note: '✎',
    phone: '▯', finance: '$', document: '§', metadata: '8:31', letter: '✉', physical: '◆', supplemental: '+',
  }[kind] || 'E';
}

function renderEvidence() {
  return shell(`
    <h2 class="section-title">Evidence Library</h2>
    <p class="muted">Essential evidence is released logically. Some dramatic evidence also has a short active-play delay. Nothing expires.</p>
    <div class="evidence-grid">${state.content.evidence.map((evidence) => `
      <button class="evidence-card ${evidence.unlocked ? '' : 'locked'}" onclick="openEvidence('${evidence.id}')">
        <div class="evidence-visual">${evidence.unlocked ? evidenceIcon(evidence.kind) : '🔒'}</div>
        <div class="pad"><span class="badge">${evidence.id}</span><h3>${esc(evidence.title)}</h3>
          <p>${evidence.unlocked ? esc(evidence.summary) : 'Continue investigating to unlock.'}</p>
        </div>
      </button>
    `).join('')}</div>
  `, 'evidence');
}

function renderNotebook() {
  const p = progress();
  const unlocked = state.content.evidence.filter((evidence) => evidence.unlocked);
  return shell(`
    <h2 class="section-title">Detective Notebook</h2>
    <div class="notebox"><textarea id="newnote" maxlength="500" placeholder="Write a theory, contradiction, or question..."></textarea><button class="btn" onclick="addNote()">Save Note</button></div>
    <div class="card"><h3>Suggested timeline entries</h3>${state.content.notebook.suggested_auto_entries.map((entry) => `
      <button class="chip" onclick='addSuggested(${JSON.stringify(entry)})'>+ ${esc(entry)}</button>
    `).join('')}</div>
    <div class="card"><h3>Connect Evidence</h3>
      <div class="grid2">
        <select id="connA">${unlocked.map((evidence) => `<option value="${evidence.id}">${evidence.id} · ${esc(evidence.title)}</option>`).join('')}</select>
        <select id="connB">${unlocked.map((evidence) => `<option value="${evidence.id}">${evidence.id} · ${esc(evidence.title)}</option>`).join('')}</select>
      </div><br>
      <button class="btn secondary" onclick="connectEvidence()">Create Connection</button>
      ${(p.connections || []).map((connection) => `<p class="small"><b>${connection.a}</b> ↔ <b>${connection.b}</b></p>`).join('')}
    </div>
    <h3>Your Notes</h3>
    ${(p.notes || []).length ? p.notes.map((note) => `
      <div class="notebox"><button class="close" onclick="deleteNote('${esc(note.id)}')">×</button><p>${esc(note.text)}</p><span class="small muted">${new Date(note.createdAt).toLocaleString()}</span></div>
    `).join('') : '<p class="muted">No notes yet.</p>'}
  `, 'notebook');
}

function renderHints() {
  const penalty = state.content.hints.global_rules.penalty_per_hint;
  return shell(`
    <h2 class="section-title">Hints</h2>
    <p class="muted">Each revealed hint costs ${penalty} points. Hint usage is permanently recorded by the game server.</p>
    ${state.content.hints.case_hints.map((hint) => `
      <div class="hint"><h3>${esc(hint.topic)}</h3>
        ${[1, 2, 3].map((level) => hint.revealed?.[level]
          ? `<p><b>Hint ${level}:</b> ${esc(hint.revealed[level])}</p>`
          : `<button class="chip" onclick="useHint('${hint.id}',${level})">Reveal Hint ${level} (-${penalty})</button>`).join('')}
      </div>
    `).join('')}
  `, 'hints');
}

function optionList(values) {
  return values.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
}

function renderAccuse() {
  if (state.accusation) return renderResult();
  const form = state.content.finale.accusation_form;
  return shell(`
    <h2 class="section-title">Final Accusation</h2>
    <p>${esc(state.content.finale.confirmation)}</p>
    <form onsubmit="submitAccusation(event)">
      <div class="field"><label>${esc(form.q1.label)}</label><select name="q1" required><option value="">Choose suspect</option>${state.content.suspects.map((suspect) => `<option value="${suspect.id}">${esc(suspect.name)}</option>`).join('')}</select></div>
      <div class="field"><label>${esc(form.q2.label)}</label><select name="q2" required><option value="">Choose motive</option>${optionList(form.q2.options)}</select></div>
      <div class="field"><label>${esc(form.q3.label)}</label><select name="q3" required><option value="">Choose weapon</option>${optionList(form.q3.options)}</select></div>
      <div class="field"><label>${esc(form.q4.label)}</label><select name="q4" required><option value="">Choose clue</option>${optionList(form.q4.options)}</select></div>
      <div class="field"><label>${esc(form.q5.label)}</label><textarea name="q5" maxlength="1000" rows="5" placeholder="Explain what happened..."></textarea></div>
      <button class="btn gold" type="submit">Lock Final Accusation</button>
    </form>
  `, 'accuse');
}

function renderResult() {
  const result = state.accusation;
  const solution = result.solved ? result.reveal : result.fullSolution;
  return shell(`
    <div class="reveal">
      <span class="badge ${result.solved ? 'good' : 'warn'}">${result.solved ? 'Case solved' : 'Case completed'}</span>
      <h2 class="section-title">${esc(result.reveal.headline)}</h2>
      <div class="score">${result.score}</div><div class="rank">${esc(result.rankName)}</div>
      <p>${esc(result.reveal.body)}</p>
      ${!result.solved ? `<h3>Full Solution</h3><p>${esc(solution.body)}</p>` : ''}
      ${solution.proof ? `<ul>${solution.proof.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}
      <h3>Morgan's confession</h3><div class="quote">${esc(result.confession)}</div>
      <div class="action-row"><button class="btn" onclick="showLeaderboard()">View Leaderboard</button><button class="btn secondary" onclick="exitCase()">Exit Case</button></div>
    </div>
  `, 'accuse');
}

function renderModal() {
  if (!state.modal) return '';
  if (state.modal.type === 'suspect') {
    const suspect = state.content.suspects.find((item) => item.id === state.modal.id);
    const status = progress().suspectStatuses?.[suspect.id];
    return `<div class="modalback" onclick="if(event.target===this){state.modal=null;render()}"><div class="modal">
      <button class="close" onclick="state.modal=null;render()">×</button>
      <div class="avatar">${initials(suspect.name)}</div><h2 class="section-title">${esc(suspect.name)}</h2><span class="badge">${esc(suspect.label)}</span>
      <p><b>${esc(suspect.role)}</b></p><p>${esc(suspect.public)}</p><div class="quote">${esc(suspect.initial)}</div>
      <h3>Interview questions</h3>
      ${suspect.questions.map((question) => `<div class="question"><button onclick="ask('${suspect.id}','${question.id}',false)">${question.asked ? '✓ ' : ''}${esc(question.q)}</button>${question.asked ? `<div class="answer">${esc(question.a)} <button class="chip" onclick='addSuggested(${JSON.stringify(`${suspect.name}: ${question.a}`)})'>Save to notebook</button></div>` : ''}</div>`).join('')}
      <h3>Evidence follow-ups</h3>
      ${suspect.followups.map((followup) => followup.unlocked
        ? `<div class="question"><button onclick="ask('${suspect.id}','${followup.id}',true)">${followup.asked ? '✓ ' : ''}${esc(followup.q)}</button>${followup.asked ? `<div class="answer">${esc(followup.a)}<p class="small"><b>Impact:</b> ${esc(followup.impact)}</p></div>` : ''}</div>`
        : `<div class="lockedq">🔒 Review ${followup.requires.join(' + ')} to unlock a follow-up.</div>`).join('')}
      <h3>Your assessment</h3><div class="action-row">${['unknown', 'suspicious', 'cleared'].map((value) => `<button class="chip ${status === value ? 'selected' : ''}" onclick="assessSuspect('${suspect.id}','${value}')">${value}</button>`).join('')}</div>
    </div></div>`;
  }
  if (state.modal.type === 'evidence') {
    const evidence = state.content.evidence.find((item) => item.id === state.modal.id);
    const mark = progress().evidenceMarks?.[evidence.id];
    return `<div class="modalback" onclick="if(event.target===this){state.modal=null;render()}"><div class="modal">
      <button class="close" onclick="state.modal=null;render()">×</button><span class="badge">${evidence.id} · ${evidence.chapter}</span>
      <h2 class="section-title">${esc(evidence.title)}</h2><div class="detail-visual">${evidenceIcon(evidence.kind)}\n${esc(evidence.title)}</div>
      <p><b>${esc(evidence.summary)}</b></p><div class="quote">${esc(evidence.content)}</div>
      ${evidence.details?.length ? `<ul>${evidence.details.map((detail) => `<li>${esc(detail)}</li>`).join('')}</ul>` : ''}
      <div class="action-row">${['important', 'explained', 'red-herring'].map((value) => `<button class="chip ${mark === value ? 'selected' : ''}" onclick="markEvidence('${evidence.id}','${value}')">${value}</button>`).join('')}</div>
      <button class="btn secondary" onclick='addSuggested(${JSON.stringify(`${evidence.id} — ${evidence.summary}`)})'>Save to notebook</button>
    </div></div>`;
  }
  if (state.modal.type === 'leaderboard') {
    return `<div class="modalback" onclick="if(event.target===this){state.modal=null;render()}"><div class="modal">
      <button class="close" onclick="state.modal=null;render()">×</button><h2 class="section-title">Leaderboard</h2>
      ${state.modal.data.length ? state.modal.data.map((entry) => `<div class="card"><div class="chapter-head"><div><h3>#${entry.place} ${esc(entry.name)}</h3><p class="muted">${esc(entry.rank)}</p></div><span class="badge good">${entry.score} pts</span></div></div>`).join('') : '<p class="muted">No completed cases yet.</p>'}
    </div></div>`;
  }
  return '';
}

function renderPlayer() {
  if (progress().paused && state.view !== 'home') state.view = 'home';
  if (state.view === 'home') return renderHome();
  if (state.view === 'chapter') return renderChapter();
  if (state.view === 'suspects') return renderSuspects();
  if (state.view === 'evidence') return renderEvidence();
  if (state.view === 'notebook') return renderNotebook();
  if (state.view === 'hints') return renderHints();
  if (state.view === 'accuse') return renderAccuse();
  return renderHome();
}

function joinForm() {
  return `<form onsubmit="registerPlayer(event)">
    <div class="field"><label>Event code</label><input name="sessionCode" value="${esc(state.session)}" minlength="4" maxlength="12" required></div>
    <div class="field"><label>First name or alias</label><input name="name" maxlength="40" required></div>
    <div class="field"><label>Mobile number</label><input name="mobile" inputmode="tel" placeholder="(225) 555-0123" required></div>
    <div class="field"><label>Create 4-digit PIN</label><input name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required></div>
    <div class="grid2"><div class="field"><label>Play mode</label><select name="playMode" onchange="document.querySelector('#teamField').style.display=this.value==='team'?'block':'none'"><option value="individual">Individual</option><option value="team">Table team</option></select></div>
    <div class="field"><label>Case length</label><select name="caseLength"><option value="quick">Quick</option><option value="standard" selected>Standard</option><option value="extended">Extended</option></select></div></div>
    <div class="field" id="teamField" style="display:none"><label>Team name</label><input name="teamName" maxlength="50"></div>
    <label class="checkline"><input type="checkbox" required><span>I understand this is fictional and agree not to publicly share the final solution.</span></label>
    <div id="formerror"></div><br><button class="btn gold" type="submit" style="width:100%">Register and Enter</button>
  </form>`;
}

function resumeForm() {
  return `<form onsubmit="resumePlayer(event)">
    <div class="field"><label>Event code</label><input name="sessionCode" value="${esc(state.session)}" minlength="4" maxlength="12" required></div>
    <div class="field"><label>Mobile number</label><input name="mobile" inputmode="tel" required></div>
    <div class="field"><label>4-digit PIN</label><input name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required></div>
    <div id="formerror"></div><button class="btn" type="submit" style="width:100%">Return to Investigation</button>
  </form>`;
}

function renderLanding() {
  app.innerHTML = `<div class="shell"><div class="landing"><div class="hero"><div class="crest">06</div><div class="tag">The Class of 2006</div><h1>Reunion at<br>Our Mom's</h1><p>One last secret. One dead class president. Your table solves the case.</p></div>
    <div class="panel"><div class="tabs"><button id="joinTab" class="active" onclick="tab('join')">Join Case</button><button id="resumeTab" onclick="tab('resume')">Resume</button></div><div id="formarea">${joinForm()}</div></div>
    <p class="small" style="text-align:center;color:#d8c7ad">Self-guided restaurant play · Pause anytime · All clues included</p></div></div>`;
}

function tab(value) {
  $('#joinTab').classList.toggle('active', value === 'join');
  $('#resumeTab').classList.toggle('active', value === 'resume');
  $('#formarea').innerHTML = value === 'join' ? joinForm() : resumeForm();
}

async function registerPlayer(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  try {
    const result = await api('/api/register', { method: 'POST', body: JSON.stringify(data) });
    state.token = result.token;
    localStorage.setItem('reunionToken', result.token);
    applyPlayerPayload(result);
    render();
  } catch (error) {
    $('#formerror').innerHTML = `<div class="error">${esc(error.message)}</div>`;
  }
}

async function resumePlayer(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  try {
    const result = await api('/api/resume', { method: 'POST', body: JSON.stringify(data) });
    state.token = result.token;
    localStorage.setItem('reunionToken', result.token);
    applyPlayerPayload(result);
    render();
  } catch (error) {
    $('#formerror').innerHTML = `<div class="error">${esc(error.message)}</div>`;
  }
}

async function openEvidence(id) {
  const evidence = state.content.evidence.find((item) => item.id === id);
  if (!evidence?.unlocked) return toast('This evidence is still locked.');
  try {
    await gameAction('view_evidence', { evidenceId: id }, { silent: true });
    state.modal = { type: 'evidence', id };
    render();
  } catch {}
}

async function openSuspect(id) {
  try {
    await gameAction('open_suspect', { suspectId: id }, { silent: true });
    state.modal = { type: 'suspect', id };
    render();
  } catch {}
}

async function ask(suspectId, questionId, followup = false) {
  try {
    await gameAction('ask_question', { suspectId, questionId, followup }, { silent: true });
    state.modal = { type: 'suspect', id: suspectId };
    render();
  } catch (error) {
    toast(error.message);
  }
}

async function completeLead(leadId) {
  try {
    await gameAction('complete_lead', { leadId });
    toast('Lead evidence unlocked');
  } catch {}
}

async function addNote() {
  const text = $('#newnote')?.value.trim();
  if (!text) return;
  try {
    await gameAction('add_note', { text });
    toast('Note saved');
  } catch {}
}

async function addSuggested(text) {
  try {
    await gameAction('add_note', { text }, { silent: true });
    toast('Added to notebook');
    render();
  } catch (error) {
    toast(error.message);
  }
}

async function deleteNote(noteId) {
  try {
    await gameAction('delete_note', { noteId });
  } catch {}
}

async function connectEvidence() {
  const a = $('#connA')?.value;
  const b = $('#connB')?.value;
  if (!a || !b || a === b) return toast('Choose two different evidence items.');
  try {
    await gameAction('connect_evidence', { a, b });
    toast('Evidence connected');
  } catch {}
}

async function markEvidence(evidenceId, status) {
  try {
    await gameAction('mark_evidence', { evidenceId, status }, { silent: true });
    state.modal = { type: 'evidence', id: evidenceId };
    render();
  } catch (error) {
    toast(error.message);
  }
}

async function assessSuspect(suspectId, status) {
  try {
    await gameAction('assess_suspect', { suspectId, status }, { silent: true });
    state.modal = { type: 'suspect', id: suspectId };
    render();
  } catch (error) {
    toast(error.message);
  }
}

async function useHint(hintId, level) {
  if (!confirm(`Reveal Hint ${level}? This permanently deducts 2 points.`)) return;
  try {
    await gameAction('use_hint', { hintId, level });
  } catch {}
}

async function togglePause() {
  const paused = !progress().paused;
  try {
    await gameAction('set_paused', { paused });
    toast(paused ? 'Case paused' : 'Case resumed');
  } catch {}
}

async function chooseLength(caseLength) {
  try {
    await gameAction('set_case_length', { caseLength });
  } catch {}
}

async function completeChapter(chapterId) {
  try {
    await gameAction('complete_chapter', { chapterId }, { silent: true });
    state.view = progress().chapter === 'C05' ? 'accuse' : 'chapter';
    render();
  } catch (error) {
    if (error.data?.minimumSecondsRemaining) {
      toast(`Keep investigating for ${formatDuration(error.data.minimumSecondsRemaining)}.`);
    } else {
      toast(error.message);
    }
  }
}

async function submitAccusation(event) {
  event.preventDefault();
  if (!confirm('Lock this accusation? It cannot be changed.')) return;
  const answers = Object.fromEntries(new FormData(event.target).entries());
  try {
    const result = await api('/api/accusation', {
      method: 'POST',
      body: JSON.stringify({ answers }),
    });
    state.accusation = result.accusation;
    if (result.player) state.player = result.player;
    render();
  } catch (error) {
    toast(error.message);
  }
}

async function showLeaderboard() {
  try {
    const result = await api(`/api/leaderboard?session=${encodeURIComponent(state.session)}`);
    state.modal = { type: 'leaderboard', data: result.leaderboard };
    render();
  } catch (error) {
    toast(error.message);
  }
}

function exitCase() {
  localStorage.removeItem('reunionToken');
  state.token = null;
  state.player = null;
  state.content = null;
  state.accusation = null;
  state.view = 'home';
  render();
}

function renderHost() {
  if (!state.hostToken) {
    app.innerHTML = `<div class="shell"><div class="landing"><div class="hero"><div class="crest">H</div><h1>Host Dashboard</h1><p>Manage registration, check-ins, progress, QR code, and scores.</p></div>
      <div class="panel"><form onsubmit="hostLogin(event)"><div class="field"><label>Session code</label><input name="sessionCode" value="${esc(state.session)}" minlength="4" maxlength="12"></div><div class="field"><label>Host PIN</label><input name="pin" type="password" inputmode="numeric"></div><div id="formerror"></div><button class="btn gold" style="width:100%">Open Dashboard</button></form></div></div></div>`;
    return;
  }
  if (!state.hostData) {
    app.innerHTML = '<div class="host"><div class="panel">Loading dashboard…</div></div>';
    loadHost();
    return;
  }
  const data = state.hostData;
  app.innerHTML = `<div class="host"><div class="hero"><h1>Host Dashboard</h1><p>${esc(data.session.title)} · ${esc(data.session.code)}</p></div>
    <div class="hostgrid"><div class="panel"><h2>Check-in QR</h2><div id="qrbox"><button class="btn" onclick="loadQR()">Generate QR Code</button></div><p class="small muted">Guests scanning the code land in this session automatically.</p></div>
    <div class="panel"><h2>Session Controls</h2><p><b>${data.players.length}</b> registered · <b>${data.leaderboard.length}</b> completed</p><button class="btn ${data.session.is_open ? 'danger' : 'secondary'}" onclick="toggleRegistration(${!data.session.is_open})">${data.session.is_open ? 'Close Registration' : 'Open Registration'}</button> <button class="btn secondary" onclick="loadHost()">Refresh</button></div></div>
    <div class="panel"><h2>Players and Teams</h2><div class="tablewrap"><table><thead><tr><th>Name</th><th>Mode</th><th>Case</th><th>Chapter</th><th>Evidence</th><th>Score</th><th></th></tr></thead><tbody>
      ${data.players.map((player) => `<tr><td><b>${esc(player.displayName)}</b></td><td>${esc(player.playMode)}</td><td>${esc(player.caseLength)}</td><td>${esc(player.chapter)}</td><td>${player.evidenceViewedCount}</td><td>${player.score ?? '—'}</td><td><button class="chip" onclick="resetPlayer('${player.id}')">Reset</button></td></tr>`).join('')}
    </tbody></table></div></div>
    <div class="panel"><h2>Leaderboard</h2>${data.leaderboard.map((entry) => `<p><b>#${entry.place} ${esc(entry.name)}</b> — ${entry.score} pts · ${esc(entry.rank)}</p>`).join('') || '<p class="muted">No completed cases yet.</p>'}</div>
  </div>`;
}

async function hostLogin(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  try {
    const result = await api('/api/host/login', { method: 'POST', body: JSON.stringify(data) });
    state.hostToken = result.token;
    sessionStorage.setItem('hostToken', result.token);
    syncSession(result.session.code);
    await loadHost();
  } catch (error) {
    $('#formerror').innerHTML = `<div class="error">${esc(error.message)}</div>`;
  }
}

async function loadHost() {
  try {
    state.hostData = await api('/api/host/session', { host: true });
    syncSession(state.hostData.session.code);
    renderHost();
  } catch {
    state.hostToken = null;
    state.hostData = null;
    sessionStorage.removeItem('hostToken');
    renderHost();
  }
}

async function loadQR() {
  try {
    const result = await api('/api/host/qr', { host: true });
    $('#qrbox').innerHTML = `<img class="qr" src="${result.dataUrl}" alt="Session QR code"><p class="small"><a href="${result.url}">${esc(result.url)}</a></p>`;
  } catch (error) {
    toast(error.message);
  }
}

async function toggleRegistration(isOpen) {
  await api('/api/host/open', { method: 'POST', host: true, body: JSON.stringify({ isOpen }) });
  await loadHost();
}

async function resetPlayer(id) {
  if (!confirm('Reset this player and delete their submitted score?')) return;
  await api('/api/host/reset-player', { method: 'POST', host: true, body: JSON.stringify({ playerId: id }) });
  await loadHost();
}

async function boot() {
  if (params.has('host')) {
    renderHost();
    return;
  }
  if (state.token) {
    try {
      const result = await api('/api/me');
      applyPlayerPayload(result);
    } catch {
      localStorage.removeItem('reunionToken');
      state.token = null;
    }
  }
  render();
}

function render() {
  if (new URLSearchParams(location.search).has('host')) {
    renderHost();
    return;
  }
  if (!state.player || !state.content) {
    renderLanding();
    return;
  }
  app.innerHTML = renderPlayer();
}

window.state = state;
window.render = render;
window.go = go;
window.tab = tab;
window.registerPlayer = registerPlayer;
window.resumePlayer = resumePlayer;
window.openEvidence = openEvidence;
window.openSuspect = openSuspect;
window.ask = ask;
window.completeLead = completeLead;
window.addNote = addNote;
window.addSuggested = addSuggested;
window.deleteNote = deleteNote;
window.connectEvidence = connectEvidence;
window.markEvidence = markEvidence;
window.assessSuspect = assessSuspect;
window.useHint = useHint;
window.togglePause = togglePause;
window.chooseLength = chooseLength;
window.completeChapter = completeChapter;
window.submitAccusation = submitAccusation;
window.showLeaderboard = showLeaderboard;
window.exitCase = exitCase;
window.hostLogin = hostLogin;
window.loadHost = loadHost;
window.loadQR = loadQR;
window.toggleRegistration = toggleRegistration;
window.resetPlayer = resetPlayer;

boot();

setInterval(() => {
  if (state.player && state.content && !state.accusation && !progress().paused) {
    gameAction('heartbeat', {}, { silent: true })
      .then(() => {
        if (state.view === 'chapter' || state.view === 'evidence') render();
      })
      .catch(() => {});
  }
}, 30_000);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      registration.update();
    } catch {}
  });
}
