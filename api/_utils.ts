import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import sql from '../lib/db.js';

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>;

let _migrated = false;

async function ensureMigrated() {
  if (_migrated) return;
  console.log('[DB] migrazione avviata');
  await sql`CREATE TABLE IF NOT EXISTS settings (
    id         SERIAL PRIMARY KEY,
    user_id    TEXT UNIQUE,
    data       JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS tags (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL DEFAULT 'legacy',
    name       TEXT NOT NULL,
    value      TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS layouts (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL DEFAULT 'legacy',
    nome       TEXT NOT NULL,
    tipo       TEXT NOT NULL CHECK (tipo IN ('normal', 'historical_low', 'multi')),
    body       TEXT NOT NULL DEFAULT '',
    active     BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS templates (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL DEFAULT 'legacy',
    nome          TEXT NOT NULL,
    tipo          TEXT NOT NULL CHECK (tipo IN ('normal', 'historical_low')),
    overlay       TEXT,
    logo          TEXT,
    badge_enabled BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS posts (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL DEFAULT 'legacy',
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
    user_id    TEXT NOT NULL DEFAULT 'legacy',
    posts      JSONB NOT NULL DEFAULT '[]',
    status     TEXT NOT NULL CHECK (status IN ('draft', 'scheduled', 'published', 'error')) DEFAULT 'draft',
    scheduled  TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS keyboards (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL DEFAULT 'legacy',
    nome       TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
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

  // Migrazioni per tabelle già esistenti (aggiunta colonna user_id)
  await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS user_id TEXT`;
  try {
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS settings_user_id_idx ON settings(user_id) WHERE user_id IS NOT NULL`;
  } catch (e: any) {
    if (e?.code !== '23505' && e?.code !== '42P07') throw e;
  }
  await sql`ALTER TABLE tags ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'legacy'`;
  await sql`ALTER TABLE layouts ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'legacy'`;
  await sql`ALTER TABLE templates ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'legacy'`;
  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'legacy'`;
  await sql`ALTER TABLE autopost_queue ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'legacy'`;
  await sql`ALTER TABLE templates ADD COLUMN IF NOT EXISTS config JSONB`;

  _migrated = true;
  console.log('[DB] migrazione completata');
}

export function getUserId(req: VercelRequest): string | null {
  const initData = req.headers['x-tg-init-data'] as string | undefined;
  if (!initData) return null;

  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  const params = new URLSearchParams(initData);
  const userStr = params.get('user');
  if (!userStr) return null;

  let userId: string;
  try {
    userId = String((JSON.parse(userStr) as { id: number }).id);
  } catch {
    return null;
  }

  // Se il bot token non è configurato, accettiamo senza verifica (fase di setup)
  if (!botToken) return userId;

  const hash = params.get('hash');
  if (!hash) return null;

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  return computedHash === hash ? userId : null;
}

export function requireUserId(req: VercelRequest, res: VercelResponse): string | null {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Apri l\'app tramite Telegram' });
    return null;
  }
  return userId;
}

export function withErrorHandler(handler: Handler): Handler {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
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
