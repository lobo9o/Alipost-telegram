import sql from '../../lib/db.js';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';

const PRODUCT_URL_RE = /https?:\/\/(?:[a-z0-9-]+\.)*(?:amazon\.[a-z.]+|amzn\.to|amzn\.eu|aliexpress\.com|s\.click\.aliexpress\.com|a\.aliexpress\.com)[^\s<>"')]+/gi;

function extractCouponFromText(text: string): { couponCode: string; textPrice: number; textOriginalPrice: number; textCountry: string } {
  // Coupon: "Coupon: ZSCADDR6" / "✂️ Coupon➡️ H45Z8AJZ" / "codice: X" / "promo: X" / "✂ ABCD1234"
  const couponM =
    text.match(/(?:coupon|codice|code|promo)[^A-Za-z0-9\n]{0,15}([A-Za-z0-9]{4,20})/i) ??
    text.match(/[✂🎟][^\w\n]{0,10}([A-Za-z0-9]{4,20})/u);
  const couponCode = couponM ? couponM[1].toUpperCase() : '';

  // Prezzi con € o $ sia dopo (12,99€) sia prima (€12.99 / $12.99)
  const priceAfter = [...text.matchAll(/([\d]+[,.][\d]{2})\s*[€$]/g)].map(m => parseFloat(m[1].replace(',', '.')) || 0);
  const priceBefore = [...text.matchAll(/[€$]\s*([\d]+[,.][\d]{2})/g)].map(m => parseFloat(m[1].replace(',', '.')) || 0);
  const prices = [...priceAfter, ...priceBefore].filter(p => p > 0.5 && p < 10000);

  const textPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice  = prices.length >= 2 ? Math.max(...prices) : 0;
  const textOriginalPrice = maxPrice > textPrice ? maxPrice : 0;

  // Flag emoji → country code (es. 🇨🇳 → "CN")
  const flagM = text.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
  let textCountry = '';
  if (flagM) {
    const cp0 = (flagM[0].codePointAt(0) ?? 0x1F1E6) - 0x1F1E6;
    const cp1 = (flagM[0].codePointAt(2) ?? 0x1F1E6) - 0x1F1E6;
    textCountry = String.fromCharCode(65 + cp0, 65 + cp1);
  }

  return { couponCode, textPrice, textOriginalPrice, textCountry };
}

const activeClients = new Map<string, TelegramClient>();
const activePolls = new Map<string, ReturnType<typeof setTimeout>>();
const activeWatchdogs = new Map<string, ReturnType<typeof setInterval>>();

// Fascia attiva: 06:00-01:00 ora italiana. Fuori da essa il poll rallenta.
function isActiveHours(): boolean {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).formatToParts(new Date());
  const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
  return h < 1 || h >= 6;
}

// Dedup in-memory: productId già processati per userId → auto-cleared dopo 24h.
// Risolve la race condition tra due canali che pubblicano lo stesso prodotto
// quasi in simultanea: check+add sono sincroni → atomici nel single-thread Node.js.
const recentlyProcessedProducts = new Map<string, Set<string>>();

