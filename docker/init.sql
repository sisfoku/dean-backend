-- Users table
CREATE TABLE IF NOT EXISTS telegram_users (
  id BIGINT PRIMARY KEY,              -- Telegram user ID
  username VARCHAR(255),
  first_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Sessions table (stateful conversation)
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES telegram_users(id) ON DELETE CASCADE,
  step VARCHAR(50) DEFAULT 'start',   -- current step in flow
  data JSONB DEFAULT '{}',            -- collected answers
  last_prompt TEXT,                   -- last prompt sent to OpenAI
  last_image_url TEXT,                -- last generated image URL
  revision_count INT DEFAULT 0,
  last_active TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '24 hours',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Generation history
CREATE TABLE IF NOT EXISTS generations (
  id SERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES telegram_users(id) ON DELETE CASCADE,
  session_id INT REFERENCES sessions(id) ON DELETE SET NULL,
  prompt TEXT NOT NULL,
  image_url TEXT,
  design_type VARCHAR(100),
  status VARCHAR(50) DEFAULT 'success', -- success | failed
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_generations_user_id ON generations(user_id);

-- Assets table
CREATE TABLE IF NOT EXISTS assets (
  id SERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES telegram_users(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);
