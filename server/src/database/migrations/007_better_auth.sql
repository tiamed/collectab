-- better-auth + better-invite integration
-- 1. Extend existing users table with better-auth admin plugin fields
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS image TEXT,
  ADD COLUMN IF NOT EXISTS role VARCHAR(255) DEFAULT 'guest',
  ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ban_reason TEXT,
  ADD COLUMN IF NOT EXISTS ban_expires TIMESTAMPTZ;

-- password_hash becomes nullable: OAuth-only users have no password
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- 2. better-auth session table
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  expires_at TIMESTAMPTZ NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  impersonated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_session_user ON session(user_id);
CREATE INDEX IF NOT EXISTS idx_session_token ON session(token);

-- 3. better-auth account table (OAuth-linked accounts)
CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  scope TEXT,
  password TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_user ON account(user_id);
CREATE INDEX IF NOT EXISTS idx_account_provider ON account(provider_id);

-- 4. better-auth verification table (email verification, password reset)
CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification(identifier);

-- 5. better-invite invitation tables
CREATE TABLE IF NOT EXISTS invite (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses INTEGER NOT NULL,
  infinity_max_uses BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  redirect_to_after_upgrade TEXT,
  share_inviter_name BOOLEAN NOT NULL,
  email TEXT,
  emails TEXT[],
  role VARCHAR(255) NOT NULL,
  new_account BOOLEAN,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_invite_token ON invite(token);

CREATE TABLE IF NOT EXISTS invite_use (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  invite_id TEXT NOT NULL REFERENCES invite(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ NOT NULL,
  used_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invite_use_invite ON invite_use(invite_id);
