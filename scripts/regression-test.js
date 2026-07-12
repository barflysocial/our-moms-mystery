const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dbPath = path.join(root, 'data', 'local-db.json');
const base = 'http://127.0.0.1:3312';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function resetDb() {
  fs.writeFileSync(dbPath, JSON.stringify({ sessions: [], players: [], accusations: [] }, null, 2));
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(base + url, options);
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

(async () => {
  resetDb();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: '3312',
      APP_SECRET: 'regression-secret',
      HOST_PIN: '2006',
      PUBLIC_BASE_URL: base,
    },
    stdio: 'inherit',
  });

  try {
    await wait(900);

    const registration = await jsonRequest('/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionCode: 'OURMOMS', name: 'Timer Test', mobile: '2255550131', pin: '1234',
        playMode: 'individual', caseLength: 'standard',
      }),
    });
    assert.equal(registration.response.status, 200);
    const token = registration.body.token;

    await action(token, 'view_evidence', { evidenceId: 'E01' });
    await action(token, 'view_evidence', { evidenceId: 'E02' });
    assert.equal((await action(token, 'complete_chapter', { chapterId: 'C00' })).response.status, 200);
    await action(token, 'view_evidence', { evidenceId: 'E03' });
    await action(token, 'view_evidence', { evidenceId: 'E04' });
    for (const suspectId of ['S01', 'S02', 'S03', 'S04', 'S05', 'S06']) {
      await action(token, 'open_suspect', { suspectId });
    }
    const timerBlock = await action(token, 'complete_chapter', { chapterId: 'C01' });
    assert.equal(timerBlock.response.status, 409, 'Soft minimum timing should block immediate completion');
    assert(timerBlock.body.minimumSecondsRemaining > 0);

    const quickRegistration = await jsonRequest('/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionCode: 'OURMOMS', name: 'Quick Test', mobile: '2255550132', pin: '1234',
        playMode: 'individual', caseLength: 'quick',
      }),
    });
    const extendedRegistration = await jsonRequest('/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionCode: 'OURMOMS', name: 'Extended Test', mobile: '2255550133', pin: '1234',
        playMode: 'individual', caseLength: 'extended',
      }),
    });
    assert.equal(quickRegistration.body.game.caseProfile.requiredSuspects, 4);
    assert.equal(extendedRegistration.body.game.caseProfile.requiredSuspects, 12);
    assert(extendedRegistration.body.game.chapters[1].min_seconds > quickRegistration.body.game.chapters[1].min_seconds);
    assert(extendedRegistration.body.game.evidence.length > quickRegistration.body.game.evidence.length);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await jsonRequest('/api/resume', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionCode: 'OURMOMS', mobile: '2255550131', pin: '9999' }),
      });
      assert.equal(response.response.status, 401);
    }
    const lockedPlayer = await jsonRequest('/api/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionCode: 'OURMOMS', mobile: '2255550131', pin: '9999' }),
    });
    assert.equal(lockedPlayer.response.status, 429, 'Player PIN attempts should be rate limited');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await jsonRequest('/api/host/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionCode: 'OURMOMS', pin: '9999' }),
      });
      assert.equal(response.response.status, 401);
    }
    const lockedHost = await jsonRequest('/api/host/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionCode: 'OURMOMS', pin: '9999' }),
    });
    assert.equal(lockedHost.response.status, 429, 'Host PIN attempts should be rate limited');

    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public', 'manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.start_url, '/?pwa=1');
    const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
    assert(appSource.includes("localStorage.getItem('reunionLastSession')"));
    assert(appSource.includes('Math.min(100'));
    const swSource = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
    assert(swSource.includes('reunion-v2-20260712'));
    assert(swSource.includes('fetch(request)'));
    assert(swSource.includes('caches.delete'));

    console.log('Regression test passed: pacing, distinct case modes, PIN throttling, PWA session retention, cache refresh, and progress clamp.');
  } finally {
    child.kill('SIGTERM');
    await wait(250);
    resetDb();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
