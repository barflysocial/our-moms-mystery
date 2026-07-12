const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dbPath = path.join(root, 'data', 'local-db.json');
const cases = JSON.parse(fs.readFileSync(path.join(root, 'data', 'cases.json'), 'utf8'));
const base = 'http://127.0.0.1:3411';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function resetDb() { fs.writeFileSync(dbPath, JSON.stringify({ sessions: [], players: [], accusations: [] }, null, 2)); }
async function jsonRequest(url, options = {}) { const response = await fetch(base + url, options); const body = await response.json().catch(() => ({})); return { response, body }; }
async function action(token, actionName, payload = {}) { return jsonRequest('/api/action', { method:'POST', headers:{'content-type':'application/json',authorization:`Bearer ${token}`}, body:JSON.stringify({action:actionName,payload}) }); }
function localPlayer(mobile) { return JSON.parse(fs.readFileSync(dbPath, 'utf8')).players.find((player) => player.mobile === mobile); }

async function completeQuickCase(token, version) {
  const c = cases.cases[version];
  assert.equal((await action(token,'view_briefing',{briefingId:'B_C00'})).response.status,200);
  for (const id of ['E01','E02']) assert.equal((await action(token,'view_evidence',{evidenceId:id})).response.status,200);
  assert.equal((await action(token,'view_briefing',{briefingId:'B_C01'})).response.status,200);
  for (const id of ['E03','E04']) assert.equal((await action(token,'view_evidence',{evidenceId:id})).response.status,200);
  for (const id of ['S01','S02','S03','S04']) assert.equal((await action(token,'open_suspect',{suspectId:id})).response.status,200);
  assert.equal((await action(token,'view_briefing',{briefingId:'B_C02'})).response.status,200);
  for (const id of ['E05','E06','E07']) assert.equal((await action(token,'view_evidence',{evidenceId:id})).response.status,200);
  for (const id of ['S01','S02','S03','S04']) assert.equal((await action(token,'ask_question',{suspectId:id,questionId:'Q1',followup:false})).response.status,200);
  assert.equal((await action(token,'view_briefing',{briefingId:'B_C03'})).response.status,200);
  assert.equal((await action(token,'complete_lead',{leadId:'finance'})).response.status,200);
  assert.equal((await action(token,'view_evidence',{evidenceId:'E09'})).response.status,200);
  assert.equal((await action(token,'view_briefing',{briefingId:'B_C04'})).response.status,200);
  for (const id of ['E10','E11','E12','E13','E14']) assert.equal((await action(token,'view_evidence',{evidenceId:id})).response.status,200);
  assert.equal((await action(token,'ask_question',{suspectId:c.solution.killerId,questionId:'F1',followup:true})).response.status,200);
  assert.equal((await action(token,'submit_deduction',{deductionId:'D1',optionId:'D1A'})).response.status,200);
  const me = await jsonRequest('/api/me',{headers:{authorization:`Bearer ${token}`}});
  assert.equal(me.body.player.progress.chapter,'C05');
}

