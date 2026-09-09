import sql from './db.js';

const POSTTAP_API = 'https://creators.posttap.com/api/create-shortlink';

export interface PostTapConfig {
  enabled: boolean;
  cookie: string;
}

// Cache permanente per la durata del processo: i shortlink non scadono
const _cache = new Map<string, string>();

// Cache in-memory: evita query DB ripetute nello stesso processo
const _alreadyNotified = new Set<string>();

async function _notifyExpired(userId: string, botToken: string): Promise<void> {
  const baseUserId = userId.includes(':') ? userId.split(':')[0] : userId;

  // Fast path: già notificato in questa sessione del processo
  if (_alreadyNotified.has(baseUserId)) return;

  // Persistent check: già notificato in DB (sopravvive ai restart di pm2)
  try {
    const [row] = await sql<{ notified_expired: boolean }[]>`
      SELECT notified_expired FROM posttap_sessions WHERE user_id = ${baseUserId}
    `.catch(() => [] as any[]);
    if (row?.notified_expired) {
      _alreadyNotified.add(baseUserId);
      return;
    }
  } catch { /* ignora errori DB */ }

  // Marca come notificato prima di inviare (evita duplicati in caso di concorrenza)
  _alreadyNotified.add(baseUserId);
  await sql`UPDATE posttap_sessions SET notified_expired = TRUE WHERE user_id = ${baseUserId}`.catch(() => {});

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: baseUserId,
      text: '⚠️ <b>PostTap: sessione scaduta</b>\n\nI cookie PostTap non sono più validi. I link vengono pubblicati in formato originale.\n\nVai in Impostazioni → PostTap e aggiorna i cookie.',
      parse_mode: 'HTML',
    }),
  }).catch(() => {});
}

export async function wrapWithPostTap(
  url: string,
  name: string,
  config: PostTapConfig | undefined,
  ctx: { userId?: string; botToken?: string } = {},
): Promise<string> {
  console.log(`[posttap] wrapWithPostTap chiamato: url="${url.slice(0, 80)}" enabled=${config?.enabled} hasCookie=${!!config?.cookie}`);
  if (!config?.enabled || !config.cookie || !url) return url;

  const cached = _cache.get(url);
  if (cached) return cached;

  try {
    const res = await fetch(POSTTAP_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': config.cookie,
        'Origin': 'https://creators.posttap.com',
        'Referer': 'https://creators.posttap.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({ entrySource: 'topnav-input', name: name.slice(0, 120), tags: [], url }),
    });

    if (res.status === 401 || res.status === 403) {
      console.warn('[posttap] cookie scaduto — fallback URL originale');
      if (ctx.userId && ctx.botToken) _notifyExpired(ctx.userId, ctx.botToken).catch(() => {});
      return url;
    }

    if (!res.ok) {
      console.warn(`[posttap] errore HTTP ${res.status} — fallback URL originale`);
      return url;
    }

    const data = await res.json() as { meta?: { status: string }; object?: { shortlink: string } };
    const shortlink = data?.object?.shortlink;
    if (!shortlink) return url;

    _cache.set(url, shortlink);
    console.log(`[posttap] ${url.slice(0, 60)} → ${shortlink}`);
    return shortlink;
  } catch (e: any) {
    console.warn(`[posttap] errore fetch: ${e.message} — fallback URL originale`);
    return url;
  }
}
