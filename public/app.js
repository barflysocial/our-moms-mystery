const params = new URLSearchParams(location.search);
const state = {
  token: localStorage.getItem('reunionToken'),
  hostToken: sessionStorage.getItem('hostToken'),
  session: params.get('session') || localStorage.getItem('reunionLastSession') || 'OURMOMS',
  config: null,
  player: null,
  game: null,
  accusation: null,
  view: 'home',
  filesTab: 'evidence',
  modal: null,
  joinTab: 'join',
  joinStep: 1,
  joinDraft: { name:'', mobile:'', pin:'', playMode:'individual', teamName:'', caseLength:'standard' },
  accuseStep: 0,
  accuseDraft: { q1:'', q2:'', q3:'', q4:'', q5:'' },
  revealVisible: false,
  hostData: null,
  hostSearch: '',
  sessionInfo: null,
};

const app = document.querySelector('#app');
const $ = (selector) => document.querySelector(selector);
function esc(value='') { return String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function toast(text) { const el=$('#toast'); if(!el)return; el.textContent=text; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2600); }
function initials(name='') { return name.split(/\s+/).filter(Boolean).map((p)=>p[0]).slice(0,2).join('').toUpperCase(); }
function syncSession(code) {
  state.session=String(code||'OURMOMS').toUpperCase(); localStorage.setItem('reunionLastSession',state.session);
  const url=new URL(location.href); url.searchParams.set('session',state.session); history.replaceState({},'',url);
}
async function api(path, options={}) {
  const headers={'Content-Type':'application/json',...(options.headers||{})};
  if(state.token&&!options.host)headers.Authorization=`Bearer ${state.token}`;
  if(state.hostToken&&options.host)headers.Authorization=`Bearer ${state.hostToken}`;
  const response=await fetch(path,{...options,headers}); const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.error||'Request failed');error.status=response.status;error.data=data;throw error;} return data;
}
function applyPayload(data){
  const previousChapter=state.game?.currentChapter?.id||null; const hadPlayer=Boolean(state.player);
  if(data.session?.code){syncSession(data.session.code);state.sessionInfo=data.session;} if(data.player)state.player=data.player; if(data.game)state.game=data.game;
  if(Object.prototype.hasOwnProperty.call(data,'accusation'))state.accusation=data.accusation;
  const briefing=state.game?.currentBriefing;
  if(briefing&&!briefing.viewed&&(!hadPlayer||previousChapter!==state.game?.currentChapter?.id)) state.modal={type:'briefing',id:briefing.id};
  if(state.player?.progress?.theory&&!Object.values(state.accuseDraft).some(Boolean)){
    const t=state.player.progress.theory; state.accuseDraft={q1:t.suspectId||'',q2:t.motiveId||'',q3:t.weaponId||'',q4:t.clueId||'',q5:''};
  }
}
async function gameAction(action,payload={},silent=false){
  try{
    const data=await api('/api/action',{method:'POST',body:JSON.stringify({action,payload})}); applyPayload(data);
    (data.events||[]).forEach((event)=>toast(event.message)); if(data.feedback)toast(data.feedback.message); if(!silent)render(); return data;
  }catch(error){if(error.status===401)logout(false); if(!silent)toast(error.message); throw error;}
}
function progress(){return state.player?.progress||{};}
function currentChapter(){return state.game?.currentChapter||{};}
function evidenceById(id){return state.game?.evidence?.find((item)=>item.id===id);}
function suspectById(id){return state.game?.suspects?.find((item)=>item.id===id);}
function briefingById(id){return state.game?.briefings?.find((item)=>item.id===id);}
function optionLabel(group,id){return state.game?.accusationOptions?.[group]?.find((item)=>item.id===id)?.label||'Not selected';}
function investigatorLabel(){
  if(!state.player)return 'Detective';
  if(state.player.playMode==='team'&&state.player.teamName)return /detective team$/i.test(state.player.teamName)?state.player.teamName:`${state.player.teamName} Detective Team`;
  return /^detective\b/i.test(state.player.name)?state.player.name:`Detective ${state.player.name}`;
}
function investigatorAddress(){
  if(!state.player)return 'Detective';
  return state.player.playMode==='team'&&state.player.teamName ? `Detectives of ${state.player.teamName}` : investigatorLabel();
}
function investigatorInitials(){return initials(state.player?.playMode==='team' ? state.player.teamName : state.player?.name);}
function formatCountdown(seconds){
  const total=Math.max(0,Math.floor(Number(seconds)||0));
  const hours=Math.floor(total/3600);const minutes=Math.floor((total%3600)/60);const secs=total%60;
  return hours?`${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(secs).padStart(2,'0')}`:`${String(minutes).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
}
function localStartsIn(){
  const start=Date.parse(state.sessionInfo?.scheduledAt||'');
  return Number.isFinite(start)?Math.max(0,Math.ceil((start-Date.now())/1000)):0;
}
function renderLobby(){
  const starts=localStartsIn();const date=state.sessionInfo?.scheduledAt?new Date(state.sessionInfo.scheduledAt):null;
  return `<div class="lobby-screen"><div class="lobby-card"><div class="crest">06</div><span class="eyebrow">Investigation Lobby</span><h1>${esc(investigatorLabel())}</h1><p>You are checked in. Everyone in this game begins together when the official server clock reaches the scheduled start.</p><div class="countdown" id="lobbyCountdown">${formatCountdown(starts)}</div><p class="lobby-date">${date?date.toLocaleString([], {dateStyle:'full',timeStyle:'short'}):'Waiting for the host to schedule the game'}</p><div class="waiting-dots"><span></span><span></span><span></span></div><p class="small muted">Keep this page open. If you leave, return with your mobile number and PIN. The game continues on the shared server schedule.</p><button class="btn secondary wide" onclick="logout(true)">Exit This Device</button></div></div>`;
}

function bottomNav(){
  const items=[['home','⌂','Home'],['files','▤','Case Files'],['notebook','✎','Notebook'],['more','•••','More']];
  return `<nav class="bottomnav">${items.map(([view,icon,label])=>`<button class="${state.view===view?'active':''}" onclick="go('${view}')"><span class="navicon">${icon}</span><span>${label}</span></button>`).join('')}</nav>`;
}
function shell(content){
  return `<div class="app-shell">
    <header class="topbar"><div class="brandrow"><div class="mini-crest">06</div><div class="brandtext"><b>Reunion at Our Mom's</b><span>${esc(investigatorLabel())} · ${esc(state.game.profile.publicLabel)}</span></div><div class="server-live"><span></span> Live</div></div>
    <div class="progress"><span style="width:${state.game.progressPercent}%"></span></div></header>
    <main class="main">${content}</main>${bottomNav()}</div>${renderModal()}`;
}
function go(view){state.view=view;state.modal=null;render();window.scrollTo(0,0);}

function objectiveButton(obj){
  if(!obj)return '';
  const actions={
    briefing:`openBriefing('${obj.id}')`,evidence:`openEvidence('${obj.id}')`,casefiles:`openFiles('${obj.id}')`,suspect:`openSuspect('${obj.id}')`,leads:`go('leads')`,deduction:`openDeduction('${obj.id}')`,accuse:`go('accuse')`,wait:`openFiles('evidence')`,home:`go('files')`
  };
  return `<button class="btn primary wide" onclick="${actions[obj.type]||"go('files')"}">${esc(obj.label)}</button>`;
}
function hintCard(){
  const h=state.game.hint;if(!h)return '';
  return `<div class="hintbox"><div><b>Need a hint?</b><span>${esc(h.title)} · each new hint costs 2 points</span></div>
    ${h.revealed.map((item)=>`<p><b>Hint ${item.level}:</b> ${esc(item.text)}</p>`).join('')}
    ${h.nextLevel?`<button class="textbtn" onclick="useHint('${h.id}',${h.nextLevel})">Reveal Hint ${h.nextLevel}</button>`:'<span class="small muted">All hints revealed</span>'}</div>`;
}
function renderHome(){
  const obj=state.game.currentObjective; const p=progress(); const recent=(p.discoveries||[]).slice(0,3);
  const briefing=state.game.currentBriefing;
  return shell(`<section class="chapter-kicker"><span>${esc(currentChapter().title)}</span><b>${esc(currentChapter().headline)}</b>${briefing?.viewed?`<button class="briefing-replay" onclick="openBriefing('${briefing.id}')">▶ Replay detective briefing</button>`:''}</section>
    <section class="objective-card"><span class="eyebrow">Your next step</span><h1>${esc(obj.label)}</h1><p>${esc(obj.description)}</p>${objectiveButton(obj)}${hintCard()}</section>
    <section class="statsrow"><div><b>${p.suspectsOpened.length}</b><span>Suspects reviewed</span></div><div><b>${p.evidenceViewed.length}</b><span>Evidence examined</span></div><div><b>${p.deductionsSolved.length}</b><span>Deductions solved</span></div></section>
    <section class="card"><div class="sectionhead"><h2>Chapter checklist</h2><span>${state.game.chapterTasks.filter((t)=>t.done).length}/${state.game.chapterTasks.length}</span></div>
      ${state.game.chapterTasks.map((task)=>`<div class="task ${task.done?'done':''}"><span>${task.done?'✓':'○'}</span><p>${esc(task.text)}</p></div>`).join('')}
      ${state.game.minimumSecondsRemaining?`<p class="small muted">The next chapter opens after about ${state.game.minimumSecondsRemaining} more seconds of active investigation.</p>`:''}
    </section>
    <section class="card"><div class="sectionhead"><h2>Recent discoveries</h2><button class="textbtn" onclick="go('notebook')">View notebook</button></div>
      ${recent.length?recent.map((item)=>`<div class="discovery"><span>◆</span><p>${esc(item.text)}</p></div>`).join(''):'<p class="muted">Important facts will be recorded automatically as you investigate.</p>'}
    </section>`);
}

function openFiles(tab){state.view='files';state.filesTab=tab==='suspects'?'suspects':'evidence';state.modal=null;render();}
function renderFiles(){
  const p=progress();
  const tabs=`<div class="segmented"><button class="${state.filesTab==='evidence'?'active':''}" onclick="state.filesTab='evidence';render()">Evidence</button><button class="${state.filesTab==='suspects'?'active':''}" onclick="state.filesTab='suspects';render()">Suspects</button></div>`;
  if(state.filesTab==='evidence'){
    const available=state.game.evidence.filter((item)=>!item.viewed); const reviewed=state.game.evidence.filter((item)=>item.viewed);
    return shell(`${tabs}<div class="pagehead"><h1>Case Files</h1><p>Only available evidence is shown. More appears as your investigation progresses.</p></div>
      ${available.length?`<h2 class="section-title">Available evidence</h2><div class="cardlist">${available.map((e)=>`<button class="filecard "  onclick="openEvidence('${e.id}')"><span class="fileicon">${iconFor(e.type)}</span><div><b>${esc(e.title)}</b><p>${esc(e.teaser)}</p></div><span>›</span></button>`).join('')}</div>`:''}
      <h2 class="section-title">Previously reviewed</h2><div class="cardlist">${reviewed.map((e)=>`<button class="filecard" onclick="openEvidence('${e.id}')"><span class="fileicon">${iconFor(e.type)}</span><div><b>${esc(e.title)}</b><p>${esc(e.teaser)}</p></div><span>›</span></button>`).join('')||'<p class="muted">No evidence reviewed yet.</p>'}</div>`);
  }
  return shell(`${tabs}<div class="pagehead"><h1>Suspect Directory</h1><p>Open profiles freely. Interview questions appear after the murder chapter begins.</p></div><div class="suspectgrid">${state.game.suspects.map((s)=>`<button class="suspectcard ${s.opened?'opened':''}" onclick="openSuspect('${s.id}')"><div class="avatar">${esc(s.initials)}</div><div><b>${esc(s.name)}</b><p>${esc(s.role)}</p></div>${s.followups.some((f)=>!f.asked)?'<span class="newdot" title="New question"></span>':''}</button>`).join('')}</div>`);
}
function iconFor(type){return ({Photo:'▧',Document:'▤',Report:'⌕',Phone:'▣',Timeline:'◷',Forensics:'◆',Letter:'✉',Financial:'$',Messages:'✦',School:'▥',Witness:'◉',Story:'★',Directory:'♟',Transcript:'“',Note:'✎'}[type]||'▤');}

function renderLeads(){
  return shell(`<div class="pagehead"><button class="back" onclick="go('home')">‹ Back</button><h1>Choose a lead</h1><p>Every table eventually receives the essential clues. Your case length determines how many side paths you must investigate.</p></div>
    <div class="cardlist">${state.game.leads.map((lead)=>`<div class="leadcard ${lead.completed?'complete':''}"><div><b>${esc(lead.title)}</b><p>${esc(lead.description)}</p></div><button class="btn ${lead.completed?'secondary':'primary'}" ${lead.completed?'disabled':''} onclick="completeLead('${lead.id}')">${lead.completed?'Completed':'Investigate'}</button></div>`).join('')}</div>`);
}

function theorySelect(label,name,items,value){return `<label class="field"><span>${esc(label)}</span><select id="${name}"><option value="">Choose…</option>${items.map((i)=>`<option value="${i.id}" ${i.id===value?'selected':''}>${esc(i.label)}</option>`).join('')}</select></label>`;}
function renderNotebook(){
  const p=progress(),opts=state.game.accusationOptions;
  return shell(`<div class="pagehead"><h1>Detective Notebook</h1><p>Major facts are saved automatically. Use the theory board to organize your current conclusion.</p></div>
    <section class="card"><h2>Your theory board</h2>${theorySelect('Main suspect','theorySuspect',opts.killers,p.theory.suspectId)}${theorySelect('Likely motive','theoryMotive',opts.motives,p.theory.motiveId)}${theorySelect('Possible weapon','theoryWeapon',opts.weapons,p.theory.weaponId)}${theorySelect('Strongest clue','theoryClue',opts.clues,p.theory.clueId)}<button class="btn primary wide" onclick="saveTheory()">Save Theory</button></section>
    <section class="card"><h2>Automatic discoveries</h2>${p.discoveries.length?p.discoveries.map((d)=>`<div class="discovery"><span>◆</span><p>${esc(d.text)}</p></div>`).join(''):'<p class="muted">Nothing recorded yet.</p>'}</section>
    <section class="card"><h2>My notes</h2><textarea id="noteText" maxlength="500" placeholder="Add an optional observation…"></textarea><button class="btn secondary" onclick="addNote()">Save Note</button>${p.notes.map((n)=>`<div class="usernote"><p>${esc(n.text)}</p><button onclick="deleteNote('${n.id}')">Delete</button></div>`).join('')}</section>`);
}
function renderMore(){
  return shell(`<div class="pagehead"><h1>More</h1><p>Manage your case and view event information.</p></div>
    <div class="menulist"><button onclick="showLeaderboard()"><span>★</span><div><b>Leaderboard</b><p>Scores and team names only—never the culprit.</p></div><i>›</i></button>
    <button onclick="showBriefings()"><span>▶</span><div><b>Detective briefings</b><p>Replay the reunion narration and chapter updates.</p></div><i>›</i></button>
    <button onclick="go('files')"><span>▤</span><div><b>Review case files</b><p>Return to unlocked evidence and interviews.</p></div><i>›</i></button>
    <button onclick="logout(true)"><span>↪</span><div><b>Exit case</b><p>Resume later with your mobile number and PIN.</p></div><i>›</i></button></div>
    <section class="card spoiler-note"><b>Protect nearby tables</b><p>${esc(state.game.spoilerNotice)}</p></section>`);
}

function renderAccuse(){
  if(state.accusation)return renderResults();
  const steps=[
    {key:'q1',title:'Who killed Blake?',group:'killers'},
    {key:'q2',title:'What was the motive?',group:'motives'},
    {key:'q3',title:'What was the weapon?',group:'weapons'},
    {key:'q4',title:'Which clue broke the alibi?',group:'clues'},
    {key:'q5',title:'Explain the crime sequence',text:true},
  ];
  if(state.accuseStep<steps.length){
    const step=steps[state.accuseStep];
    const body=step.text?`<textarea id="accuseAnswer" maxlength="1000" placeholder="Describe how the evidence fits together…">${esc(state.accuseDraft.q5)}</textarea>`:`<div class="choice-list">${state.game.accusationOptions[step.group].map((o)=>`<button class="choice ${state.accuseDraft[step.key]===o.id?'selected':''}" onclick="selectAccuse('${step.key}','${o.id}')">${esc(o.label)}</button>`).join('')}</div>`;
    return shell(`<div class="pagehead"><button class="back" onclick="${state.accuseStep?'previousAccuse()':"go('home')"}">‹ Back</button><span class="eyebrow">Question ${state.accuseStep+1} of 5</span><h1>${esc(step.title)}</h1><p>Your answers remain editable until you lock the final theory.</p></div>${body}<button class="btn primary wide" onclick="nextAccuse()">Continue</button>`);
  }
  return shell(`<div class="pagehead"><button class="back" onclick="previousAccuse()">‹ Back</button><span class="eyebrow">Review</span><h1>Your final theory</h1><p>Once locked, this accusation cannot be changed.</p></div>
    <section class="reviewcard"><div><span>Killer</span><b>${esc(optionLabel('killers',state.accuseDraft.q1))}</b></div><div><span>Motive</span><b>${esc(optionLabel('motives',state.accuseDraft.q2))}</b></div><div><span>Weapon</span><b>${esc(optionLabel('weapons',state.accuseDraft.q3))}</b></div><div><span>Key clue</span><b>${esc(optionLabel('clues',state.accuseDraft.q4))}</b></div><div><span>Your explanation</span><p>${esc(state.accuseDraft.q5||'No explanation entered')}</p></div></section>
    <button class="btn danger wide" onclick="submitAccusation()">Lock My Accusation</button><p class="small muted center">Please keep your result private. Nearby tables may have a different case.</p>`);
}
function renderResults(){
  const a=state.accusation; const solution=a.solution;
  return shell(`<div class="resulthead"><span class="score">${a.score}</span><h1>${esc(a.rank)}</h1><p>${esc(investigatorAddress())}, your accusation is locked.</p></div>
    <section class="card spoiler-note"><b>Private reveal</b><p>Your table may have received a different solution from other diners. Turn the screen away from nearby tables before revealing.</p></section>
    ${state.revealVisible?`<section class="reveal"><span class="eyebrow">${esc(solution.investigatorLabel||investigatorLabel())} · Final reconstruction</span><h1>${esc(solution.killer)}</h1><p class="reconstruction">${esc(solution.reconstruction)}</p><div class="narration-controls"><button class="btn narration-button" onclick="speakFinalNarration()">▶ Play final narration</button><button class="btn secondary" onclick="stopNarration()">■ Stop</button></div><p><b>Motive:</b> ${esc(solution.motive)}</p><p><b>Weapon:</b> ${esc(solution.weapon)}</p><p><b>Key clue:</b> ${esc(solution.keyClue)}</p><h2>What happened</h2>${solution.sequence.map((s,i)=>`<div class="sequence"><span>${i+1}</span><p>${esc(s)}</p></div>`).join('')}<h2>Culprit statement</h2><blockquote>${esc(solution.confession)}</blockquote><button class="btn secondary wide" onclick="stopNarration();state.revealVisible=false;render()">Hide Solution</button></section>`:`<button class="btn primary wide revealbtn" onclick="state.revealVisible=true;render()">Tap to Reveal Solution</button>`}
    <button class="btn secondary wide" onclick="showLeaderboard()">View Leaderboard</button>`);
}

function renderPlayer(){
  if(state.view==='files')return renderFiles(); if(state.view==='notebook')return renderNotebook(); if(state.view==='more')return renderMore(); if(state.view==='leads')return renderLeads(); if(state.view==='accuse')return renderAccuse(); return renderHome();
}

function renderLanding(){
  const session=state.config?.session; const profileOptions=state.config?.profiles||{};
  if(state.joinTab==='resume'){
    app.innerHTML=`<div class="landing"><div class="landinghero"><div class="crest">06</div><span>Magnolia Ridge High School</span><h1>Reunion at<br>Our Mom's</h1><p>Resume your saved investigation.</p></div><div class="joinpanel"><div class="tabs"><button onclick="setJoinTab('join')">Join Case</button><button class="active">Resume</button></div><form onsubmit="resumePlayer(event)"><label class="field"><span>Mobile number</span><input name="mobile" inputmode="tel" autocomplete="tel" required></label><label class="field"><span>4-digit PIN</span><input name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required></label><div id="formerror"></div><button class="btn primary wide">Resume Case</button></form></div></div>`;return;
  }
  let form='';
  if(state.joinStep===1)form=`<form onsubmit="joinIdentity(event)"><span class="stepcount">Step 1 of 3</span><h2>Create your detective pass</h2><label class="field"><span>Name or detective alias</span><input name="name" value="${esc(state.joinDraft.name)}" maxlength="50" required></label><label class="field"><span>Mobile number</span><input name="mobile" value="${esc(state.joinDraft.mobile)}" inputmode="tel" autocomplete="tel" required><small>Used only to save and resume your case.</small></label><label class="field"><span>Choose a 4-digit PIN</span><input name="pin" value="${esc(state.joinDraft.pin)}" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required></label><button class="btn primary wide">Continue</button></form>`;
  if(state.joinStep===2)form=`<span class="stepcount">Step 2 of 3</span><h2>How are you playing?</h2><div class="choice-list"><button class="choice ${state.joinDraft.playMode==='individual'?'selected':''}" onclick="choosePlayMode('individual')"><b>By myself</b><span>One phone, one detective</span></button><button class="choice ${state.joinDraft.playMode==='team'?'selected':''}" onclick="choosePlayMode('team')"><b>With my table</b><span>Share one case and one score</span></button></div>${state.joinDraft.playMode==='team'?`<label class="field"><span>Table or team name</span><input id="teamName" value="${esc(state.joinDraft.teamName)}" maxlength="50"></label>`:''}<div class="twobuttons"><button class="btn secondary" onclick="state.joinStep=1;render()">Back</button><button class="btn primary" onclick="joinModeNext()">Continue</button></div>`;
  if(state.joinStep===3)form=`<span class="stepcount">Step 3 of 3</span><h2>Choose your case length</h2><div class="choice-list">${Object.entries(profileOptions).map(([key,p])=>`<button class="choice ${state.joinDraft.caseLength===key?'selected':''}" onclick="state.joinDraft.caseLength='${key}';render()"><b>${esc(p.label)}</b><span>${esc(p.time)} · ${esc(p.description)}</span></button>`).join('')}</div><div id="formerror"></div><div class="twobuttons"><button class="btn secondary" onclick="state.joinStep=2;render()">Back</button><button class="btn primary" onclick="registerPlayer()">Join Lobby</button></div>`;
  app.innerHTML=`<div class="landing"><div class="landinghero"><div class="crest">06</div><span>Magnolia Ridge High School</span><h1>Reunion at<br>Our Mom's</h1><p>One last secret. One dead class president. Your table solves the case.</p>${session?`<div class="venuepill">${esc(session.venue)} · ${session.isOpen?'Registration open':'Registration closed'}</div>`:''}</div><div class="joinpanel"><div class="tabs"><button class="active">Join Case</button><button onclick="setJoinTab('resume')">Resume</button></div>${form}</div><p class="landingfoot">Scheduled start · Shared server clock · Different tables may receive different solutions</p></div>`;
}