(async () => {
  resetDb();
  const child = spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:'3411',APP_SECRET:'smoke-secret',HOST_PIN:'2006',PUBLIC_BASE_URL:base,TEST_BYPASS_TIMERS:'1'},stdio:'inherit'});
  try {
    await wait(900);
    let result = await jsonRequest('/api/health');
    assert.equal(result.response.status,200); assert.equal(result.body.version,'3.3.0'); assert.equal(result.body.cases,4);
    assert.equal((await jsonRequest('/api/game')).response.status,401);

    const registrations=[];
    for (let i=0;i<4;i+=1) {
      const mobile=`22555520${String(i).padStart(2,'0')}`;
      result=await jsonRequest('/api/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionCode:'OURMOMS',name:`Sleuth ${i+1}`,mobile,pin:'1234',playMode:'individual',caseLength:'quick'})});
      assert.equal(result.response.status,200);
      const serialized=JSON.stringify(result.body);
      assert(!serialized.includes('case_version')); assert(!serialized.includes('caseVersion')); assert(!serialized.includes('"confession"'));
      assert(!serialized.includes('"killerName"')); assert(!serialized.includes('"correct"'));
      assert.deepEqual(result.body.game.evidence.map((e)=>e.id),['E01','E02']);
      assert.equal(result.body.game.currentObjective.type,'briefing');
      assert.deepEqual(result.body.game.briefings.map((b)=>b.id),['B_C00']);
      assert.equal(result.body.game.currentBriefing.speaker,`Detective Sleuth ${i+1}`);
      assert(result.body.game.currentBriefing.paragraphs[0].startsWith(`Detective Sleuth ${i+1}, your next briefing follows.`));
      registrations.push({mobile,token:result.body.token});
    }
    const versions=registrations.map((item)=>localPlayer(item.mobile).case_version);
    assert.deepEqual(versions,['A','B','C','D'],'Rotating mode should balance the four authored cases');

    const first=registrations[0];
    assert.equal((await jsonRequest('/api/progress',{method:'PUT',headers:{'content-type':'application/json',authorization:`Bearer ${first.token}`},body:JSON.stringify({chapter:'C05'})})).response.status,400);
    assert.equal((await action(first.token,'use_hint',{hintId:'H_C00',level:1})).response.status,200);
    await completeQuickCase(first.token,versions[0]);
    const solution=cases.cases[versions[0]].solution;
    const answers={q1:solution.killerId,q2:solution.motiveId,q3:solution.weaponId,q4:solution.clueId,q5:solution.keywords.join(' ')};
    result=await jsonRequest('/api/accusation',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${first.token}`},body:JSON.stringify({answers})});
    assert.equal(result.response.status,403,'Final accusation must remain locked until the detective briefing is reviewed');
    assert.equal((await action(first.token,'view_briefing',{briefingId:'B_C05'})).response.status,200);
    result=await jsonRequest('/api/accusation',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${first.token}`},body:JSON.stringify({answers})});
    assert.equal(result.response.status,200); assert.equal(result.body.accusation.score,98); assert.equal(result.body.accusation.solution.killer,solution.killerName); assert.equal(result.body.accusation.solution.investigatorLabel,'Detective Sleuth 1'); assert(result.body.accusation.solution.reconstruction.startsWith('Detective Sleuth 1, your reconstruction is complete.'));
    assert.equal((await jsonRequest('/api/accusation',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${first.token}`},body:JSON.stringify({answers})})).response.status,409);

    const second=registrations[1];
    assert.equal((await action(second.token,'view_evidence',{evidenceId:'E01'})).response.status,200);
    assert.equal((await action(second.token,'set_paused',{paused:true})).response.status,400,'Player-side pause is removed');

    result=await jsonRequest('/api/host/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionCode:'OURMOMS',pin:'2006'})});
    assert.equal(result.response.status,200); const hostToken=result.body.token;
    result=await jsonRequest('/api/host/session',{headers:{authorization:`Bearer ${hostToken}`}});
    assert.equal(result.response.status,200); assert.equal(result.body.players.length,4); assert.equal(result.body.counts.completed,1);
    const hostPayload=JSON.stringify(result.body.players); assert(!hostPayload.includes('mobile')); assert(!hostPayload.includes('pin_hash')); assert(!hostPayload.includes('case_version'));
    result=await jsonRequest('/api/host/qr',{headers:{authorization:`Bearer ${hostToken}`}}); assert(result.body.dataUrl.startsWith('data:image/png'));
    result=await jsonRequest('/api/host/version-mode',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${hostToken}`},body:JSON.stringify({versionMode:'fixed',fixedVersion:'C'})});
    assert.equal(result.response.status,200); assert.equal(result.body.session.fixed_version,'C');
    result=await jsonRequest('/api/host/session',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${hostToken}`},body:JSON.stringify({code:'OURMOMS',title:'Duplicate',venue:'Duplicate',scheduledAt:new Date(Date.now()+3600000).toISOString()})});
    assert.equal(result.response.status,409);

    result=await jsonRequest('/api/leaderboard?session=OURMOMS'); assert.equal(result.body.leaderboard[0].score,98); assert(!JSON.stringify(result.body).includes(solution.killerName));
    result=await jsonRequest('/api/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionCode:'OURMOMS',name:'Taylor',mobile:'2255552888',pin:'4321',playMode:'team',teamName:'Bayou Sleuths',caseLength:'quick'})});
    assert.equal(result.response.status,200); assert.equal(result.body.game.currentBriefing.speaker,'Bayou Sleuths Detective Team'); assert(result.body.game.currentBriefing.paragraphs[0].startsWith('Detectives of Bayou Sleuths, your next briefing follows.')); const teamResume=await jsonRequest('/api/resume',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionCode:'OURMOMS',mobile:'2255552888',pin:'4321'})}); assert.equal(teamResume.response.status,200); assert.equal(teamResume.body.game.currentBriefing.speaker,'Bayou Sleuths Detective Team');
    result=await jsonRequest('/api/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionCode:'OURMOMS',name:'Invalid',mobile:'2255552999',pin:'1234',playMode:'hacker',caseLength:'infinite'})}); assert.equal(result.response.status,400);
    result=await jsonRequest('/api/no-such-endpoint'); assert.equal(result.response.status,404); assert.equal(result.body.error,'API endpoint not found.');
    console.log('Smoke test passed: four rotating cases, guided progression, synchronized lobby rules, protected solutions, immutable scoring, sanitized host data, and QR access.');
  } finally { child.kill('SIGTERM'); await wait(250); resetDb(); }
})().catch((error)=>{console.error(error);process.exitCode=1;});
