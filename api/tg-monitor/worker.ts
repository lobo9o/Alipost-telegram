import sql from '../../lib/db.js';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';

// Regex per estrarre link Amazon e AliExpress dai messaggi
const PRODUCT_URL_RE = /https?:\/\/(?:[a-z0-9-]+\.)*(?:amazon\.[a-z.]+|amzn\.to|amzn\.eu|aliexpress\.com|s\.click\.aliexpress\.com|a\.aliexpress\.com)[^\s<>"')]+/gi;

// Mappa userId → client GramJS attivo
const activeClients = new Map<string, TelegramClient>();

let serverPort = 3000;
let cronSecret = '';

export function initTgMonitor(port: number) {
  serverPort = port;
  cronSecret = process.env.CRON_SECRET || '';
  startAll().catch(e => console.error('[tg-monitor] errore avvio:', e));
}

// Ricarica il monitoring per un singolo utente (chiamato da auth/channels)
export function reloadUser(userId: string) {
  stopUser(userId);
  startUser(userId).catch(e => console.error(`[tg-monitor] errore reload ${userId}:`, e));
}

async function startAll() {
  const sessions = await sql<{ user_id: string }[]>`
    SELECT user_id FROM tg_sessions WHERE status = 'active'
  `;
  for (const { user_id } of sessions) {
    await startUser(user_id).catch(e => console.error(`[tg-monitor] errore start ${user_id}:`, e));
  }
}

async function stopUser(userId: string) {
  const existing = activeClients.get(userId);
  if (existing) {
    try { await existing.disconnect(); } catch { /* ignora */ }
    activeClients.delete(userId);
  }
}

async function startUser(userId: string) {
  const [session] = await sql<{ session_string: string }[]>`
    SELECT session_string FROM tg_sessions WHERE user_id = ${userId} AND status = 'active'
  `;
  if (!session) return;

  const channels = await sql<{ channel: string }[]>`
    SELECT channel FROM tg_monitor_channels WHERE user_id = ${userId} AND active = true
  `;
  if (!channels.length) return;

  const apiId = parseInt(process.env.TG_API_ID || '0', 10);
  const apiHash = process.env.TG_API_HASH || '';
  if (!apiId || !apiHash) {
    console.warn('[tg-monitor] TG_API_ID/TG_API_HASH non configurati');
    return;
  }

  const client = new TelegramClient(
    new StringSession(session.session_string),
    apiId, apiHash,
    { connectionRetries: 5, useWSS: false }
  );

  await client.connect();
  activeClients.set(userId, client);

  const channelList = channels.map(c => c.channel);
  console.log(`[tg-monitor] ${userId} — monitoring: ${channelList.join(', ')}`);

  client.addEventHandler(async (event: any) => {
    try {
      const text: string = event.message?.message ?? '';
      if (!text) return;

      const urls = text.match(PRODUCT_URL_RE);
      if (!urls?.length) return;

      const seen = new Set<string>();
      for (const url of urls) {
        const clean = url.replace(/[.,;!?)]+$/, '');
        if (seen.has(clean)) continue;
        seen.add(clean);
        processUrl(userId, clean).catch(e => console.error('[tg-monitor] errore processUrl:', e));
      }
    } catch (e) {
      console.error('[tg-monitor] errore handler:', e);
    }
  }, new NewMessage({ chats: channelList }));
}

async function processUrl(userId: string, url: string) {
  console.log(`[tg-monitor] ${userId} — elaboro: ${url}`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-internal-user-id': userId,
  };
  if (cronSecret) headers['authorization'] = `Bearer ${cronSecret}`;

  // 1. Recupera dati prodotto
  const productRes = await fetch(
    `http://localhost:${serverPort}/api/product?url=${encodeURIComponent(url)}`,
    { headers }
  );
  if (!productRes.ok) {
    console.warn(`[tg-monitor] /api/product ${productRes.status} per ${url}`);
    return;
  }
  const product = await productRes.json() as any;
  if (!product?.title) {
    console.warn('[tg-monitor] nessun prodotto trovato per', url);
    return;
  }

  // 2. Carica le impostazioni utente per scegliere il layout e il template
  const settingsRes = await fetch(`http://localhost:${serverPort}/api/settings`, { headers });
  const settings = settingsRes.ok ? await settingsRes.json() as any : {};

  // 3. Costruisce il post
  const platform: 'amazon' | 'aliexpress' = url.toLowerCase().includes('aliexpress') ? 'aliexpress' : 'amazon';

  const post = {
    id: crypto.randomUUID(),
    platform,
    sourceUrl:       product.sourceUrl ?? url,
    productId:       product.productId ?? '',
    title:           product.title ?? '',
    image:           product.image ?? '',
    originalPrice:   product.originalPrice ?? 0,
    discountedPrice: product.discountedPrice ?? 0,
    discountPercent: product.discountPercent ?? 0,
    customText:      '',
    isHistoricalLow: product.isHistoricalLow ?? false,
    templateId:      settings.defaultTemplateId ?? '',
    layoutId:        settings.defaultLayoutId ?? '',
    emoji:           '',
    shipFromCountry: product.shipFromCountry ?? null,
    stelle:          product.stelle ?? '',
    recensioni:      product.recensioni ?? '',
    cat:             product.cat ?? '',
    author:          '',
    coupon:          product.coupon ?? '',
    boxcoupon:       product.boxcoupon ?? '',
  };

  // 4. Salva il post in bozza
  const postRes = await fetch(`http://localhost:${serverPort}/api/posts`, {
    method: 'POST',
    headers,
    body: JSON.stringify(post),
  });
  if (!postRes.ok) {
    console.warn('[tg-monitor] errore salvataggio post:', await postRes.text());
    return;
  }
  const savedPost = await postRes.json() as any;

  // 5. Aggiunge alla coda come bozza (status=draft, nessuna schedulazione)
  const queueRes = await fetch(`http://localhost:${serverPort}/api/autopost`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: crypto.randomUUID(),
      posts: [savedPost],
      status: 'draft',
      scheduled: null,
    }),
  });
  if (!queueRes.ok) {
    console.warn('[tg-monitor] errore aggiunta coda:', await queueRes.text());
    return;
  }

  console.log(`[tg-monitor] ${userId} — aggiunto in coda: "${product.title?.slice(0, 60)}"`);
}