function renderModal(){
  if(!state.modal)return '';
  if(state.modal.type==='briefing'){
    const b=briefingById(state.modal.id);if(!b)return '';
    return `<div class="modalback" onclick="closeModal(event)"><section class="modal briefing-modal"><button class="modalclose" onclick="closeActiveModal()">×</button><div class="detective-badge"><span>${esc(investigatorInitials())}</span><div><span class="eyebrow">${esc(b.kicker)}</span><b>${esc(b.speaker)}</b></div></div><h1>${esc(b.title)}</h1><p class="small muted">${esc(b.duration)} · Audio is optional; the full transcript appears below.</p><div class="narration-controls"><button class="btn narration-button" onclick="speakBriefing('${b.id}')">▶ Play narration</button><button class="btn secondary" onclick="stopNarration()">■ Stop</button></div><div class="monologue">${b.paragraphs.map((text)=>`<p>${esc(text)}</p>`).join('')}</div><div class="briefing-objective"><b>${state.player.playMode==='team'?'Your team assignment':'Your assignment'}</b><p>${esc(b.objective)}</p></div>${b.viewed?`<button class="btn primary wide" onclick="closeActiveModal()">Return to Investigation</button>`:`<button class="btn primary wide" onclick="acknowledgeBriefing('${b.id}')">Continue Investigation</button>`}</section></div>`;
  }
  if(state.modal.type==='briefings'){
    return `<div class="modalback" onclick="closeModal(event)"><section class="modal"><button class="modalclose" onclick="closeActiveModal()">×</button><span class="eyebrow">Case narration</span><h1>Detective Briefings</h1><p class="muted">Replay any briefing you have already reached.</p><div class="cardlist">${state.game.briefings.map((b)=>`<button class="filecard" onclick="openBriefing('${b.id}')"><span class="fileicon">▶</span><div><b>${esc(b.title)}</b><p>${esc(b.kicker)}</p></div><span>›</span></button>`).join('')}</div></section></div>`;
  }
  if(state.modal.type==='evidence'){
    const e=evidenceById(state.modal.id);if(!e)return '';
    return `<div class="modalback" onclick="closeModal(event)"><section class="modal"><button class="modalclose" onclick="state.modal=null;render()">×</button><span class="eyebrow">${esc(e.type)} · ${esc(e.id)}</span><h1>${esc(e.title)}</h1><p class="leadtext">${esc(e.teaser)}</p>${e.facts?`<div class="factlist">${e.facts.map((f)=>`<div><span>◆</span><p>${esc(f)}</p></div>`).join('')}</div><div class="why"><b>Why it may matter</b><p>${esc(e.why)}</p></div>${hintCard()}<button class="btn primary wide" onclick="state.modal=null;go('home')">${esc(e.nextLabel||'Continue Investigation')}</button>`:`<button class="btn primary wide" onclick="viewEvidenceNow('${e.id}')">Examine Evidence</button>`}</section></div>`;
  }
  if(state.modal.type==='suspect'){
    const s=suspectById(state.modal.id);if(!s)return '';
    const unanswered=[...s.followups.filter((q)=>!q.asked),...s.questions.filter((q)=>!q.asked)]; const next=unanswered[0]; const history=[...s.questions,...s.followups].filter((q)=>q.asked);
    return `<div class="modalback" onclick="closeModal(event)"><section class="modal"><button class="modalclose" onclick="state.modal=null;render()">×</button><div class="suspecthero"><div class="avatar large">${esc(s.initials)}</div><div><span class="eyebrow">Suspect profile</span><h1>${esc(s.name)}</h1><p>${esc(s.role)}</p></div></div><div class="why"><b>Known concern</b><p>${esc(s.publicMotive)}</p></div>
      ${next?`<section class="interview"><span class="eyebrow">${next.recommended?'Recommended follow-up':'Ask next'}</span><h2>${esc(next.text)}</h2><button class="btn primary wide" onclick="askQuestion('${s.id}','${next.id}',${s.followups.some((f)=>f.id===next.id)})">Ask Question</button></section>`:s.questions.length?'<p class="goodmsg">All currently available questions have been asked.</p>':'<p class="muted">Interviews open after the murder is announced.</p>'}
      ${history.length?`<h2>Interview record</h2>${history.map((q)=>`<details class="answer" ${history.length===1?'open':''}><summary>${esc(q.text)}</summary><p>${esc(q.answer)}</p></details>`).join('')}`:''}</section></div>`;
  }
  if(state.modal.type==='deduction'){
    const d=state.game.deductions.find((item)=>item.id===state.modal.id);if(!d)return '';
    return `<div class="modalback" onclick="closeModal(event)"><section class="modal"><button class="modalclose" onclick="state.modal=null;render()">×</button><span class="eyebrow">Guided deduction</span><h1>${esc(d.title)}</h1><p class="leadtext">${esc(d.question)}</p>${d.solved?'<p class="goodmsg">✓ Deduction solved</p>':`<div class="choice-list">${d.options.map((o)=>`<button class="choice" onclick="submitDeduction('${d.id}','${o.id}')">${esc(o.label)}</button>`).join('')}</div>${hintCard()}`}</section></div>`;
  }
  if(state.modal.type==='leaderboard')return `<div class="modalback" onclick="closeModal(event)"><section class="modal"><button class="modalclose" onclick="state.modal=null;render()">×</button><span class="eyebrow">Event scores</span><h1>Leaderboard</h1><p class="muted">Solutions are never shown here.</p>${state.modal.data.length?state.modal.data.map((e)=>`<div class="leaderrow"><span>#${e.place}</span><b>${esc(e.name)}</b><strong>${e.score}</strong></div>`).join(''):'<p>No completed cases yet.</p>'}</section></div>`;
  return '';
}
function stopNarration(){if('speechSynthesis'in window)window.speechSynthesis.cancel();}
function speakText(text){if(!('speechSynthesis'in window))return toast('Audio narration is not supported on this device.');stopNarration();const speech=new SpeechSynthesisUtterance(String(text||''));speech.rate=.92;speech.pitch=.92;speech.volume=1;window.speechSynthesis.speak(speech);}
function speakBriefing(id){const b=briefingById(id);if(b)speakText(b.narrationText);}
function speakFinalNarration(){const solution=state.accusation?.solution;if(solution)speakText(`${solution.reconstruction} ${solution.sequence.join(' ')} Culprit statement: ${solution.confession}`);}
function closeActiveModal(){stopNarration();state.modal=null;render();}
function closeModal(event){if(event.target.classList.contains('modalback'))closeActiveModal();}

