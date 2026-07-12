CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  venue TEXT NOT NULL,
  is_open BOOLEAN NOT NULL DEFAULT TRUE,
  pacing_mode TEXT NOT NULL DEFAULT 'logical',
  version_mode TEXT NOT NULL DEFAULT 'rotating',
  fixed_version TEXT,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS version_mode TEXT NOT NULL DEFAULT 'rotating';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS fixed_version TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  play_mode TEXT NOT NULL,
  team_name TEXT,
  case_length TEXT NOT NULL,
  case_version TEXT NOT NULL DEFAULT 'A',
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, mobile)
);

ALTER TABLE players ADD COLUMN IF NOT EXISTS case_version TEXT NOT NULL DEFAULT 'A';

CREATE TABLE IF NOT EXISTS accusations (
  id UUID PRIMARY KEY,
  player_id UUID UNIQUE NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  answers JSONB NOT NULL,
  score INTEGER NOT NULL,
  rank_name TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_players_session ON players(session_id);
CREATE INDEX IF NOT EXISTS idx_players_mobile ON players(mobile);
CREATE INDEX IF NOT EXISTS idx_players_case_version ON players(session_id, case_version);
CREATE INDEX IF NOT EXISTS idx_accusations_score ON accusations(score DESC);
