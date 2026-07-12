const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { Pool } = require('pg');

const localPath = path.join(__dirname, 'data', 'local-db.json');
const hasPg = Boolean(process.env.DATABASE_URL);
let pool;

function defaultLocal() {
  return { sessions: [], players: [], accusations: [] };
}

function normalizeLocal(parsed) {
  return {
    sessions: (Array.isArray(parsed?.sessions) ? parsed.sessions : []).map((session) => ({
      version_mode: 'rotating',
      fixed_version: null,
      pacing_mode: 'logical',
      is_open: true,
      scheduled_at: null,
      started_at: null,
      ended_at: null,
      ...session,
    })),
    players: (Array.isArray(parsed?.players) ? parsed.players : []).map((player) => ({
      case_version: 'A',
      ...player,
    })),
    accusations: Array.isArray(parsed?.accusations) ? parsed.accusations : [],
  };
}

function readLocal() {
  if (!fs.existsSync(localPath)) return defaultLocal();
  try {
    return normalizeLocal(JSON.parse(fs.readFileSync(localPath, 'utf8')));
  } catch {
    return defaultLocal();
  }
}

function writeLocal(data) {
  const tmpPath = `${localPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, localPath);
}

async function init() {
  if (hasPg) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
    await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  } else {
    writeLocal(readLocal());
  }
  await ensureDefaultSession();
}

async function ensureDefaultSession() {
  const existing = await getSessionByCode('OURMOMS');
  if (existing) return existing;
  return createSession({
    code: 'OURMOMS',
    title: "Reunion at Our Mom's",
    venue: "Our Mom's Restaurant & Bar",
    pacingMode: 'logical',
    versionMode: 'rotating',
    scheduledAt: new Date(Date.now() - 1000).toISOString(),
  });
}

async function createSession({ code, title, venue, pacingMode = 'logical', versionMode = 'rotating', fixedVersion = null, scheduledAt = null }) {
  const row = {
    id: randomUUID(),
    code: String(code).toUpperCase(),
    title,
    venue,
    is_open: true,
    pacing_mode: pacingMode,
    version_mode: versionMode,
    fixed_version: fixedVersion,
    scheduled_at: scheduledAt,
    started_at: null,
    ended_at: null,
    created_at: new Date().toISOString(),
  };
  if (hasPg) {
    try {
      const result = await pool.query(
        `INSERT INTO sessions(id,code,title,venue,pacing_mode,version_mode,fixed_version,scheduled_at,started_at,ended_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [row.id, row.code, row.title, row.venue, row.pacing_mode, row.version_mode, row.fixed_version, row.scheduled_at, row.started_at, row.ended_at],
      );
      return result.rows[0];
    } catch (error) {
      if (error.code === '23505') {
        const duplicate = new Error('That session code is already in use.');
        duplicate.code = 'DUPLICATE';
        throw duplicate;
      }
      throw error;
    }
  }
  const data = readLocal();
  if (data.sessions.some((session) => session.code === row.code)) {
    const duplicate = new Error('That session code is already in use.');
    duplicate.code = 'DUPLICATE';
    throw duplicate;
  }
  data.sessions.push(row);
  writeLocal(data);
  return row;
}

async function getSessionByCode(code) {
  const normalized = String(code || '').toUpperCase();
  if (hasPg) {
    const result = await pool.query('SELECT * FROM sessions WHERE code=$1', [normalized]);
    return result.rows[0] || null;
  }
  return readLocal().sessions.find((session) => session.code === normalized) || null;
}

async function getSessionById(id) {
  if (hasPg) {
    const result = await pool.query('SELECT * FROM sessions WHERE id=$1', [id]);
    return result.rows[0] || null;
  }
  return readLocal().sessions.find((session) => session.id === id) || null;
}

