const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root=path.join(__dirname,'..'); const dbPath=path.join(root,'data','local-db.json'); const cases=JSON.parse(fs.readFileSync(path.join(root,'data','cases.json'),'utf8'));
const base='http://127.0.0.1:3412'; const wait=(ms)=>new Promise((r)=>setTimeout(r,ms));
function resetDb(){fs.writeFileSync(dbPath,JSON.stringify({sessions:[],players:[],accusations:[]},null,2));}
async function jr(url,options={}){const response=await fetch(base+url,options);const body=await response.json().catch(()=>({}));return{response,body};}
async function action(token,actionName,payload={}){return jr('/api/action',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({action:actionName,payload})});}
(async()=>{
 resetDb();
 const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:'3412',APP_SECRET:'regression-secret',HOST_PIN:'2006',PUBLIC_BASE_URL:base},stdio:'inherit'});
 try{
  await wait(900);
  const reg=await jr('/api/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionCode:'OURMOMS',name:'Timer Test',mobile:'2255553001',pin:'1234',playMode:'individual',caseLength:'standard'})});
  assert.equal(reg.response.status,200); const token=reg.body.token; assert.equal(reg.body.game.profile.requiredSuspects,6); assert.equal(reg.body.game.profile.requiredDeductions,2);
  await action(token,'view_evidence',{evidenceId:'E01'}); await action(token,'view_evidence',{evidenceId:'E02'});
  await action(token,'view_evidence',{evidenceId:'E03'}); await action(token,'view_evidence',{evidenceId:'E04'});
  for(const id of ['S01','S02','S03','S04','S05','S06'])await action(token,'open_suspect',{suspectId:id});
  const me=await jr('/api/me',{headers:{authorization:`Bearer ${token}`}});
  assert.equal(me.body.player.progress.chapter,'C01','Soft pacing should prevent an immediate chapter jump');
  assert(me.body.game.minimumSecondsRemaining>0);

  const quick=await jr('/api/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionCode:'OURMOMS',name:'Quick',mobile:'2255553002',pin:'1234',playMode:'individual',caseLength:'quick'})});
  const deep=await jr('/api/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionCode:'OURMOMS',name:'Deep',mobile:'2255553003',pin:'1234',playMode:'individual',caseLength:'extended'})});
  assert.equal(quick.body.game.profile.requiredSuspects,4); assert.equal(deep.body.game.profile.requiredSuspects,10); assert(deep.body.game.profile.requiredQuestions>quick.body.game.profile.requiredQuestions);

  for(let i=0;i<5;i+=1){const r=await jr('/api/resume',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionCode:'OURMOMS',mobile:'2255553001',pin:'9999'})});assert.equal(r.response.status,401);}
  assert.equal((await jr('/api/resume',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionCode:'OURMOMS',mobile:'2255553001',pin:'9999'})})).response.status,429);
  for(let i=0;i<5;i+=1){const r=await jr('/api/host/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionCode:'OURMOMS',pin:'9999'})});assert.equal(r.response.status,401);}
  assert.equal((await jr('/api/host/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionCode:'OURMOMS',pin:'9999'})})).response.status,429);

  const manifest=JSON.parse(fs.readFileSync(path.join(root,'public','manifest.webmanifest'),'utf8')); assert.equal(manifest.start_url,'/?pwa=1');
  const appSource=fs.readFileSync(path.join(root,'public','app.js'),'utf8'); assert(appSource.includes("localStorage.getItem('reunionLastSession')")); assert(appSource.includes('Tap to Reveal Solution')); assert.equal((appSource.match(/pattern=\"\[0-9\]\{4\}\"/g)||[]).length,2,'Both player PIN fields must use a browser-safe numeric pattern'); assert(!appSource.includes('pattern=\"\\d{4}\"'),'JavaScript-generated HTML must not use an unescaped \d PIN pattern');
  const sw=fs.readFileSync(path.join(root,'public','sw.js'),'utf8'); assert(sw.includes('reunion-v3-guided')); assert(sw.includes('caches.delete'));
  for(const [id,c] of Object.entries(cases.cases)){assert.equal(c.suspects.length,12,`Case ${id} suspect count`);assert.equal(c.evidence.length,18,`Case ${id} evidence count`);assert.equal(c.deductions.length,3);assert(c.solution.killerId&&c.solution.weaponId&&c.solution.clueId);}
  console.log('Regression test passed: soft pacing, distinct case lengths, PIN throttling, PWA session retention, private reveal UI, and four structurally complete authored cases.');
 }finally{child.kill('SIGTERM');await wait(250);resetDb();}
})().catch((error)=>{console.error(error);process.exitCode=1;});
