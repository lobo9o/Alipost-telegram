import sql from '../../lib/db.js';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';

const PRODUCT_URL_RE = /https?:\/\/(?:[a-z0-9-]+\.)*(?:amazon\.[a-z.]+|amzn\.to|amzn\.eu|aliexpress\.com|s\.click\.aliexpress\.com|a\.aliexpress\.com)[^\s<>"')]+/gi;

const activeClients = new Map<string, TelegramClient>();

let serverPort = 3000;
let cronSecret = '';

export function initTgMonitor(port: number) {
  serverPort = port;
  cronSecret = process.env.CRON_SECRET || '';
  startAll().catch(e => console.error('[tg-monitor] errore avvio:', e));
}

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

  const channelRows = await sql<{ channel: string }[]>`
    SELECT channel FROM tg_monitor_channels WHERE user_id = ${userId} AND active = true
  `;
  if (!channelRows.length) return;

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

  // Risolve ogni canale nel suo ID numerico (più affidabile degli username per il filtro)
  const monitoredIds = new Set<string>();
  for (const { channel } of channelRows) {
    try {
      const entity = await client.getEntity(channel) as any;
      const id = String(entity.id);
      monitoredIds.add(id);
      // I canali hanno id negativo nella forma -100XXXXXXX
      monitoredIds.add(`-100${id}`);
      console.log(`[tg-monitor] ${userId} — canale "${channel}" → id ${id}`);
    } catch (e: any) {
      console.warn(`[tg-monitor] ${userId} — impossibile risolvere "${channel}": ${e.message}`);
    }
  }

  if (!monitoredIds.size) {
    console.warn(`[tg-monitor] ${userId} — nessun canale risolvibile, monitoring non avviato`);
    return;
  }

  // Ascolta TUTTI i messaggi, filtra manualmente per ID canale
  client.addEventHandler(async (event: any) => {
    try {
      const msg = event.message;
      if (!msg) return;

      const chatId = String(msg.chatId ?? msg.peerId?.channelId ?? '');
      const chatIdNeg = chatId ? `-100${chatId}` : '';

      // Controlla se il messaggio viene da uno dei canali monitorati
      if (!monitoredIds.has(chatId) && !monitoredIds.has(chatIdNeg)) return;

      const text: string = msg.message ?? '';
      console.log(`[tg-monitor] ${userId} — messaggio da ${chatId}: "${text.slice(0, 80)}"`);

      // Raccoglie URL sia dal testo che dalle entities (link con testo personalizzato)
      const urlSet = new Set<string>();

      // URL nel testo plain
      const textUrls = text.match(PRODUCT_URL_RE) ?? [];
      textUrls.forEach(u => urlSet.add(u));

      // URL nelle entities Telegram (MessageEntityTextUrl / MessageEntityUrl)
      const entities: any[] = msg.entities ?? [];
      for (const entity of entities) {
        const entityUrl: string = entity.url ?? entity.href ?? '';
        if (entityUrl) urlSet.add(entityUrl);
      }

      // Filtra solo URL Amazon/AliExpress
      const urls = [...urlSet].filter(u => PRODUCT_URL_RE.test(u));
      PRODUCT_URL_RE.lastIndex = 0; // reset dopo test()

      if (!urls.length) {
        console.log(`[tg-monitor] ${userId} — nessun link prodotto trovato (entities: ${entities.length})`);
        return;
      }
      console.log(`[tg-monitor] ${userId} — trovati ${urls.length} link: ${urls.join(', ').slice(0, 120)}`);

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
  }, new NewMessage({}));

  console.log(`[tg-monitor] ${userId} — in ascolto su ${monitoredIds.size / 2} canali`);
}

async function processUrl(userId: string, url: string) {
  console.log(`[tg-monitor] ${userId} — elaboro: ${url}`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-internal-user-id': userId,
  };
  if (cronSecret) headers['authorization'] = `Bearer ${cronSecret}`;

  // 1. Dati prodotto
  const platform: 'amazon' | 'aliexpress' = url.toLowerCase().includes('aliexpress') ? 'aliexpress' : 'amazon';
  const productRes = await fetch(
    `http://localhost:${serverPort}/api/product`,
    { method: 'POST', headers, body: JSON.stringify({ platform, url }) }
  );
  if (!productRes.ok) {
    console.warn(`[tg-monitor] /api/product ${productRes.status} per ${url}`);
    return;
  }
  const product = await productRes.json() as any;
  if (!product?.title) {
    console.warn(`[tg-monitor] prodotto non trovato per ${url}:`, JSON.stringify(product).slice(0, 200));
    return;
  }

  // 2. Layout attivo per la piattaforma (preferenza: tipo specifico → normal)
  const layoutTypes = platform === 'aliexpress'
    ? ['aliexpress', 'normal', 'amazon']
    : ['amazon', 'normal', 'aliexpress'];

  const layouts = await sql<{ id: string; tipo: string; active: boolean }[]>`
    SELECT id, tipo, active FROM layouts WHERE user_id = ${userId} ORDER BY created_at ASC
  `;
  let layoutId = '';
  for (const tipo of layoutTypes) {
    const match = layouts.find(l => l.tipo === tipo && l.active);
    if (match) { layoutId = match.id; break; }
  }
  if (!layoutId) {
    const any = layouts.find(l => l.active) ?? layouts[0];
    layoutId = any?.id ?? '';
  }

  // Template attivo
  const templates = await sql<{ id: string }[]>`
    SELECT id FROM templates WHERE user_id = ${userId} ORDER BY created_at ASC LIMIT 1
  `;
  const templateId = templates[0]?.id ?? '';

  console.log(`[tg-monitor] ${userId} — layout: ${layoutId || 'nessuno'} template: ${templateId || 'nessuno'}`);

  // 3. Costruisce il post
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
    templateId,
    layoutId,
    emoji:           '',
    shipFromCountry: product.shipFromCountry ?? null,
    stelle:          product.stelle ?? '',
    recensioni:      product.recensioni ?? '',
    cat:             product.cat ?? '',
    author:          '',
    coupon:          product.coupon ?? '',
    boxcoupon:       product.boxcoupon ?? '',
  };

  // 4. Salva bozza
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

  // 5. Aggiunge alla coda
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

  console.log(`[tg-monitor] ${userId} — ✅ aggiunto in coda: "${product.title?.slice(0, 60)}"`);
}
