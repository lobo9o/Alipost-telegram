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

  // Watchdog: ogni 5 minuti controlla se i client sono ancora connessi
  setInterval(() => {
    for (const [userId, client] of activeClients) {
      if (!client.connected) {
        console.log(`[tg-monitor] ${userId} — client disconnesso, riavvio...`);
        reloadUser(userId);
      }
    }
  }, 5 * 60 * 1000);
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
    {
      connectionRetries: 10,
      retryDelay: 2000,
      autoReconnect: true,
      useWSS: false,
      requestRetries: 5,
      floodSleepThreshold: 60,
    }
  );

  await client.connect();
  // Breve pausa per stabilizzare la connessione prima di chiamare getEntity
  await new Promise(r => setTimeout(r, 3000));
  activeClients.set(userId, client);

  // Normalizza un ID canale Telegram nelle sue forme canoniche
  // es. "-1003798740494" → core="3798740494", aggiunge anche "-1003798740494"
  function addChannelIds(id: string | bigint) {
    const s = String(id).replace(/^-/, '');
    const core = s.startsWith('100') && s.length >= 12 ? s.slice(3) : s;
    monitoredIds.add(core);
    monitoredIds.add(`-100${core}`);
    monitoredIds.add(s); // forma con eventuale prefisso 100
  }

  // Risolve ogni canale nel suo ID numerico
  const monitoredIds = new Set<string>();
  const unresolvedChannels: string[] = []; // canali username non risolti all'avvio

  console.log(`[tg-monitor] ${userId} — canali da risolvere: ${channelRows.map(r => r.channel).join(', ')}`);

  for (const { channel } of channelRows) {
    const isNumeric = /^-?\d+$/.test(channel);
    if (isNumeric) addChannelIds(channel); // fallback immediato per ID numerici

    let resolved = false;
    for (let attempt = 1; attempt <= 3 && !resolved; attempt++) {
      try {
        if (attempt > 1) await new Promise(r => setTimeout(r, 4000 * attempt));
        const entityRef: any = isNumeric ? BigInt(channel) : channel;
        const entity = await client.getEntity(entityRef) as any;
        addChannelIds(entity.id);
        // Forza la sottoscrizione agli aggiornamenti del canale per questa sessione GramJS
        await client.getMessages(entity, { limit: 1 }).catch(() => {});
        console.log(`[tg-monitor] ${userId} — canale "${channel}" → id ${entity.id} (tentativo ${attempt})`);
        resolved = true;
      } catch (e: any) {
        console.warn(`[tg-monitor] ${userId} — tentativo ${attempt}/3 fallito per "${channel}": ${e.message}`);
      }
    }
    if (!resolved && !isNumeric) unresolvedChannels.push(channel);
  }

  console.log(`[tg-monitor] ${userId} — monitoredIds dopo risoluzione: [${[...monitoredIds].join(', ')}]`);

  if (!monitoredIds.size) {
    console.warn(`[tg-monitor] ${userId} — nessun canale risolvibile, monitoring non avviato`);
    return;
  }

  // Ascolta TUTTI i messaggi, filtra manualmente per ID canale
  client.addEventHandler(async (event: any) => {
    try {
      const msg = event.message;
      if (!msg) return;

      const rawId = String(msg.chatId ?? msg.peerId?.channelId ?? '');
      if (!rawId || rawId === '0') return;

      // Normalizza per il matching: estrae il core ID
      const pos = rawId.replace(/^-/, '');
      const core = pos.startsWith('100') && pos.length >= 12 ? pos.slice(3) : pos;
      let isMonitored = monitoredIds.has(rawId) || monitoredIds.has(core) || monitoredIds.has(`-100${core}`);

      // Lazy resolution: se non è monitorato e ci sono canali username non risolti all'avvio,
      // prova a risolverli ora e controlla se corrispondono al chatId ricevuto
      if (!isMonitored && unresolvedChannels.length > 0) {
        for (let i = unresolvedChannels.length - 1; i >= 0; i--) {
          const ch = unresolvedChannels[i];
          try {
            const entity = await client.getEntity(ch) as any;
            addChannelIds(entity.id);
            console.log(`[tg-monitor] ${userId} — risolto lazily "${ch}" → ${entity.id}`);
            unresolvedChannels.splice(i, 1); // rimosso dalla lista pending
          } catch { /* ignora */ }
        }
        isMonitored = monitoredIds.has(rawId) || monitoredIds.has(core) || monitoredIds.has(`-100${core}`);
      }

      console.log(`[tg-monitor] ${userId} — msg chatId=${rawId} monitored=${isMonitored}`);
      if (!isMonitored) return;

      const text: string = msg.message ?? '';
      console.log(`[tg-monitor] ${userId} — messaggio da ${rawId}: "${text.slice(0, 80)}"`);

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

      // Deduplica URL
      const uniqueUrls: string[] = [];
      const seen = new Set<string>();
      for (const url of urls) {
        const clean = url.replace(/[.,;!?)]+$/, '');
        if (!seen.has(clean)) { seen.add(clean); uniqueUrls.push(clean); }
      }

      // 1 link → post singolo, 2+ link → post multiplo
      processMessage(userId, uniqueUrls).catch(e => console.error('[tg-monitor] errore processMessage:', e));
    } catch (e) {
      console.error('[tg-monitor] errore handler:', e);
    }
  }, new NewMessage({}));

  console.log(`[tg-monitor] ${userId} — in ascolto su ${monitoredIds.size / 2} canali`);
}