// Dedup prodotti: controlla sul DB se gli stessi productId sono già in coda
// (resistente ai riavvii PM2, a differenza della precedente versione in-memory)
async function wasRecentlyQueuedDB(userId: string, productIds: string[]): Promise<boolean> {
  if (!productIds.length) return false;
  const normalizeId = (s: string) => s.trim().toUpperCase();
  const targetIds = productIds.map(normalizeId).filter(Boolean);
  if (!targetIds.length) return false;
  try {
    // 1) Controlla draft in coda (non ancora pubblicati)
    const drafts = await sql<{ posts: unknown; created_at: string }[]>`
      SELECT posts, created_at FROM autopost_queue
      WHERE user_id = ${userId} AND status = 'draft'
    `;
    for (const row of drafts) {
      const posts: any[] = typeof row.posts === 'string' ? JSON.parse(row.posts) : (row.posts as any[]) ?? [];
      const ids = posts.map((p: any) => normalizeId(String(p.productId ?? p.asin ?? ''))).filter(Boolean);
      const hit = targetIds.find(id => ids.includes(id));
      if (hit) { console.log(`[tg-monitor] dedup DB: trovato ${hit} in draft (${row.created_at})`); return true; }
    }
    // 2) Controlla già pubblicati nelle ultime 24h (la coda li elimina dopo la publish,
    //    quindi bisogna cercare in published_posts)
    const published = await sql<{ product_id: string; published_at: string }[]>`
      SELECT product_id, published_at FROM published_posts
      WHERE user_id = ${userId}
        AND published_at > NOW() - INTERVAL '24 hours'
        AND product_id = ANY(${targetIds})
      LIMIT 1
    `;
    if (published.length) {
      console.log(`[tg-monitor] dedup DB: trovato ${published[0].product_id} in published_posts (${published[0].published_at})`);
      return true;
    }
  } catch (e: any) { console.warn('[tg-monitor] wasRecentlyQueuedDB errore:', e.message); }
  return false;
}

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
  const isDevInstance = serverPort === 3001;
  const isDevUser = userId.endsWith('_dev');
  if (isDevInstance !== isDevUser) {
    console.log(`[tg-monitor] reloadUser ${userId} ignorato: non appartiene a questa istanza (${isDevInstance ? 'dev' : 'stable'})`);
    return;
  }
  // Await stopUser prima di startUser: evita race condition tra vecchio poll e nuovo
  stopUser(userId).then(() =>
    startUser(userId).catch(e => console.error(`[tg-monitor] errore reload ${userId}:`, e))
  );
}

async function startAll() {
  const sessions = await sql<{ user_id: string }[]>`
    SELECT user_id FROM tg_sessions WHERE status = 'active'
  `;
  // Ogni istanza gestisce solo i propri utenti:
  // - dev (porta 3001): user_id che finisce con _dev
  // - stable (porta 3000): tutti gli altri
  // Questo evita che entrambe le istanze monitorino lo stesso canale → doppioni.
  const isDevInstance = serverPort === 3001;
  const myUsers = sessions.filter(s =>
    isDevInstance ? s.user_id.endsWith('_dev') : !s.user_id.endsWith('_dev')
  );
  console.log(`[tg-monitor] istanza ${isDevInstance ? 'dev' : 'stable'} (porta ${serverPort}) — utenti: ${myUsers.map(s => s.user_id).join(', ') || 'nessuno'}`);
  for (const { user_id } of myUsers) {
    await startUser(user_id).catch(e => console.error(`[tg-monitor] errore start ${user_id}:`, e));
  }
}

async function stopUser(userId: string) {
  // Rimuovi subito da maps (sincrono) prima di qualsiasi async,
  // così startUser non trova valori stale se parte in parallelo
  const poll = activePolls.get(userId);
  if (poll) { clearTimeout(poll); activePolls.delete(userId); }
  const watchdog = activeWatchdogs.get(userId);
  if (watchdog) { clearInterval(watchdog); activeWatchdogs.delete(userId); }
  const existing = activeClients.get(userId);
  if (existing) {
    activeClients.delete(userId);
    try { await existing.disconnect(); } catch { /* ignora */ }
  }
}

