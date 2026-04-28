-- PostDealBot Database Schema
-- Run once against your PostgreSQL database to initialize all tables.

-- ── Settings ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  id          SERIAL PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT now()
);
-- Insert default row if not present
INSERT INTO settings (id, data) VALUES (1, '{}') ON CONFLICT (id) DO NOTHING;

-- ── Tags ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  value      TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ── Text Layouts ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS layouts (
  id         TEXT PRIMARY KEY,
  nome       TEXT NOT NULL,
  tipo       TEXT NOT NULL CHECK (tipo IN ('normal', 'historical_low', 'multi')),
  body       TEXT NOT NULL DEFAULT '',
  active     BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ── Templates ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS templates (
  id             TEXT PRIMARY KEY,
  nome           TEXT NOT NULL,
  tipo           TEXT NOT NULL CHECK (tipo IN ('normal', 'historical_low')),
  overlay        TEXT,
  logo           TEXT,
  badge_enabled  BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ── Created Posts ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id                TEXT PRIMARY KEY,
  platform          TEXT NOT NULL CHECK (platform IN ('amazon', 'aliexpress')),
  source_url        TEXT NOT NULL DEFAULT '',
  product_id        TEXT NOT NULL DEFAULT '',
  title             TEXT NOT NULL DEFAULT '',
  image             TEXT NOT NULL DEFAULT '',
  original_price    NUMERIC(10,2) NOT NULL DEFAULT 0,
  discounted_price  NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_percent  INTEGER NOT NULL DEFAULT 0,
  custom_text       TEXT NOT NULL DEFAULT '',
  is_historical_low BOOLEAN NOT NULL DEFAULT false,
  template_id       TEXT NOT NULL DEFAULT '',
  layout_id         TEXT NOT NULL DEFAULT '',
  emoji             TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ── Autopost Queue ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS autopost_queue (
  id          TEXT PRIMARY KEY,
  posts       JSONB NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL CHECK (status IN ('draft', 'scheduled', 'published', 'error')) DEFAULT 'draft',
  scheduled   TIMESTAMP WITH TIME ZONE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ── Published Posts ──────────────────────────────────────────────────────────
-- Persistenza dei post pubblicati nella giornata corrente.
-- Eseguire se non già presente: CREATE TABLE ... o ALTER TABLE per aggiungere colonne.
CREATE TABLE IF NOT EXISTS published_posts (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  emoji             TEXT DEFAULT '',
  title             TEXT DEFAULT '',
  image             TEXT DEFAULT '',
  original_price    FLOAT DEFAULT 0,
  discounted_price  FLOAT DEFAULT 0,
  discount_percent  INT DEFAULT 0,
  platform          TEXT DEFAULT 'amazon',
  source_url        TEXT DEFAULT '',
  product_id        TEXT DEFAULT '',
  custom_text       TEXT DEFAULT '',
  layout_id         TEXT DEFAULT '',
  is_historical_low BOOLEAN DEFAULT false,
  chat_id           TEXT DEFAULT '',
  message_id        BIGINT DEFAULT 0,
  terminata         BOOLEAN DEFAULT false,
  published_at      TIMESTAMP WITH TIME ZONE DEFAULT now()
);
CREATE INDEX IF NOT EXISTS published_posts_user_date_idx ON published_posts (user_id, published_at DESC);

-- ── Price History ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_history (
  id          SERIAL PRIMARY KEY,
  product_id  TEXT NOT NULL,
  platform    TEXT NOT NULL,
  price       NUMERIC(10,2) NOT NULL,
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
CREATE INDEX IF NOT EXISTS price_history_product_idx ON price_history (product_id, platform, recorded_at DESC);