// Recupera layout e template dal DB per l'utente
async function getUserLayouts(userId: string) {
  const layouts = await sql<{ id: string; tipo: string; active: boolean }[]>`
    SELECT id, tipo, active FROM layouts WHERE user_id = ${userId} ORDER BY created_at ASC
  `;
  const templates = await sql<{ id: string }[]>`
    SELECT id FROM templates WHERE user_id = ${userId} ORDER BY created_at ASC LIMIT 1
  `;
  const templateId = templates[0]?.id ?? '';

  const getLayoutId = (platform: 'amazon' | 'aliexpress', multi = false): string => {
    if (multi) {
      const m = layouts.find(l => l.tipo === 'multi' && l.active);
      if (m) return m.id;
    }
    const order = platform === 'aliexpress'
      ? ['aliexpress', 'normal', 'amazon']
      : ['amazon', 'normal', 'aliexpress'];
    for (const tipo of order) {
      const match = layouts.find(l => l.tipo === tipo && l.active);
      if (match) return match.id;
    }
    return layouts.find(l => l.active)?.id ?? layouts[0]?.id ?? '';
  };

  return { getLayoutId, templateId };
}

// Processa un singolo URL e restituisce il post salvato, o null se fallisce
async function fetchProduct(userId: string, url: string, headers: Record<string, string>): Promise<any | null> {
  const platform: 'amazon' | 'aliexpress' = url.toLowerCase().includes('aliexpress') ? 'aliexpress' : 'amazon';
  console.log(`[tg-monitor] ${userId} — elaboro: ${url}`);

  const productRes = await fetch(
    `http://localhost:${serverPort}/api/product`,
    { method: 'POST', headers, body: JSON.stringify({ platform, url }) }
  );
  if (!productRes.ok) {
    console.warn(`[tg-monitor] /api/product ${productRes.status} per ${url}`);
    return null;
  }
  const product = await productRes.json() as any;
  if (!product?.title) {
    console.warn(`[tg-monitor] prodotto non trovato per ${url}`);
    return null;
  }
  return { ...product, _platform: platform };
}

async function processMessage(userId: string, urls: string[]) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-internal-user-id': userId,
  };
  if (cronSecret) headers['authorization'] = `Bearer ${cronSecret}`;

  const { getLayoutId, templateId } = await getUserLayouts(userId);
  const isMulti = urls.length > 1;

  // Processa tutti i link in parallelo
  const products = (await Promise.all(urls.map(u => fetchProduct(userId, u, headers)))).filter(Boolean);
  if (!products.length) return;

  console.log(`[tg-monitor] ${userId} — ${isMulti ? 'post multiplo' : 'post singolo'} con ${products.length}/${urls.length} prodotti`);

  // Costruisce e salva ogni post
  const savedPosts: any[] = [];
  for (const product of products) {
    const platform: 'amazon' | 'aliexpress' = product._platform;
    const layoutId = getLayoutId(platform, isMulti);

    const post = {
      id:              crypto.randomUUID(),
      platform,
      sourceUrl:       product.sourceUrl ?? '',
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

    const postRes = await fetch(`http://localhost:${serverPort}/api/posts`, {
      method: 'POST', headers, body: JSON.stringify(post),
    });
    if (!postRes.ok) { console.warn('[tg-monitor] errore salvataggio post:', await postRes.text()); continue; }
    savedPosts.push(await postRes.json());
  }

  if (!savedPosts.length) return;

  // Aggiunge alla coda: tutti i post in un unico elemento (singolo o multiplo)
  const queueRes = await fetch(`http://localhost:${serverPort}/api/autopost`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: crypto.randomUUID(),
      posts: savedPosts,
      status: 'draft',
      scheduled: null,
    }),
  });
  if (!queueRes.ok) {
    console.warn('[tg-monitor] errore aggiunta coda:', await queueRes.text());
    return;
  }

  const titles = savedPosts.map((p: any) => p.title?.slice(0, 40)).join(' + ');
  console.log(`[tg-monitor] ${userId} — ✅ ${isMulti ? 'multiplo' : 'singolo'} in coda: "${titles}"`);
}
