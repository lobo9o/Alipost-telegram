import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../lib/db.js';

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>;

let _migrated = false;

async function ensureMigrated() {
  if (_migrated) return;
  console.log('[DB] migrazione avviata');
  await sql`CREATE TABLE IF NOT EXISTS settings (
    id         SERIAL PRIMARY KEY,
    data       JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
  )`;
  await sql`INSERT INTO settings (id, data) VALUES (1, '{}') ON CONFLICT (id) DO NOTHING`;
  await sql`CREATE TABLE IF NOT EXISTS tags (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    value      TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS layouts (
    id         TEXT PRIMARY KEY,
    nome       TEXT NOT NULL,
    tipo       TEXT NOT NULL CHECK (tipo IN ('normal', 'historical_low', 'multi')),
    body       TEXT NOT NULL DEFAULT '',
    active     BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS templates (
    id            TEXT PRIMARY KEY,
    nome          TEXT NOT NULL,
    tipo          TEXT NOT NULL CHECK (tipo IN ('normal', 'historical_low')),
    overlay       TEXT,
    logo          TEXT,
    badge_enabled BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS posts (
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
  )`;
  await sql`CREATE TABLE IF NOT EXISTS autopost_queue (
    id         TEXT PRIMARY KEY,
    posts      JSONB NOT NULL DEFAULT '[]',
    status     TEXT NOT NULL CHECK (status IN ('draft', 'scheduled', 'published', 'error')) DEFAULT 'draft',
    scheduled  TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS price_history (
    id          SERIAL PRIMARY KEY,
    product_id  TEXT NOT NULL,
    platform    TEXT NOT NULL,
    price       NUMERIC(10,2) NOT NULL,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS price_history_product_idx
    ON price_history (product_id, platform, recorded_at DESC)`;
  _migrated = true;
  console.log('[DB] migrazione completata');
}

export function withErrorHandler(handler: Handler): Handler {
  return async (req, res) => {
    try {
      await ensureMigrated();
      await handler(req, res);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('[API Error]', err);
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      }
    }
  };
}

export function allowMethods(allowed: string[], req: VercelRequest, res: VercelResponse): boolean {
  if (!allowed.includes(req.method ?? '')) {
    res.setHeader('Allow', allowed.join(', '));
    res.status(405).json({ error: 'Method not allowed' });
    return false;
  }
  return true;
}
