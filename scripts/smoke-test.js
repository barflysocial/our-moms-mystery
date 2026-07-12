const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dbPath = path.join(root, 'data', 'local-db.json');
const base = 'http://127.0.0.1:3311';

function resetDb() {
  fs.writeFileSync(dbPath, JSON.stringify({ sessions: [], players: [], accusations: [] }, null, 2));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(url, options = {}) {
  return fetch(base + url, options);
}

async function jsonRequest(url, options = {}) {
  const response = await request(url, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function action(token, actionName, payload = {}) {
  return jsonRequest('/api/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: actionName, payload }),
  });
}

async function completeQuickCase(token) {
  for (const evidenceId of ['E01', 'E02']) {
    const result = await action(token, 'view_evidence', { evidenceId });
    assert.equal(result.response.status, 200);
  }
  assert.equal((await action(token, 'complete_chapter', { chapterId: 'C00' })).response.status, 200);

  for (const evidenceId of ['E03', 'E04']) {
    assert.equal((await action(token, 'view_evidence', { evidenceId })).response.status, 200);
  }
  for (const suspectId of ['S01', 'S02', 'S03', 'S04']) {
    assert.equal((await action(token, 'open_suspect', { suspectId })).response.status, 200);
  }
  assert.equal((await action(token, 'complete_chapter', { chapterId: 'C01' })).response.status, 200);

  for (const evidenceId of ['E05', 'E06', 'E07']) {
    assert.equal((await action(token, 'view_evidence', { evidenceId })).response.status, 200);
  }
  assert.equal((await action(token, 'ask_question', { suspectId: 'S01', questionId: 'Q1', followup: false })).response.status, 200);
  assert.equal((await action(token, 'ask_question', { suspectId: 'S02', questionId: 'Q1', followup: false })).response.status, 200);
  assert.equal((await action(token, 'add_note', { text: 'The murder window is 8:34–8:39 p.m.' })).response.status, 200);
  assert.equal((await action(token, 'complete_chapter', { chapterId: 'C02' })).response.status, 200);

  assert.equal((await action(token, 'complete_lead', { leadId: 'secrets' })).response.status, 200);
  assert.equal((await action(token, 'view_evidence', { evidenceId: 'E09' })).response.status, 200);
  assert.equal((await action(token, 'mark_evidence', { evidenceId: 'E09', status: 'important' })).response.status, 200);
  // Chapter 3 specifically requires explained or red-herring, not merely important.
  assert.equal((await action(token, 'mark_evidence', { evidenceId: 'E09', status: 'explained' })).response.status, 200);
  assert.equal((await action(token, 'complete_chapter', { chapterId: 'C03' })).response.status, 200);

  for (const evidenceId of ['E10', 'E11', 'E12']) {
    assert.equal((await action(token, 'view_evidence', { evidenceId })).response.status, 200);
  }
  assert.equal((await action(token, 'ask_question', { suspectId: 'S01', questionId: 'F1', followup: true })).response.status, 200);
  assert.equal((await action(token, 'complete_chapter', { chapterId: 'C04' })).response.status, 200);
}

(async () => {
  resetDb();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: '3311',
      APP_SECRET: 'test-secret',
      HOST_PIN: '2006',
      PUBLIC_BASE_URL: base,
      TEST_BYPASS_TIMERS: '1',
    },
    stdio: 'inherit',
  });

  try {
    await wait(900);
    let result = await jsonRequest('/api/health');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.version, 2);

    result = await jsonRequest('/api/game');
    assert.equal(result.response.status, 401, 'Game content must require authentication');

    const mobile = `22555${String(Math.floor(10000 + Math.random() * 89999))}`;
    result = await jsonRequest('/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionCode: 'OURMOMS',
        name: 'Test Detective',
        mobile,
        pin: '1234',
        playMode: 'team',
        teamName: 'Test Table',
        caseLength: 'quick',
      }),
    });
    assert.equal(result.response.status, 200);
    const token = result.body.token;
    assert(token);
    assert.equal(result.body.session.code, 'OURMOMS');
    assert.equal(result.body.player.displayName, 'Test Table');
    assert.equal(result.body.game.caseProfile.requiredSuspects, 4);
    const serializedGame = JSON.stringify(result.body.game);
    assert(!serializedGame.includes('\"truth\"'));
    assert(!serializedGame.includes('\"correct\":'));
    assert(!serializedGame.includes('\"correct_reveal\"'));
    assert(!serializedGame.includes('\"confession\"'));
    const lockedTrophy = result.body.game.evidence.find((item) => item.id === 'E15');
    assert(lockedTrophy && !Object.prototype.hasOwnProperty.call(lockedTrophy, 'content'));

    const authHeaders = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    result = await jsonRequest('/api/progress', {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ progress: { chapter: 'C05', hintsUsed: [] } }),
    });
    assert.equal(result.response.status, 400, 'Direct progress replacement must be rejected');

    result = await action(token, 'complete_chapter', { chapterId: 'C04' });
    assert.notEqual(result.response.status, 200, 'Players cannot skip directly to the finale');

    result = await action(token, 'use_hint', { hintId: 'H01', level: 1 });
    assert.equal(result.response.status, 200);
    assert(result.body.player.progress.hintsUsed.includes('H01:1'));
    assert.equal(result.body.game.hints.case_hints.find((hint) => hint.id === 'H01').revealed[1], 'Build a timeline before choosing a suspect.');

    await completeQuickCase(token);

    const answers = {
      q1: 'S01',
      q2: "Stop Blake from exposing Morgan's 2006 scholarship fraud",
      q3: 'Bronze Most Likely to Succeed trophy',
      q4: 'The group photo metadata showing 8:31 p.m.',
      q5: 'Morgan met Blake in the photo area over the scholarship and used the trophy, then hid it in the campaign box and used a false alibi.',
    };
    result = await jsonRequest('/api/accusation', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ answers }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.accusation.solved, true);
    assert.equal(result.body.accusation.score, 98, 'Permanent hint penalty should be applied');

    result = await jsonRequest('/api/accusation', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ answers }),
    });
    assert.equal(result.response.status, 409, 'Final accusation must be immutable');

    result = await jsonRequest('/api/leaderboard?session=OURMOMS');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.leaderboard[0].name, 'Test Table');
    assert.equal(result.body.leaderboard[0].score, 98);

    result = await jsonRequest('/api/host/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionCode: 'OURMOMS', pin: '2006' }),
    });
    assert.equal(result.response.status, 200);
    const hostToken = result.body.token;

    result = await jsonRequest('/api/host/session', {
      headers: { authorization: `Bearer ${hostToken}` },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.players.length, 1);
    const hostPayload = JSON.stringify(result.body.players[0]);
    assert(!hostPayload.includes('mobile'));
    assert(!hostPayload.includes('pin_hash'));
    assert(!hostPayload.includes('pinHash'));

    result = await jsonRequest('/api/host/qr', {
      headers: { authorization: `Bearer ${hostToken}` },
    });
    assert.equal(result.response.status, 200);
    assert(result.body.dataUrl.startsWith('data:image/png'));

    result = await jsonRequest('/api/host/session', {
      method: 'POST',
      headers: { authorization: `Bearer ${hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'OURMOMS', title: 'Duplicate', venue: 'Duplicate' }),
    });
    assert.equal(result.response.status, 409, 'Local JSON sessions must enforce unique codes');

    result = await jsonRequest('/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionCode: 'OURMOMS', name: 'Bad Input', mobile: '2255550199', pin: '4567',
        playMode: 'hacker-mode', caseLength: 'infinite',
      }),
    });
    assert.equal(result.response.status, 400, 'Unsupported registration values must be rejected');

    result = await jsonRequest('/api/no-such-endpoint');
    assert.equal(result.response.status, 404);
    assert.equal(result.body.error, 'API endpoint not found.');

    console.log('Smoke test passed: secure content, validated actions, immutable scoring, sanitized host data, leaderboard, and QR APIs.');
  } finally {
    child.kill('SIGTERM');
    await wait(250);
    resetDb();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
