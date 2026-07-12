CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  venue TEXT NOT NULL,
  is_open BOOLEAN NOT NULL DEFAULT TRUE,
  pacing_mode TEXT NOT NULL DEFAULT 'logical',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  play_mode TEXT NOT NULL,
  team_name TEXT,
  case_length TEXT NOT NULL,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, mobile)
);

CREATE TABLE IF NOT EXISTS accusations (
  id UUID PRIMARY KEY,
  player_id UUID UNIQUE NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  answers JSONB NOT NULL,
  score INTEGER NOT NULL,
  rank_name TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_players_session ON players(session_id);
CREATE INDEX IF NOT EXISTS idx_accusations_score ON accusations(score DESC);
