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

function readLocal() {
  if (!fs.existsSync(localPath)) return defaultLocal();
  try {
    const parsed = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    return {
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      players: Array.isArray(parsed.players) ? parsed.players : [],
      accusations: Array.isArray(parsed.accusations) ? parsed.accusations : [],
    };
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
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
  } else if (!fs.existsSync(localPath)) {
    writeLocal(defaultLocal());
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
  });
}

async function createSession({ code, title, venue, pacingMode = 'logical' }) {
  const normalizedCode = String(code).toUpperCase();
  const row = {
    id: randomUUID(),
    code: normalizedCode,
    title,
    venue,
    is_open: true,
    pacing_mode: pacingMode,
    created_at: new Date().toISOString(),
  };

  if (hasPg) {
    try {
      const result = await pool.query(
        `INSERT INTO sessions(id,code,title,venue,pacing_mode)
         VALUES($1,$2,$3,$4,$5)
         RETURNING *`,
        [row.id, row.code, row.title, row.venue, row.pacing_mode],
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
  if (data.sessions.some((session) => session.code === normalizedCode)) {
    const duplicate = new Error('That session code is already in use.');
    duplicate.code = 'DUPLICATE';
    throw duplicate;
  }
  data.sessions.push(row);
  writeLocal(data);
  return row;
}

async function getSessionByCode(code) {
  const normalizedCode = String(code || '').toUpperCase();
  if (hasPg) {
    const result = await pool.query('SELECT * FROM sessions WHERE code=$1', [normalizedCode]);
    return result.rows[0] || null;
  }
  return readLocal().sessions.find((session) => session.code === normalizedCode) || null;
}

async function getSessionById(id) {
  if (hasPg) {
    const result = await pool.query('SELECT * FROM sessions WHERE id=$1', [id]);
    return result.rows[0] || null;
  }
  return readLocal().sessions.find((session) => session.id === id) || null;
}

async function listSessions() {
  if (hasPg) {
    const result = await pool.query('SELECT * FROM sessions ORDER BY created_at DESC');
    return result.rows;
  }
  return readLocal().sessions.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function createPlayer(playerData) {
  const row = {
    id: randomUUID(),
    session_id: playerData.sessionId,
    name: playerData.name,
    mobile: playerData.mobile,
    pin_hash: playerData.pinHash,
    play_mode: playerData.playMode,
    team_name: playerData.teamName || null,
    case_length: playerData.caseLength,
    checked_in_at: new Date().toISOString(),
    progress: playerData.progress,
    created_at: new Date().toISOString(),
  };

  if (hasPg) {
    try {
      const result = await pool.query(
        `INSERT INTO players(
          id,session_id,name,mobile,pin_hash,play_mode,team_name,case_length,progress
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING *`,
        [
          row.id,
          row.session_id,
          row.name,
          row.mobile,
          row.pin_hash,
          row.play_mode,
          row.team_name,
          row.case_length,
          row.progress,
        ],
      );
      return result.rows[0];
    } catch (error) {
      if (error.code === '23505') {
        const duplicate = new Error('A player with this mobile number is already registered for this session.');
        duplicate.code = 'DUPLICATE';
        throw duplicate;
      }
      throw error;
    }
  }

  const data = readLocal();
  if (data.players.some((player) => player.session_id === row.session_id && player.mobile === row.mobile)) {
    const duplicate = new Error('A player with this mobile number is already registered for this session.');
    duplicate.code = 'DUPLICATE';
    throw duplicate;
  }
  data.players.push(row);
  writeLocal(data);
  return row;
}

async function findPlayerByMobile(sessionId, mobile) {
  if (hasPg) {
    const result = await pool.query(
      'SELECT * FROM players WHERE session_id=$1 AND mobile=$2',
      [sessionId, mobile],
    );
    return result.rows[0] || null;
  }
  return readLocal().players.find(
    (player) => player.session_id === sessionId && player.mobile === mobile,
  ) || null;
}

async function getPlayer(id) {
  if (hasPg) {
    const result = await pool.query('SELECT * FROM players WHERE id=$1', [id]);
    return result.rows[0] || null;
  }
  return readLocal().players.find((player) => player.id === id) || null;
}

async function savePlayerState(id, progress, caseLength) {
  if (hasPg) {
    const result = await pool.query(
      `UPDATE players
       SET progress=$2, case_length=COALESCE($3,case_length)
       WHERE id=$1
       RETURNING *`,
      [id, progress, caseLength || null],
    );
    return result.rows[0] || null;
  }
  const data = readLocal();
  const player = data.players.find((item) => item.id === id);
  if (!player) return null;
  player.progress = progress;
  if (caseLength) player.case_length = caseLength;
  writeLocal(data);
  return player;
}

async function listPlayers(sessionId) {
  if (hasPg) {
    const result = await pool.query(
      `SELECT p.*, a.score, a.rank_name, a.submitted_at
       FROM players p
       LEFT JOIN accusations a ON a.player_id=p.id
       WHERE p.session_id=$1
       ORDER BY p.created_at DESC`,
      [sessionId],
    );
    return result.rows;
  }
  const data = readLocal();
  return data.players
    .filter((player) => player.session_id === sessionId)
    .map((player) => {
      const accusation = data.accusations.find((item) => item.player_id === player.id);
      return {
        ...player,
        score: accusation?.score,
        rank_name: accusation?.rank_name,
        submitted_at: accusation?.submitted_at,
      };
    });
}

async function createAccusation(playerId, answers, score, rankName) {
  const row = {
    id: randomUUID(),
    player_id: playerId,
    answers,
    score,
    rank_name: rankName,
    submitted_at: new Date().toISOString(),
  };

  if (hasPg) {
    try {
      const result = await pool.query(
        `INSERT INTO accusations(id,player_id,answers,score,rank_name)
         VALUES($1,$2,$3,$4,$5)
         RETURNING *`,
        [row.id, row.player_id, row.answers, row.score, row.rank_name],
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
  if (data.accusations.some((item) => item.player_id === playerId)) {
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
  return readLocal().accusations.find((item) => item.player_id === playerId) || null;
}

async function leaderboard(sessionId) {
  const players = await listPlayers(sessionId);
  return players
    .filter((player) => Number.isFinite(Number(player.score)))
    .sort(
      (a, b) => Number(b.score) - Number(a.score)
        || String(a.submitted_at).localeCompare(String(b.submitted_at)),
    )
    .map((player, index) => ({
      place: index + 1,
      name: player.team_name || player.name,
      score: Number(player.score),
      rank: player.rank_name,
    }));
}

async function resetPlayer(id, freshProgress = {}) {
  if (hasPg) {
    await pool.query('DELETE FROM accusations WHERE player_id=$1', [id]);
    return savePlayerState(id, freshProgress, null);
  }
  const data = readLocal();
  const player = data.players.find((item) => item.id === id);
  if (!player) return null;
  player.progress = freshProgress;
  data.accusations = data.accusations.filter((item) => item.player_id !== id);
  writeLocal(data);
  return player;
}

async function setSessionOpen(id, isOpen) {
  if (hasPg) {
    const result = await pool.query(
      'UPDATE sessions SET is_open=$2 WHERE id=$1 RETURNING *',
      [id, isOpen],
    );
    return result.rows[0] || null;
  }
  const data = readLocal();
  const session = data.sessions.find((item) => item.id === id);
  if (!session) return null;
  session.is_open = Boolean(isOpen);
  writeLocal(data);
  return session;
}

module.exports = {
  init,
  createSession,
  getSessionByCode,
  getSessionById,
  listSessions,
  createPlayer,
  findPlayerByMobile,
  getPlayer,
  savePlayerState,
  listPlayers,
  createAccusation,
  getAccusation,
  leaderboard,
  resetPlayer,
  setSessionOpen,
};