function openBriefing(id){const b=briefingById(id);if(!b)return toast('Briefing not available yet.');stopNarration();state.modal={type:'briefing',id};render();}
async function acknowledgeBriefing(id){const current=id;await gameAction('view_briefing',{briefingId:id},true);stopNarration();if(state.game.currentBriefing?.id===current)state.modal=null;render();}
function showBriefings(){state.modal={type:'briefings'};render();}
async function openEvidence(id){
  const e=evidenceById(id);if(!e)return toast('Evidence not available yet.');
  if(!e.viewed){await gameAction('view_evidence',{evidenceId:id},true);} state.modal={type:'evidence',id};render();
}
async function viewEvidenceNow(id){await gameAction('view_evidence',{evidenceId:id},true);state.modal={type:'evidence',id};render();}
async function openSuspect(id){const s=suspectById(id);if(!s)return; if(!s.opened)await gameAction('open_suspect',{suspectId:id},true);state.modal={type:'suspect',id};render();}
async function askQuestion(suspectId,questionId,followup){await gameAction('ask_question',{suspectId,questionId,followup},true);state.modal={type:'suspect',id:suspectId};render();}
function openDeduction(id){state.modal={type:'deduction',id};render();}
async function submitDeduction(id,optionId){const data=await gameAction('submit_deduction',{deductionId:id,optionId},true);if(data.feedback?.correct){state.modal=null;}else state.modal={type:'deduction',id};render();}
async function completeLead(id){await gameAction('complete_lead',{leadId:id});}
async function useHint(id,level){if(!confirm(`Reveal Hint ${level}? This permanently deducts 2 points.`))return;await gameAction('use_hint',{hintId:id,level});}
async function addNote(){const text=$('#noteText')?.value.trim();if(!text)return;await gameAction('add_note',{text});}
async function deleteNote(id){await gameAction('delete_note',{noteId:id});}
async function saveTheory(){const theory={suspectId:$('#theorySuspect').value,motiveId:$('#theoryMotive').value,weaponId:$('#theoryWeapon').value,clueId:$('#theoryClue').value};await gameAction('set_theory',{theory});toast('Theory saved');}
async function showLeaderboard(){const data=await api(`/api/leaderboard?session=${encodeURIComponent(state.session)}`);state.modal={type:'leaderboard',data:data.leaderboard};render();}