async function createPlayer(values) {
  const row = {
    id: randomUUID(),
    session_id: values.sessionId,
    name: values.name,
    mobile: values.mobile,
    pin_hash: values.pinHash,
    play_mode: values.playMode,
    team_name: values.teamName || null,
    case_length: values.caseLength,
    case_version: values.caseVersion,
    checked_in_at: new Date().toISOString(),
    progress: values.progress,
    created_at: new Date().toISOString(),
  };
  if (hasPg) {
    try {
      const result = await pool.query(
        `INSERT INTO players(id,session_id,name,mobile,pin_hash,play_mode,team_name,case_length,case_version,progress)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [row.id,row.session_id,row.name,row.mobile,row.pin_hash,row.play_mode,row.team_name,row.case_length,row.case_version,row.progress],
      );
      return result.rows[0];
    } catch (error) {
      if (error.code === '23505') {
        const duplicate = new Error('That mobile number is already registered for this session.');
        duplicate.code = 'DUPLICATE';
        throw duplicate;
      }
      throw error;
    }
  }
  const data = readLocal();
  if (data.players.some((p) => p.session_id === row.session_id && p.mobile === row.mobile)) {
    const duplicate = new Error('That mobile number is already registered for this session.');
    duplicate.code = 'DUPLICATE';
    throw duplicate;
  }
  data.players.push(row);
  writeLocal(data);
  return row;
}

async function findPlayerByMobile(sessionId, mobile) {
  if (hasPg) {
    const result = await pool.query('SELECT * FROM players WHERE session_id=$1 AND mobile=$2', [sessionId, mobile]);
    return result.rows[0] || null;
  }
  return readLocal().players.find((p) => p.session_id === sessionId && p.mobile === mobile) || null;
}

async function getPlayer(id) {
  if (hasPg) {
    const result = await pool.query('SELECT * FROM players WHERE id=$1', [id]);
    return result.rows[0] || null;
  }
  return readLocal().players.find((p) => p.id === id) || null;
}

async function playerVersionsByMobile(mobile) {
  if (hasPg) {
    const result = await pool.query('SELECT DISTINCT case_version FROM players WHERE mobile=$1', [mobile]);
    return result.rows.map((row) => row.case_version);
  }
  return [...new Set(readLocal().players.filter((p) => p.mobile === mobile).map((p) => p.case_version))];
}

async function versionCounts(sessionId) {
  if (hasPg) {
    const result = await pool.query(
      'SELECT case_version, COUNT(*)::int AS count FROM players WHERE session_id=$1 GROUP BY case_version',
      [sessionId],
    );
    return Object.fromEntries(result.rows.map((row) => [row.case_version, Number(row.count)]));
  }
  const counts = {};
  for (const player of readLocal().players.filter((p) => p.session_id === sessionId)) {
    counts[player.case_version] = (counts[player.case_version] || 0) + 1;
  }
  return counts;
}

async function savePlayerState(id, progress) {
  if (hasPg) {
    const result = await pool.query('UPDATE players SET progress=$2 WHERE id=$1 RETURNING *', [id, progress]);
    return result.rows[0] || null;
  }
  const data = readLocal();
  const player = data.players.find((p) => p.id === id);
  if (!player) return null;
  player.progress = progress;
  writeLocal(data);
  return player;
}

async function listPlayers(sessionId) {
  if (hasPg) {
    const result = await pool.query(
      `SELECT p.*, a.score, a.rank_name, a.submitted_at
       FROM players p LEFT JOIN accusations a ON a.player_id=p.id
       WHERE p.session_id=$1 ORDER BY p.created_at DESC`,
      [sessionId],
    );
    return result.rows;
  }
  const data = readLocal();
  return data.players.filter((p) => p.session_id === sessionId).map((player) => {
    const accusation = data.accusations.find((a) => a.player_id === player.id);
    return { ...player, score: accusation?.score, rank_name: accusation?.rank_name, submitted_at: accusation?.submitted_at };
  });
}

async function createAccusation(playerId, answers, score, rankName) {
  const row = { id: randomUUID(), player_id: playerId, answers, score, rank_name: rankName, submitted_at: new Date().toISOString() };
  if (hasPg) {
    try {
      const result = await pool.query(
        'INSERT INTO accusations(id,player_id,answers,score,rank_name) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [row.id,row.player_id,row.answers,row.score,row.rank_name],
      );
      return result.rows[0];
    } catch (error) {
      if (error.code === '23505') {
        const duplicate = new Error('Your final accusation has already been submitted.');
        duplicate.code = 'DUPLICATE';
        throw duplicate;
      }
      throw error;
    }
  }
  const data = readLocal();
  if (data.accusations.some((a) => a.player_id === playerId)) {
    const duplicate = new Error('Your final accusation has already been submitted.');
    duplicate.code = 'DUPLICATE';
    throw duplicate;
  }
  data.accusations.push(row);
  writeLocal(data);
  return row;
}

async function getAccusation(playerId) {
  if (hasPg) {
    const result = await pool.query('SELECT * FROM accusations WHERE player_id=$1', [playerId]);
    return result.rows[0] || null;
  }
  return readLocal().accusations.find((a) => a.player_id === playerId) || null;
}

async function leaderboard(sessionId) {
  const players = await listPlayers(sessionId);
  return players.filter((p) => Number.isFinite(Number(p.score)))
    .sort((a,b) => Number(b.score)-Number(a.score) || String(a.submitted_at).localeCompare(String(b.submitted_at)))
    .map((p,index) => ({ place:index+1, name:p.team_name || p.name, score:Number(p.score), rank:p.rank_name }));
}

async function resetPlayer(id, freshProgress) {
  if (hasPg) {
    await pool.query('DELETE FROM accusations WHERE player_id=$1', [id]);
    return savePlayerState(id, freshProgress);
  }
  const data = readLocal();
  const player = data.players.find((p) => p.id === id);
  if (!player) return null;
  player.progress = freshProgress;
  data.accusations = data.accusations.filter((a) => a.player_id !== id);
  writeLocal(data);
  return player;
}

async function setSessionOpen(id, isOpen) {
  if (hasPg) {
    const result = await pool.query('UPDATE sessions SET is_open=$2 WHERE id=$1 RETURNING *', [id, isOpen]);
    return result.rows[0] || null;
  }
  const data = readLocal();
  const session = data.sessions.find((s) => s.id === id);
  if (!session) return null;
  session.is_open = Boolean(isOpen);
  writeLocal(data);
  return session;
}


async function setSessionSchedule(id, scheduledAt) {
  if (hasPg) {
    const result = await pool.query(
      'UPDATE sessions SET scheduled_at=$2, started_at=NULL, ended_at=NULL WHERE id=$1 RETURNING *',
      [id, scheduledAt],
    );
    return result.rows[0] || null;
  }
  const data = readLocal();
  const session = data.sessions.find((s) => s.id === id);
  if (!session) return null;
  session.scheduled_at = scheduledAt;
  session.started_at = null;
  session.ended_at = null;
  writeLocal(data);
  return session;
}

async function markSessionStarted(id, startedAt) {
  if (hasPg) {
    const result = await pool.query(
      'UPDATE sessions SET started_at=COALESCE(started_at,$2) WHERE id=$1 RETURNING *',
      [id, startedAt],
    );
    return result.rows[0] || null;
  }
  const data = readLocal();
  const session = data.sessions.find((s) => s.id === id);
  if (!session) return null;
  if (!session.started_at) session.started_at = startedAt;
  writeLocal(data);
  return session;
}

async function setSessionVersionMode(id, versionMode, fixedVersion = null) {
  if (hasPg) {
    const result = await pool.query(
      'UPDATE sessions SET version_mode=$2, fixed_version=$3 WHERE id=$1 RETURNING *',
      [id, versionMode, fixedVersion],
    );
    return result.rows[0] || null;
  }
  const data = readLocal();
  const session = data.sessions.find((s) => s.id === id);
  if (!session) return null;
  session.version_mode = versionMode;
  session.fixed_version = fixedVersion;
  writeLocal(data);
  return session;
}

module.exports = {
  init, createSession, getSessionByCode, getSessionById, createPlayer, findPlayerByMobile,
  getPlayer, playerVersionsByMobile, versionCounts, savePlayerState, listPlayers,
  createAccusation, getAccusation, leaderboard, resetPlayer, setSessionOpen,
  setSessionVersionMode, setSessionSchedule, markSessionStarted,
};