async function startUser(userId: string) {
  const [session] = await sql<{ session_string: string }[]>`
    SELECT session_string FROM tg_sessions WHERE user_id = ${userId} AND status = 'active'
  `;
  if (!session) return;

  const channelRows = await sql<{ channel: string; auto_publish: boolean }[]>`
    SELECT channel, COALESCE(auto_publish, false) AS auto_publish FROM tg_monitor_channels WHERE user_id = ${userId} AND active = true
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
  // Carica i dialoghi per inizializzare il pts di ogni canale — senza questo
  // GramJS non riceve aggiornamenti dai canali non ancora "visti" dalla sessione
  await client.getDialogs({ limit: 100 }).catch(() => {});
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
  const channelEntities: Array<{ entity: any; core: string; lastMsgId: number; autoPublish: boolean }> = [];
  // Mappa core → auto_publish per lookup rapido nel handler
  const channelAutoPublish = new Map<string, boolean>();
  for (const { channel, auto_publish } of channelRows) channelAutoPublish.set(channel, auto_publish);
  // Mappa core numerico → auto_publish per fallback quando la risoluzione entità fallisce
  const coreAutoPublish = new Map<string, boolean>();
  const processedMsgIds = new Set<string>(); // dedup push+polling

  console.log(`[tg-monitor] ${userId} — canali da risolvere: ${channelRows.map(r => r.channel).join(', ')}`);

  for (const { channel } of channelRows) {
    const isNumeric = /^-?\d+$/.test(channel);
    if (isNumeric) {
      addChannelIds(channel); // fallback immediato per ID numerici
      // Registra nel fallback map anche se la risoluzione entità fallirà
      const s = channel.replace(/^-/, '');
      const rawCore = s.startsWith('100') && s.length >= 12 ? s.slice(3) : s;
      coreAutoPublish.set(rawCore, channelAutoPublish.get(channel) ?? false);
    }

    let resolved = false;
    for (let attempt = 1; attempt <= 3 && !resolved; attempt++) {
      try {
        if (attempt > 1) await new Promise(r => setTimeout(r, 4000 * attempt));
        const entityRef: any = isNumeric ? BigInt(channel) : channel;
        const entity = await client.getEntity(entityRef) as any;
        addChannelIds(entity.id);
        // Forza l'inizializzazione dello stato MTProto per questo canale specifico —
        // senza questo Telegram non invia aggiornamenti ai canali "non visti" dalla sessione
        await client.invoke(new Api.messages.GetPeerDialogs({
          peers: [new Api.InputDialogPeer({ peer: await client.getInputEntity(entity) })],
        })).catch(() => {});
        // Registra entità per polling di fallback e inizializza lastMsgId
        const initMsgs = await client.getMessages(entity, { limit: 1 }).catch(() => [] as any[]);
        const entityCore = (() => { const s = String(entity.id).replace(/^-/, ''); return s.startsWith('100') && s.length >= 12 ? s.slice(3) : s; })();
        const initLastId = (initMsgs as any[])[0]?.id ?? 0;
        const ap = channelAutoPublish.get(channel) ?? false;
        channelEntities.push({ entity, core: entityCore, lastMsgId: initLastId, autoPublish: ap });
        coreAutoPublish.set(entityCore, ap); // aggiorna con il core corretto
        console.log(`[tg-monitor] ${userId} — canale "${channel}" → id ${entity.id} lastMsgId=${initLastId} autoPublish=${ap} (tentativo ${attempt})`);
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

      // Dedup con polling
      const msgKey = `${core}:${msg.id ?? ''}`;
      if (processedMsgIds.has(msgKey)) return;
      processedMsgIds.add(msgKey);
      const chInfo = channelEntities.find(c => c.core === core);
      if (chInfo && (msg.id ?? 0) > chInfo.lastMsgId) chInfo.lastMsgId = msg.id;

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

      // Filtra solo URL Amazon/AliExpress — reset lastIndex prima di ogni test()
      // perché la regex ha flag /g e lastIndex persiste tra chiamate .test() consecutive
      const urls = [...urlSet].filter(u => { PRODUCT_URL_RE.lastIndex = 0; return PRODUCT_URL_RE.test(u); });

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
      // Fallback a coreAutoPublish se l'entità non era risolvibile all'avvio
      const chEntity = channelEntities.find(c => c.core === core);
      const autoPublish = chEntity?.autoPublish ?? coreAutoPublish.get(core) ?? false;
      processMessage(userId, uniqueUrls, autoPublish, text).catch(e => console.error('[tg-monitor] errore processMessage:', e));
    } catch (e) {
      console.error('[tg-monitor] errore handler:', e);
    }
  }, new NewMessage({}));

  // Polling di fallback: intervallo dinamico (30s fascia attiva 06:00-01:00, 5min di notte).
  const runPoll = async () => {
    if (!activeClients.has(userId)) return;
    for (const info of channelEntities) {
      try {
        const msgs = await client.getMessages(info.entity, { limit: 50, minId: info.lastMsgId }) as any[];
        if (!msgs.length) continue;
        console.log(`[tg-monitor] ${userId} — poll ${info.core}: ${msgs.length} nuovi messaggi`);
        for (const msg of [...msgs].reverse()) {
          const msgId: number = (msg as any).id ?? 0;
          if (!msgId) continue;
          const mk = `${info.core}:${msgId}`;
          if (processedMsgIds.has(mk)) continue;
          processedMsgIds.add(mk);
          if (msgId > info.lastMsgId) info.lastMsgId = msgId;
          const text: string = (msg as any).message ?? '';
          const urlSet = new Set<string>();
          (text.match(PRODUCT_URL_RE) ?? []).forEach((u: string) => urlSet.add(u));
          ((msg as any).entities ?? []).forEach((ent: any) => { const u = ent.url ?? ent.href ?? ''; if (u) urlSet.add(u); });
          const urls = [...urlSet].filter(u => { PRODUCT_URL_RE.lastIndex = 0; return PRODUCT_URL_RE.test(u); });
          if (!urls.length) continue;
          console.log(`[tg-monitor] ${userId} — poll trovati ${urls.length} link in msg ${info.core}/${msgId}`);
          const uniqueUrls: string[] = [];
          const seen = new Set<string>();
          for (const url of urls) { const clean = url.replace(/[.,;!?)]+$/, ''); if (!seen.has(clean)) { seen.add(clean); uniqueUrls.push(clean); } }
          processMessage(userId, uniqueUrls, info.autoPublish, text).catch(e => console.error('[tg-monitor] errore processMessage (poll):', e));
        }
      } catch (e: any) {
        console.warn(`[tg-monitor] ${userId} — poll error ${info.core}: ${e.message}`);
      }
    }
    if (activeClients.has(userId)) {
      activePolls.set(userId, setTimeout(runPoll, isActiveHours() ? 30_000 : 5 * 60_000));
    }
  };
  activePolls.set(userId, setTimeout(runPoll, isActiveHours() ? 30_000 : 5 * 60_000));

  // Watchdog anti-zombie: ping TCP ogni 2 minuti + reconnect proattivo ogni 3h in fascia attiva.
  // Il ping rileva connessioni TCP morte (zombie dove client.connected resta true).
  // Il reconnect proattivo copre lo zombie MTProto (TCP ok ma Telegram smette di inviare update).
  let lastProactiveReconnect = Date.now();
  const watchdogId = setInterval(async () => {
    if (!activeClients.has(userId)) { clearInterval(watchdogId); return; }
    try {
      await client.invoke(new Api.Ping({ pingId: BigInt(Date.now()) }));
    } catch (e: any) {
      console.warn(`[tg-monitor] ${userId} — watchdog: ping fallito (${e.message}), riconnetto`);
      clearInterval(watchdogId);
      activeWatchdogs.delete(userId);
      reloadUser(userId);
      return;
    }
    if (isActiveHours() && Date.now() - lastProactiveReconnect >= 3 * 60 * 60_000) {
      console.log(`[tg-monitor] ${userId} — watchdog: reconnect proattivo anti-zombie (3h)`);
      clearInterval(watchdogId);
      activeWatchdogs.delete(userId);
      reloadUser(userId);
    }
  }, 2 * 60_000);
  activeWatchdogs.set(userId, watchdogId);

  console.log(`[tg-monitor] ${userId} — in ascolto su ${monitoredIds.size / 2} canali (push + poll 30s/5min + watchdog 2min)`);
}

// Recupera layout e template dal DB per l'utente
async function getUserLayouts(userId: string) {
  await sql`ALTER TABLE templates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`.catch(() => {});

  const layouts = await sql<{ id: string; tipo: string; active: boolean; keyboard_id: string | null }[]>`
    SELECT id, tipo, active, keyboard_id FROM layouts WHERE user_id = ${userId} ORDER BY created_at ASC
  `;
  const templates = await sql<{ id: string }[]>`
    SELECT id FROM templates WHERE user_id = ${userId}
    ORDER BY updated_at DESC NULLS LAST, (config->>'canvasW' IS NOT NULL) DESC, created_at DESC LIMIT 1
  `;
  const templateId = templates[0]?.id ?? '';

  const getLayoutAndKeyboard = (platform: 'amazon' | 'aliexpress', multi = false): { layoutId: string; keyboardId: string } => {
    let found: typeof layouts[0] | undefined;
    if (multi) {
      found = layouts.find(l => l.tipo === 'multi' && l.active) ?? layouts.find(l => l.tipo === 'multi');
    } else {
      const order = platform === 'aliexpress'
        ? ['aliexpress', 'normal', 'amazon']
        : ['amazon', 'normal', 'aliexpress'];
      for (const tipo of order) {
        const match = layouts.find(l => l.tipo === tipo && l.active);
        if (match) { found = match; break; }
      }
      if (!found) {
        found = layouts.find(l => l.active && l.tipo !== 'multi')
          ?? layouts.find(l => l.tipo !== 'multi');
      }
    }
    return { layoutId: found?.id ?? '', keyboardId: String(found?.keyboard_id ?? '') };
  };

  return { getLayoutAndKeyboard, templateId };
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

async function processMessage(userId: string, urls: string[], autoPublish = false, messageText = '') {
  // Se autopost è disabilitato nelle impostazioni globali, non salvare nulla
  const [settingsRow] = await sql<{ data: unknown }[]>`SELECT data FROM settings WHERE user_id = ${userId}`;
  const cfgRaw = settingsRow?.data ?? {};
  const cfg = typeof cfgRaw === 'string' ? JSON.parse(cfgRaw) : cfgRaw as Record<string, any>;
  if (!cfg.attivo && autoPublish) {
    console.log(`[tg-monitor] ${userId} — autopost disabilitato e canale su "pubblica subito", skip`);
    return;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-internal-user-id': userId,
  };
  if (cronSecret) headers['authorization'] = `Bearer ${cronSecret}`;

  const { getLayoutAndKeyboard, templateId } = await getUserLayouts(userId);
  const isMulti = urls.length > 1;

  // Processa tutti i link in parallelo
  const products = (await Promise.all(urls.map(u => fetchProduct(userId, u, headers)))).filter(Boolean);
  if (!products.length) return;

  const productIds = products.map((p: any) => (p.asin ?? p.productId ?? '').toString()).filter(Boolean);

  // ── Dedup in-memory (atomico nel single-thread Node.js) ──────────────────
  // Nessun await tra check e add → nessun'altra callback può intromettersi.
  if (productIds.length > 0) {
    if (!recentlyProcessedProducts.has(userId)) recentlyProcessedProducts.set(userId, new Set());
    const userSeen = recentlyProcessedProducts.get(userId)!;
    if (productIds.some(id => userSeen.has(id))) {
      console.log(`[tg-monitor] ${userId} — dedup in-memory skip: ${productIds.join(',')}`);
      return;
    }
    productIds.forEach(id => {
      userSeen.add(id);
      setTimeout(() => userSeen.delete(id), 24 * 60 * 60 * 1000);
    });
  }

  // ── Dedup DB (backup post-riavvio PM2) ───────────────────────────────────
  if (productIds.length > 0 && await wasRecentlyQueuedDB(userId, productIds)) {
    console.log(`[tg-monitor] ${userId} — dedup DB skip: ${productIds.join(',')}`);
    return;
  }

  console.log(`[tg-monitor] ${userId} — ${isMulti ? 'post multiplo' : 'post singolo'} con ${products.length}/${urls.length} prodotti`);

  // Estrai coupon e prezzo dal testo del messaggio originale
  const { couponCode: textCoupon, textPrice, textOriginalPrice, textCountry } = extractCouponFromText(messageText);
  if (textCoupon || textOriginalPrice || textCountry) console.log(`[tg-monitor] ${userId} — da testo: coupon="${textCoupon || '-'}" prezzoFinale=${textPrice || '-'} prezzoPrecedente=${textOriginalPrice || '-'} paese="${textCountry || '-'}"`);

  // Costruisce e salva ogni post
  const savedPosts: any[] = [];
  for (const product of products) {
    const platform: 'amazon' | 'aliexpress' = product._platform;
    const { layoutId, keyboardId } = getLayoutAndKeyboard(platform, isMulti);

    // Coupon: usa quello dell'API (clip coupon) se presente, altrimenti quello dal testo
    const finalCoupon   = product.coupon   || textCoupon;
    const finalBoxcoupon = product.coupon ? (product.couponBox ?? false) : false;

    // Prezzo: se c'è un codice coupon dal testo e il prezzo nel testo è inferiore al prezzo API,
    // il testo riporta il prezzo finale dopo coupon che le API non rilevano
    let finalOriginalPrice   = product.originalPrice ?? 0;
    let finalDiscountedPrice = product.discountedPrice ?? 0;
    if (textPrice > 0 && textPrice < finalDiscountedPrice * 0.95) {
      console.log(`[tg-monitor] ${userId} — prezzo testo (${textPrice}) < API (${finalDiscountedPrice})${textCoupon ? ` con coupon "${textCoupon}"` : ''}: uso prezzo testo`);
      if (finalOriginalPrice <= finalDiscountedPrice) finalOriginalPrice = finalDiscountedPrice;
      finalDiscountedPrice = textPrice;
    }

    // Prezzo precedente dal testo: usato se API non ce l'ha (orig ≤ disc) OPPURE se il testo ha un valore più alto dell'API
    if (textOriginalPrice > 0 && textOriginalPrice > finalDiscountedPrice &&
        (finalOriginalPrice <= finalDiscountedPrice || textOriginalPrice > finalOriginalPrice)) {
      console.log(`[tg-monitor] ${userId} — prezzo precedente da testo: ${textOriginalPrice} (API aveva orig=${finalOriginalPrice})`);
      finalOriginalPrice = textOriginalPrice;
    }

    if (finalDiscountedPrice <= 0) {
      console.log(`[tg-monitor] ${userId} — skip: prodotto non disponibile (prezzo 0) — "${product.title?.slice(0, 50) ?? product.productId}"`);
      continue;
    }

    const finalDiscountPercent = finalOriginalPrice > finalDiscountedPrice
      ? Math.round((1 - finalDiscountedPrice / finalOriginalPrice) * 100)
      : (product.discountPercent ?? 0);

    const post = {
      id:              crypto.randomUUID(),
      platform,
      sourceUrl:       product.affiliateUrl ?? product.sourceUrl ?? '',
      productId:       product.asin ?? product.productId ?? '',
      title:           product.title ?? '',
      image:           product.image ?? '',
      originalPrice:   finalOriginalPrice,
      discountedPrice: finalDiscountedPrice,
      discountPercent: finalDiscountPercent,
      customText:      '',
      isHistoricalLow: product.isHistoricalLow ?? false,
      templateId,
      layoutId,
      keyboardId,
      emoji:           product.emoji ?? '',
      shipFromCountry: product.shipFromCountry ?? (textCountry || null),
      stelle:          product.stelle ?? '',
      recensioni:      product.recensioni ?? '',
      cat:             product.cat ?? '',
      author:          product.author ?? '',
      coupon:          finalCoupon,
      boxcoupon:       finalBoxcoupon,
      checkout:        product.checkout ?? '',
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
      immediate: autoPublish,
    }),
  });
  if (!queueRes.ok) {
    console.warn('[tg-monitor] errore aggiunta coda:', await queueRes.text());
    return;
  }

  const titles = savedPosts.map((p: any) => p.title?.slice(0, 40)).join(' + ');
  if (autoPublish) {
    console.log(`[tg-monitor] ${userId} — ⚡ pubblica subito: "${titles}"`);
    // Ritenta fino a 3 volte con backoff — il fire-and-forget semplice può fallire silenziosamente
    (async () => {
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch(`http://localhost:${serverPort}/api/autopost/publish`, {
            method: 'POST', headers, body: JSON.stringify({}),
          });
          if (r.ok) return;
          console.warn(`[tg-monitor] trigger publish tentativo ${i + 1} fallito: HTTP ${r.status}`);
        } catch (e: any) {
          console.warn(`[tg-monitor] trigger publish tentativo ${i + 1} errore: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
      }
    })().catch(() => {});
  } else {
    console.log(`[tg-monitor] ${userId} — ✅ ${isMulti ? 'multiplo' : 'singolo'} in coda: "${titles}"`);
  }
}