function setJoinTab(tab){state.joinTab=tab;render();}
function joinIdentity(event){event.preventDefault();const d=Object.fromEntries(new FormData(event.target));state.joinDraft={...state.joinDraft,...d};state.joinStep=2;render();}
function choosePlayMode(mode){state.joinDraft.playMode=mode;if(mode==='individual')state.joinDraft.teamName='';render();}
function joinModeNext(){if(state.joinDraft.playMode==='team'){const n=$('#teamName')?.value.trim();if(!n)return toast('Enter a table or team name.');state.joinDraft.teamName=n;}state.joinStep=3;render();}
async function registerPlayer(){
  try{const data=await api('/api/register',{method:'POST',body:JSON.stringify({...state.joinDraft,sessionCode:state.session})});state.token=data.token;localStorage.setItem('reunionToken',data.token);applyPayload(data);render();}
  catch(error){const el=$('#formerror');if(el)el.innerHTML=`<div class="error">${esc(error.message)}</div>`;else toast(error.message);}
}
async function resumePlayer(event){event.preventDefault();try{const body={...Object.fromEntries(new FormData(event.target)),sessionCode:state.session};const data=await api('/api/resume',{method:'POST',body:JSON.stringify(body)});state.token=data.token;localStorage.setItem('reunionToken',data.token);applyPayload(data);render();}catch(error){$('#formerror').innerHTML=`<div class="error">${esc(error.message)}</div>`;}}
function logout(shouldConfirm){if(shouldConfirm&&!confirm('Exit this device? Your case can be resumed later.'))return;localStorage.removeItem('reunionToken');state.token=null;state.player=null;state.game=null;state.accusation=null;state.view='home';state.joinTab='resume';render();}

