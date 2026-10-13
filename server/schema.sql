-- Boardgames Hub: accounts, friends, invites, finished matches.
-- Applied with: wrangler d1 execute boardgames --file=server/schema.sql
-- (add --local for the local wrangler dev database)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('user', 'guest')),
  password_hash TEXT,
  password_salt TEXT,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL,
  addressee_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at INTEGER NOT NULL,
  UNIQUE (requester_id, addressee_id),
  FOREIGN KEY (requester_id) REFERENCES users(id),
  FOREIGN KEY (addressee_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  room_code TEXT NOT NULL,
  game_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (from_id) REFERENCES users(id),
  FOREIGN KEY (to_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  room_code TEXT NOT NULL,
  p1_id TEXT NOT NULL,
  p2_id TEXT NOT NULL,
  winner_id TEXT,
  counted INTEGER NOT NULL DEFAULT 0,
  finished_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_req ON friendships(requester_id);
CREATE INDEX IF NOT EXISTS idx_friendships_add ON friendships(addressee_id);
CREATE INDEX IF NOT EXISTS idx_invites_to ON invites(to_id, status);