function selectAccuse(key,value){state.accuseDraft[key]=value;render();}
function nextAccuse(){const keys=['q1','q2','q3','q4'];if(state.accuseStep===4){state.accuseDraft.q5=$('#accuseAnswer')?.value.trim()||'';}else if(!state.accuseDraft[keys[state.accuseStep]])return toast('Choose an answer before continuing.');state.accuseStep+=1;render();window.scrollTo(0,0);}
function previousAccuse(){if(state.accuseStep>0)state.accuseStep-=1;render();}
async function submitAccusation(){if(!confirm('Lock this accusation? It cannot be changed.'))return;try{const data=await api('/api/accusation',{method:'POST',body:JSON.stringify({answers:state.accuseDraft})});applyPayload(data);state.revealVisible=false;render();}catch(error){toast(error.message);}}

function renderHost(){
  if(!state.hostToken){app.innerHTML=`<div class="landing"><div class="landinghero"><div class="crest">H</div><h1>Host Dashboard</h1><p>Manage registration, QR access, player status, and scores.</p></div><div class="joinpanel"><form onsubmit="hostLogin(event)"><label class="field"><span>Session code</span><input name="sessionCode" value="${esc(state.session)}" required></label><label class="field"><span>Host PIN</span><input name="pin" type="password" inputmode="numeric" required></label><div id="formerror"></div><button class="btn primary wide">Open Dashboard</button></form></div></div>`;return;}
  if(!state.hostData){app.innerHTML='<div class="hostwrap"><div class="card">Loading dashboard…</div></div>';loadHost();return;}
  const d=state.hostData; const query=state.hostSearch.toLowerCase(); const players=d.players.filter((p)=>p.displayName.toLowerCase().includes(query)||p.status.toLowerCase().includes(query));
  app.innerHTML=`<div class="hostwrap"><div class="hosthead"><div><span class="eyebrow">${esc(d.session.code)}</span><h1>Host Dashboard</h1><p>${esc(d.session.title)}</p></div><button class="btn secondary" onclick="loadHost()">Refresh</button></div>
    <div class="hoststats"><div><b>${d.counts.registered}</b><span>Registered</span></div><div><b>${d.counts.playing}</b><span>Playing</span></div><div><b>${d.counts.waiting||0}</b><span>Waiting</span></div><div><b>${d.counts.help}</b><span>May need help</span></div><div><b>${d.counts.completed}</b><span>Completed</span></div></div>
    <div class="hostgrid"><section class="card"><h2>Guest QR code</h2><div id="qrbox"><button class="btn primary" onclick="loadQR()">Show QR Code</button></div></section>
    <section class="card"><h2>Session controls</h2><div class="session-status ${esc(d.session.status)}"><b>${d.session.status==='lobby'?'Lobby open':d.session.status==='running'?'Game in progress':'Game ended'}</b><span>${d.session.scheduledAt?new Date(d.session.scheduledAt).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}):'No start scheduled'}</span></div><label class="field"><span>Game date and start time</span><input id="scheduledAt" type="datetime-local" value="${d.session.scheduledAt?new Date(new Date(d.session.scheduledAt).getTime()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):''}"></label><button class="btn primary" onclick="saveSchedule()">Save Start Time</button><button class="btn ${d.session.is_open?'danger':'secondary'}" onclick="toggleRegistration(${!d.session.is_open})">${d.session.is_open?'Close Registration':'Open Registration'}</button><hr><label class="field"><span>Case assignment</span><select id="versionMode" onchange="showFixedVersion()"><option value="rotating" ${d.session.version_mode==='rotating'?'selected':''}>Rotating — recommended</option><option value="random" ${d.session.version_mode==='random'?'selected':''}>Random</option><option value="fixed" ${d.session.version_mode==='fixed'?'selected':''}>Fixed for live event</option></select></label><label class="field" id="fixedVersionField" style="${d.session.version_mode==='fixed'?'':'display:none'}"><span>Fixed case</span><select id="fixedVersion">${['A','B','C','D'].map((id,i)=>`<option value="${id}" ${d.session.fixed_version===id?'selected':''}>Case ${i+1}</option>`).join('')}</select></label><button class="btn secondary" onclick="saveVersionMode()">Save Assignment Mode</button><p class="small muted">Rotating balances four different solutions and avoids previously completed versions when possible.</p></section></div>
    <section class="card"><h2>Create another scheduled game</h2><div class="host-form-grid"><label class="field"><span>Session code</span><input id="newCode" maxlength="12" placeholder="MOMS0721"></label><label class="field"><span>Game title</span><input id="newTitle" value="Reunion at Our Mom's"></label><label class="field"><span>Venue</span><input id="newVenue" value="Our Mom's Restaurant & Bar"></label><label class="field"><span>Date and start time</span><input id="newScheduledAt" type="datetime-local"></label></div><button class="btn primary" onclick="createScheduledSession()">Create Game and Open Dashboard</button></section>
    <section class="card"><div class="sectionhead"><h2>Players and tables</h2><input class="search" placeholder="Search name or status" value="${esc(state.hostSearch)}" oninput="state.hostSearch=this.value;renderHost()"></div><div class="playerlist">${players.map((p)=>`<div class="playerrow"><div><b>${esc(p.displayName)}</b><span>${esc(p.caseLength)} · ${esc(p.chapter)}</span></div><span class="status ${p.status.replaceAll(' ','-').toLowerCase()}">${esc(p.status)}</span><strong>${p.score??'—'}</strong><button class="textbtn" onclick="resetPlayer('${p.id}')">Reset</button></div>`).join('')||'<p>No matching players.</p>'}</div></section>
    <section class="card"><h2>Leaderboard</h2>${d.leaderboard.map((e)=>`<div class="leaderrow"><span>#${e.place}</span><b>${esc(e.name)}</b><strong>${e.score}</strong></div>`).join('')||'<p class="muted">No completed cases yet.</p>'}</section></div>`;
}
async function hostLogin(event){event.preventDefault();try{const data=await api('/api/host/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});state.hostToken=data.token;sessionStorage.setItem('hostToken',data.token);syncSession(data.session.code);await loadHost();}catch(error){$('#formerror').innerHTML=`<div class="error">${esc(error.message)}</div>`;}}
async function loadHost(){try{state.hostData=await api('/api/host/session',{host:true});renderHost();}catch{state.hostToken=null;state.hostData=null;sessionStorage.removeItem('hostToken');renderHost();}}
async function loadQR(){const data=await api('/api/host/qr',{host:true});$('#qrbox').innerHTML=`<img class="qr" src="${data.dataUrl}" alt="Guest QR code"><p class="small"><a href="${data.url}">${esc(data.url)}</a></p>`;}
async function createScheduledSession(){
  const code=$('#newCode')?.value.trim();const title=$('#newTitle')?.value.trim();const venue=$('#newVenue')?.value.trim();const local=$('#newScheduledAt')?.value;
  if(!code||!local)return toast('Enter a session code, date, and start time.');
  const data=await api('/api/host/session',{method:'POST',host:true,body:JSON.stringify({code,title,venue,scheduledAt:new Date(local).toISOString(),versionMode:'rotating'})});
  state.hostToken=data.token;sessionStorage.setItem('hostToken',data.token);syncSession(data.session.code);toast('Scheduled game created');await loadHost();
}
async function saveSchedule(){
  const local=$('#scheduledAt')?.value;if(!local)return toast('Choose a game date and start time.');
  const scheduledAt=new Date(local).toISOString();
  await api('/api/host/schedule',{method:'POST',host:true,body:JSON.stringify({scheduledAt})});
  toast('Game start time saved');await loadHost();
}
async function toggleRegistration(isOpen){await api('/api/host/open',{method:'POST',host:true,body:JSON.stringify({isOpen})});await loadHost();}
function showFixedVersion(){$('#fixedVersionField').style.display=$('#versionMode').value==='fixed'?'':'none';}
async function saveVersionMode(){const versionMode=$('#versionMode').value;const fixedVersion=$('#fixedVersion')?.value||'';await api('/api/host/version-mode',{method:'POST',host:true,body:JSON.stringify({versionMode,fixedVersion})});toast('Case assignment updated');await loadHost();}
async function resetPlayer(id){if(!confirm('Reset this player and remove their score?'))return;await api('/api/host/reset-player',{method:'POST',host:true,body:JSON.stringify({playerId:id})});await loadHost();}

async function boot(){
  if(params.has('host')){renderHost();return;}
  try{state.config=await api(`/api/config?session=${encodeURIComponent(state.session)}`);if(state.config.session?.code){syncSession(state.config.session.code);state.sessionInfo=state.config.session;}}catch{}
  if(state.token){try{const data=await api('/api/me');applyPayload(data);}catch{localStorage.removeItem('reunionToken');state.token=null;}}
  render();
}
function render(){if(new URLSearchParams(location.search).has('host'))return renderHost();if(!state.player||!state.game)return renderLanding();if(state.sessionInfo?.status==='lobby')return app.innerHTML=renderLobby();app.innerHTML=renderPlayer();}

Object.assign(window,{state,render,go,openFiles,openBriefing,acknowledgeBriefing,showBriefings,speakText,speakBriefing,speakFinalNarration,stopNarration,closeActiveModal,openEvidence,viewEvidenceNow,openSuspect,askQuestion,openDeduction,submitDeduction,completeLead,useHint,addNote,deleteNote,saveTheory,showLeaderboard,setJoinTab,joinIdentity,choosePlayMode,joinModeNext,registerPlayer,resumePlayer,logout,selectAccuse,nextAccuse,previousAccuse,submitAccusation,closeModal,hostLogin,loadHost,loadQR,createScheduledSession,toggleRegistration,saveSchedule,showFixedVersion,saveVersionMode,resetPlayer});
boot();
setInterval(async()=>{
  if(!state.player||!state.game||state.accusation)return;
  try{
    if(state.sessionInfo?.status==='lobby'){
      const data=await api('/api/me');applyPayload(data);render();
    }else{
      await gameAction('heartbeat',{},true);if(state.view==='home')render();
    }
  }catch{}
},5000);
setInterval(()=>{const el=document.querySelector('#lobbyCountdown');if(el)el.textContent=formatCountdown(localStartsIn());},1000);
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').then((r)=>r.update()).catch(()=>{}));
