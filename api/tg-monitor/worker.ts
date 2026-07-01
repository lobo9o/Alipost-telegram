import sql from '../../lib/db.js';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';

const PRODUCT_URL_RE = /https?:\/\/(?:[a-z0-9-]+\.)*(?:amazon\.[a-z.]+|amzn\.to|amzn\.eu|amzlink\.to|aliexpress\.com|s\.click\.aliexpress\.com|a\.aliexpress\.com)[^\s<>"')]+/gi;

function extractCouponFromText(text: string): { couponCode: string; textPrice: number; textOriginalPrice: number; textCountry: string } {
  // Coupon: "Coupon: ZSCADDR6" / "Coupon Sconto: SSIT12" / "✂️ Coupon➡️ H45Z8AJZ" / "codice: X" / "✂ ABCD1234"
  // I codici coupon Amazon reali contengono sempre almeno una cifra (SSIT12, H45Z8AJZ, ZSCADDR6).
  // Lookahead: la cifra deve essere DENTRO il token catturato, non solo da qualche parte dopo.
  // Esempio: "🎟️ Coupon: ITTP30" — (?=.*\d) matchava "Coupon" perché "30" era dopo → produceva "COUPON".
  // Con (?=[A-Za-z0-9]{0,19}\d) il lookahead fallisce su "Coupon" (non contiene cifre proprie).
  const COUPON_RE = /(?=[A-Za-z0-9]{0,19}\d)[A-Za-z0-9]{4,20}/; // la cifra deve stare nel token
  // Il keyword deve essere a inizio riga (flag 'm') — evita di matchare "Codice IH8226" nei titoli prodotto
  // Seconda regex: \W* invece di \s* per consumare il variation selector U+FE0F dopo emoji (es. 🎟️)
  const couponM =
    text.match(new RegExp(`(?:^|[\\n\\r])\\s*(?:coupon|codice|code|promo)(?:\\s+(?:sconto|discount|promo|codice|code)\\b)?\\W{0,10}(${COUPON_RE.source})`, 'im')) ??
    text.match(new RegExp(`[✂🎟]\\W*(?:coupon|codice|code|promo)?(?:\\s+(?:sconto|discount)\\b)?\\W{0,10}(${COUPON_RE.source})`, 'iu'));
  const couponCode = couponM ? couponM[1].toUpperCase() : '';

  // Rimuovi righe che contengono sconti extra/bonus (PayPal, cashback, rimborso…)
  // per evitare che importi come "-15,00€" vengano scambiati per il prezzo del prodotto
  const priceText = text.split('\n')
    .filter(line => !/paypal|cashback|rimborso|sconto\s+extra|sconto\s+aggiuntivo|bonus|credito/i.test(line))
    .join('\n');

  // Prezzi con € o $ sia dopo (12,99€ / 1.234,56€) sia prima (€12.99 / $1,234.56)
  // Gestisce separatore migliaia europeo (punto): 1.399,00€ → 1399.00
  // e separatore migliaia anglosassone (virgola): 1,399.00€ → 1399.00
  // Lookbehind (?<!-) esclude importi di sconto come "-15,00€"
  const PRICE_EU_RE  = /(?<!-\s*)(\d{1,3}(?:\.\d{3})*,\d{2})\s*[€$]/gu;  // 1.399,00€
  const PRICE_INT_RE = /(?<!-\s*)(\d{1,3}(?:,\d{3})*\.\d{2})\s*[€$]/gu;  // 1,399.00€
  const PRICE_EU_PRE  = /[€$]\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gu; // €1.399,00
  const PRICE_INT_PRE = /[€$]\s*(\d{1,3}(?:,\d{3})*\.\d{2})/gu; // €1,399.00
  // Prezzi interi senza decimali: 15€ — lookbehind evita di catturare "99" da "34,99€"
  const PRICE_WHOLE_AF  = /(?<![-,.])\b(\d{1,4})\s*[€$]/gu;
  const PRICE_WHOLE_PRE = /[€$]\s*(\d{1,4})(?![,.\d])/gu;
  const parseEU  = (s: string) => parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  const parseINT = (s: string) => parseFloat(s.replace(/,/g, '')) || 0;
  const priceAfter  = [
    ...[...priceText.matchAll(PRICE_EU_RE)].map(m => parseEU(m[1])),
    ...[...priceText.matchAll(PRICE_INT_RE)].map(m => parseINT(m[1])),
    ...[...priceText.matchAll(PRICE_WHOLE_AF)].map(m => parseInt(m[1], 10)),
  ];
  const priceBefore = [
    ...[...priceText.matchAll(PRICE_EU_PRE)].map(m => parseEU(m[1])),
    ...[...priceText.matchAll(PRICE_INT_PRE)].map(m => parseINT(m[1])),
    ...[...priceText.matchAll(PRICE_WHOLE_PRE)].map(m => parseInt(m[1], 10)),
  ];
  const prices = [...priceAfter, ...priceBefore].filter(p => p > 0.5 && p < 100000);

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

// Dedup in-memory: chiave "productId:destChannel" → canali diversi possono pubblicare lo stesso prodotto.
// check+add sincroni → atomici nel single-thread Node.js.
const recentlyProcessedProducts = new Map<string, Set<string>>();

// Dedup URL-level: blocca la stessa URL prima ancora del fetch prodotto (gestisce repost/forward identici).
const recentlyProcessedUrls = new Map<string, Set<string>>();

// Dedup prodotti: controlla sul DB se gli stessi productId sono già stati pubblicati/accodati
// per lo stesso canale di destinazione nelle ultime 24h (PM2-restart safe).
async function wasRecentlyQueuedDB(userId: string, productIds: string[], destChannel: string | null = null): Promise<boolean> {
  if (!productIds.length) return false;
  const normalizeId = (s: string) => s.trim().toUpperCase();
  const targetIds = productIds.map(normalizeId).filter(Boolean);
  if (!targetIds.length) return false;
  try {
    // 1) Controlla draft in coda — blocca solo se stesso canale (o entrambi senza canale)
    const drafts = await sql<{ posts: unknown; created_at: string; dest_channel: string | null }[]>`
      SELECT posts, created_at, dest_channel FROM autopost_queue
      WHERE user_id = ${userId} AND status = 'draft'
    `;
    for (const row of drafts) {
      const posts: any[] = typeof row.posts === 'string' ? JSON.parse(row.posts) : (row.posts as any[]) ?? [];
      const ids = posts.map((p: any) => normalizeId(String(p.productId ?? p.asin ?? ''))).filter(Boolean);
      const hit = targetIds.find(id => ids.includes(id));
      if (hit) {
        // "stesso canale" = non sappiamo il target (conservativo) OPPURE canale esatto.
        // NON includiamo "row.dest_channel === null": un draft senza canale va al default,
        // non deve bloccare richieste con canale specifico (evita falsi positivi multi-canale).
        const sameChannel = destChannel === null || row.dest_channel === destChannel;
        if (sameChannel) {
          console.log(`[tg-monitor] dedup DB draft: bloccato ${hit} draft_ch=${row.dest_channel ?? 'null'} target_ch=${destChannel ?? 'null'} (${row.created_at})`);
          return true;
        }
        console.log(`[tg-monitor] dedup DB draft: trovato ${hit} ma canale diverso draft_ch=${row.dest_channel ?? 'null'} target_ch=${destChannel ?? 'null'} → no block`);
      }
    }
    // 2) Controlla autopost_queue pubblicati di recente (status='published', ultime 24h).
    // dest_channel in autopost_queue è lo stesso valore passato qui (es. @username o ID numerico),
    // quindi il confronto funziona anche per canali con @username (a differenza di published_posts
    // dove chat_id è sempre l'ID numerico e non coincide con @username).
    const recentPublished = await sql<{ id: string; posts: unknown; created_at: string; dest_channel: string | null }[]>`
      SELECT id, posts, created_at, dest_channel FROM autopost_queue
      WHERE user_id = ${userId}
        AND status = 'published'
        AND created_at > NOW() - INTERVAL '24 hours'
    `;
    for (const row of recentPublished) {
      const posts2: any[] = typeof (row as any).posts === 'string' ? JSON.parse((row as any).posts) : ((row as any).posts as any[]) ?? [];
      const ids2 = posts2.map((p: any) => normalizeId(String(p.productId ?? p.asin ?? ''))).filter(Boolean);
      const hit2 = targetIds.find(id => ids2.includes(id));
      if (hit2) {
        const sameChannel2 = destChannel === null || row.dest_channel === destChannel || row.dest_channel === null;
        if (sameChannel2) {
          console.log(`[tg-monitor] dedup DB published queue: bloccato ${hit2} ch=${row.dest_channel ?? 'null'} (${row.created_at})`);
          return true;
        }
      }
    }
    // 3) Controlla già pubblicati nelle ultime 24h in published_posts — funziona se chat_id è numerico.
    // Se destChannel è null = non sappiamo il canale → blocca su tutto (comportamento conservativo).
    // Se destChannel è @username → la query non filtra per canale (chat_id è numerico, non coincide).
    const isNumericChannel = destChannel ? /^-?\d+$/.test(destChannel) : false;
    const channelFilter = (destChannel && isNumericChannel)
      ? sql`AND chat_id = ${destChannel}`
      : sql``;
    const published = await sql<{ product_id: string; published_at: string }[]>`
      SELECT product_id, published_at FROM published_posts
      WHERE user_id = ${userId}
        AND published_at > NOW() - INTERVAL '24 hours'
        AND product_id = ANY(${targetIds})
        ${channelFilter}
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

  // Price-check: ogni 30 minuti chiama publish che controlla le offerte scadute su tutti i post
  setInterval(async () => {
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (cronSecret) headers['authorization'] = `Bearer ${cronSecret}`;
      await fetch(`http://localhost:${serverPort}/api/autopost/publish`, { method: 'POST', headers, body: '{}' });
      console.log('[tg-monitor] price-check (publish) completato');
    } catch (e: any) {
      console.warn('[tg-monitor] price-check errore:', e.message);
    }
  }, 30 * 60 * 1000);
}

// Debounce: più chiamate ravvicinate (es. swap di due canali) producono un solo reload
const reloadDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function reloadUser(userId: string) {
  const isDevInstance = serverPort === 3001;
  const isDevUser = userId.endsWith('_dev');
  if (isDevInstance !== isDevUser) {
    console.log(`[tg-monitor] reloadUser ${userId} ignorato: non appartiene a questa istanza (${isDevInstance ? 'dev' : 'stable'})`);
    return;
  }
  // Cancella un reload già pendente per questo utente
  const existing = reloadDebounceTimers.get(userId);
  if (existing) clearTimeout(existing);
  // Aspetta 300ms: se arrivano più PATCH ravvicinate (swap canali) parte un solo reload
  const t = setTimeout(() => {
    reloadDebounceTimers.delete(userId);
    stopUser(userId).then(() =>
      startUser(userId).catch(e => console.error(`[tg-monitor] errore reload ${userId}:`, e))
    );
  }, 300);
  reloadDebounceTimers.set(userId, t);
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

  const channelRows = await sql<{ channel: string; auto_publish: boolean; dest_channel: string | null }[]>`
    SELECT mc.channel, COALESCE(mc.auto_publish, false) AS auto_publish,
      CASE
        WHEN mc.user_id = ${userId} THEN mc.dest_channel
        ELSE split_part(mc.user_id, ':', 2)
      END AS dest_channel
    FROM tg_monitor_channels mc
    WHERE (mc.user_id = ${userId} OR mc.user_id LIKE ${userId + ':%'})
      AND mc.active = true
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
  const channelEntities: Array<{ entity: any; core: string; lastMsgId: number; autoPublish: boolean; destChannel: string | null }> = [];
  // Mappa canale → lista destinazioni (gestisce lo stesso sorgente su più profili/canali dest)
  const channelDestsMap = new Map<string, Array<{ auto_publish: boolean; dest_channel: string | null }>>();
  for (const { channel, auto_publish, dest_channel } of channelRows) {
    const arr = channelDestsMap.get(channel) ?? [];
    arr.push({ auto_publish, dest_channel: dest_channel ?? null });
    channelDestsMap.set(channel, arr);
  }
  // Mappa core numerico → destinations per fallback quando la risoluzione entità fallisce
  const coreDestsMap = new Map<string, Array<{ auto_publish: boolean; dest_channel: string | null }>>();
  const processedMsgIds = new Set<string>(); // dedup push+polling (chiave: core:msgId:destChannel)

  console.log(`[tg-monitor] ${userId} — canali da risolvere: ${[...channelDestsMap.keys()].join(', ')}`);

  // Risolvi ogni canale sorgente unico una sola volta, poi aggiungi un'entry per ogni destinazione
  for (const [channel, dests] of channelDestsMap) {
    const isNumeric = /^-?\d+$/.test(channel);
    if (isNumeric) {
      addChannelIds(channel); // fallback immediato per ID numerici
      const s = channel.replace(/^-/, '');
      const rawCore = s.startsWith('100') && s.length >= 12 ? s.slice(3) : s;
      coreDestsMap.set(rawCore, dests);
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
        // Un'entry per ogni profilo/destinazione che monitora questo canale sorgente
        for (const { auto_publish: ap, dest_channel: dc } of dests) {
          channelEntities.push({ entity, core: entityCore, lastMsgId: initLastId, autoPublish: ap, destChannel: dc });
          console.log(`[tg-monitor] ${userId} — canale "${channel}" → id ${entity.id} lastMsgId=${initLastId} autoPublish=${ap} destChannel=${dc ?? 'default'} (tentativo ${attempt})`);
        }
        coreDestsMap.set(entityCore, dests); // aggiorna con il core corretto
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
            // Popola channelEntities e coreDestsMap così auto_publish funziona correttamente
            const lazyCore = (() => { const s = String(entity.id).replace(/^-/, ''); return s.startsWith('100') && s.length >= 12 ? s.slice(3) : s; })();
            const lazyDests = channelDestsMap.get(ch) ?? [{ auto_publish: false, dest_channel: null }];
            const lazyMsgs = await client.getMessages(entity, { limit: 1 }).catch(() => [] as any[]);
            const lazyLastId = (lazyMsgs as any[])[0]?.id ?? 0;
            for (const { auto_publish: ap, dest_channel: dc } of lazyDests) {
              channelEntities.push({ entity, core: lazyCore, lastMsgId: lazyLastId, autoPublish: ap, destChannel: dc });
            }
            coreDestsMap.set(lazyCore, lazyDests);
            console.log(`[tg-monitor] ${userId} — risolto lazily "${ch}" → ${entity.id} autoPublish=${lazyDests[0].auto_publish}`);
            unresolvedChannels.splice(i, 1); // rimosso dalla lista pending
          } catch { /* ignora */ }
        }
        isMonitored = monitoredIds.has(rawId) || monitoredIds.has(core) || monitoredIds.has(`-100${core}`);
      }

      console.log(`[tg-monitor] ${userId} — msg chatId=${rawId} monitored=${isMonitored}`);
      if (!isMonitored) return;

      // Dedup con polling — usa stesso formato chiave del poll (core:msgId:destChannel)
      const matchingForDedup = channelEntities.filter(c => c.core === core);
      const baseKey = `${core}:${msg.id ?? ''}`;
      // Controlla se TUTTI i profili hanno già processato questo messaggio
      const allAlreadyProcessed = matchingForDedup.length > 0
        ? matchingForDedup.every(ce => processedMsgIds.has(`${baseKey}:${ce.destChannel ?? ''}`))
        : processedMsgIds.has(baseKey);
      if (allAlreadyProcessed) return;
      // Marca come processati per tutti i profili + aggiorna lastMsgId
      for (const ce of matchingForDedup) processedMsgIds.add(`${baseKey}:${ce.destChannel ?? ''}`);
      if (!matchingForDedup.length) processedMsgIds.add(baseKey);
      for (const ce of matchingForDedup) { if ((msg.id ?? 0) > ce.lastMsgId) ce.lastMsgId = msg.id; }

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

      // URL nei bottoni inline (replyMarkup) — comune nei post AliExpress dei canali
      const markup = msg.replyMarkup ?? msg.reply_markup;
      const markupRows: any[] = markup?.rows ?? markup?.inline_keyboard ?? [];
      for (const row of markupRows) {
        const buttons: any[] = row.buttons ?? row ?? [];
        for (const btn of buttons) {
          const btnUrl: string = btn.url ?? '';
          if (btnUrl) urlSet.add(btnUrl);
        }
      }

      // Filtra solo URL Amazon/AliExpress — reset lastIndex prima di ogni test()
      // perché la regex ha flag /g e lastIndex persiste tra chiamate .test() consecutive
      const urls = [...urlSet].filter(u => { PRODUCT_URL_RE.lastIndex = 0; return PRODUCT_URL_RE.test(u); });

      if (!urls.length) {
        console.log(`[tg-monitor] ${userId} — nessun link prodotto trovato (entities: ${entities.length} markup rows: ${markupRows.length})`);
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
      // Chiama processMessage per ogni profilo/destinazione che monitora questo canale sorgente
      const matchingEntities = channelEntities.filter(c => c.core === core);
      if (matchingEntities.length > 0) {
        for (const ce of matchingEntities) {
          processMessage(userId, uniqueUrls, ce.autoPublish, text, ce.destChannel).catch(e => console.error('[tg-monitor] errore processMessage:', e));
        }
      } else {
        // Fallback a coreDestsMap se l'entità non era risolvibile all'avvio
        const fallbackDests = coreDestsMap.get(core) ?? [{ auto_publish: false, dest_channel: null }];
        for (const { auto_publish: ap, dest_channel: dc } of fallbackDests) {
          processMessage(userId, uniqueUrls, ap, text, dc).catch(e => console.error('[tg-monitor] errore processMessage:', e));
        }
      }
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
          // Chiave dedup include destChannel: stesso messaggio va a destinazioni diverse
          const mk = `${info.core}:${msgId}:${info.destChannel ?? ''}`;
          if (processedMsgIds.has(mk)) continue;
          processedMsgIds.add(mk);
          if (msgId > info.lastMsgId) info.lastMsgId = msgId;
          const text: string = (msg as any).message ?? '';
          const urlSet = new Set<string>();
          (text.match(PRODUCT_URL_RE) ?? []).forEach((u: string) => urlSet.add(u));
          ((msg as any).entities ?? []).forEach((ent: any) => { const u = ent.url ?? ent.href ?? ''; if (u) urlSet.add(u); });
          const pollMarkup = (msg as any).replyMarkup ?? (msg as any).reply_markup;
          const pollRows: any[] = pollMarkup?.rows ?? pollMarkup?.inline_keyboard ?? [];
          for (const row of pollRows) { for (const btn of (row.buttons ?? row ?? [])) { const u = btn.url ?? ''; if (u) urlSet.add(u); } }
          const urls = [...urlSet].filter(u => { PRODUCT_URL_RE.lastIndex = 0; return PRODUCT_URL_RE.test(u); });
          if (!urls.length) continue;
          console.log(`[tg-monitor] ${userId} — poll trovati ${urls.length} link in msg ${info.core}/${msgId} destChannel=${info.destChannel ?? 'default'}`);
          const uniqueUrls: string[] = [];
          const seen = new Set<string>();
          for (const url of urls) { const clean = url.replace(/[.,;!?)]+$/, ''); if (!seen.has(clean)) { seen.add(clean); uniqueUrls.push(clean); } }
          processMessage(userId, uniqueUrls, info.autoPublish, text, info.destChannel).catch(e => console.error('[tg-monitor] errore processMessage (poll):', e));
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
  const baseUserId = userId.includes(':') ? userId.split(':')[0] : userId;
  const templates = await sql<{ id: string }[]>`
    SELECT id FROM templates WHERE user_id = ${baseUserId} OR user_id = ${userId}
    ORDER BY (user_id = ${userId}) DESC, updated_at DESC NULLS LAST, (config->>'canvasW' IS NOT NULL) DESC, created_at DESC LIMIT 1
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
  if (productRes.status === 429) {
    console.warn(`[tg-monitor] /api/product rate-limited (429) per ${url}`);
    return { _rateLimited: true };
  }
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

async function processMessage(userId: string, urls: string[], autoPublish = false, messageText = '', destChannel: string | null = null) {
  // ── Dedup URL-level ATOMICO (prima di qualsiasi await) ────────────────────
  // Node.js è single-thread: nessun await → nessuna race condition tra push+poll.
  // Due chiamate concorrenti con la stessa URL arrivano qui in sequenza; la seconda
  // trova già la chiave nel Set e ritorna prima di fare qualsiasi query DB.
  const urlKey = [...urls].sort().join('|');
  const urlDedupKey = `${urlKey}:${destChannel ?? ''}`;
  if (!recentlyProcessedUrls.has(userId)) recentlyProcessedUrls.set(userId, new Set());
  const urlSeen = recentlyProcessedUrls.get(userId)!;
  if (urlSeen.has(urlDedupKey)) {
    console.log(`[tg-monitor] ${userId} — dedup URL skip: ${urlKey.slice(0, 80)}`);
    return;
  }
  urlSeen.add(urlDedupKey);
  // TTL breve (5 min): blocca solo duplicati rapidi push+poll, permette retry in caso di errore
  setTimeout(() => urlSeen.delete(urlDedupKey), 5 * 60 * 1000);

  console.log(`[tg-monitor] ${userId} — processMessage ENTER: autoPublish=${autoPublish} destChannel=${destChannel ?? 'null'} urls=[${urls.join(', ').slice(0, 120)}]`);

  // Profilo canale: userId:destChannel. Non richiede riga settings (creata da channels.ts).
  const profileId = destChannel ? `${userId}:${destChannel}` : userId;

  // Se autopost è disabilitato nel profilo, non salvare nulla. Fallback al profilo base se secondario senza settings.
  const [settingsRow] = await sql<{ data: unknown }[]>`SELECT data FROM settings WHERE user_id = ${profileId}`.catch(() => []);
  const [baseRow] = profileId !== userId ? await sql<{ data: unknown }[]>`SELECT data FROM settings WHERE user_id = ${userId}`.catch(() => []) : [settingsRow];
  const cfgRaw = settingsRow?.data ?? baseRow?.data ?? {};
  const cfg = typeof cfgRaw === 'string' ? JSON.parse(cfgRaw) : cfgRaw as Record<string, any>;
  // Per profili secondari: se attivo non è esplicitamente impostato, eredita dal profilo base.
  // Evita che l'abilitazione di una funzione secondaria (es. autoPublishAmazon) crei un record
  // con attivo=false di default, bloccando silenziosamente il tg-monitor.
  const baseCfgRaw = profileId !== userId ? (baseRow?.data ?? {}) : cfgRaw;
  const baseCfg = typeof baseCfgRaw === 'string' ? JSON.parse(baseCfgRaw) : baseCfgRaw as Record<string, any>;
  const effectiveAttivo = cfg.attivo ?? baseCfg.attivo;
  if (!effectiveAttivo && autoPublish) {
    console.log(`[tg-monitor] ${profileId} — autopost disabilitato (attivo=${cfg.attivo} base=${baseCfg.attivo}) e canale su "pubblica subito", skip`);
    return;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-internal-user-id': profileId,
  };
  if (cronSecret) headers['authorization'] = `Bearer ${cronSecret}`;

  const { getLayoutAndKeyboard, templateId } = await getUserLayouts(profileId);
  console.log(`[tg-monitor] ${profileId} — templateId=${templateId || '(nessuno)'}`);
  // Processa tutti i link in parallelo — mantiene _urlIdx per abbinare coupon per sezione
  const rawProductsRaw = await Promise.all(urls.map(async (u, urlIdx) => {
    const p = await fetchProduct(profileId, u, headers);
    return p ? { ...p, _urlIdx: urlIdx } : null;
  }));
  const isRateLimited = rawProductsRaw.some((p: any) => p?._rateLimited);
  const rawProducts = rawProductsRaw.filter((p: any) => p && !p._rateLimited);
  if (!rawProducts.length) {
    if (isRateLimited) {
      // Rimuovi dal dedup in modo che il retry possa passare
      urlSeen.delete(urlDedupKey);
      console.warn(`[tg-monitor] ${profileId} — Creators API rate limited, retry in 60s per: ${urlKey.slice(0, 80)}`);
      setTimeout(() => processMessage(userId, urls, autoPublish, messageText, destChannel)
        .catch(e => console.error('[tg-monitor] errore retry rate-limit:', e.message)), 60_000);
    }
    return;
  }

  // Deduplica per productId/ASIN: due URL diversi (es. amzlink.to + amazon.it/dp/ con ref= differente)
  // possono risolvere allo stesso prodotto e causare post duplicati
  const seenPids = new Set<string>();
  const products = rawProducts.filter((p: any) => {
    const pid = (p.asin ?? p.productId ?? '').toString();
    if (!pid || seenPids.has(pid)) {
      if (pid) console.log(`[tg-monitor] ${profileId} — dedup prodotto duplicato: ${pid}`);
      return false;
    }
    seenPids.add(pid);
    return true;
  });
  if (!products.length) return;

  // isMulti basato sui prodotti reali trovati, non sugli URL (es. link cashback non è un prodotto)
  const isMulti = products.length > 1;

  const productIds = products.map((p: any) => (p.asin ?? p.productId ?? '').toString()).filter(Boolean);

  // ── Dedup in-memory per-canale (atomico nel single-thread Node.js) ───────
  if (productIds.length > 0) {
    if (!recentlyProcessedProducts.has(profileId)) recentlyProcessedProducts.set(profileId, new Set());
    const userSeen = recentlyProcessedProducts.get(profileId)!;
    const chKey = (id: string) => `${id}:${destChannel ?? ''}`;
    if (productIds.some(id => userSeen.has(chKey(id)))) {
      console.log(`[tg-monitor] ${profileId} — dedup in-memory skip: ${productIds.join(',')} ch=${destChannel ?? 'default'}`);
      return;
    }
    productIds.forEach(id => {
      userSeen.add(chKey(id));
      setTimeout(() => userSeen.delete(chKey(id)), 24 * 60 * 60 * 1000);
    });
  }

  // ── Dedup DB per-canale (backup post-riavvio PM2) ─────────────────────────
  if (productIds.length > 0 && await wasRecentlyQueuedDB(profileId, productIds, destChannel)) {
    console.log(`[tg-monitor] ${profileId} — dedup DB skip: ${productIds.join(',')} ch=${destChannel ?? 'default'}`);
    return;
  }

  console.log(`[tg-monitor] ${profileId} — ${isMulti ? 'post multiplo' : 'post singolo'} con ${products.length}/${urls.length} prodotti`);

  // Estrai coupon e prezzo dal testo del messaggio originale
  const { couponCode: textCoupon, textPrice, textOriginalPrice, textCountry } = extractCouponFromText(messageText);
  if (textCoupon || textOriginalPrice || textCountry) console.log(`[tg-monitor] ${userId} — da testo: coupon="${textCoupon || '-'}" prezzoFinale=${textPrice || '-'} prezzoPrecedente=${textOriginalPrice || '-'} paese="${textCountry || '-'}"`);

  // Per post multi-prodotto: estrai coupon per sezione di testo (una per URL).
  // Il testo del canale sorgente ha coupon specifici per ogni prodotto (es. P20PDAMZ, P15ITJUN)
  // che sono più precisi del coupon generico restituito dall'API (es. PROSCENIC per tutti).
  const textCouponsPerUrl: string[] = [];
  if (isMulti) {
    let remaining = messageText;
    for (const url of urls) {
      const urlPos = remaining.indexOf(url);
      const sectionEnd = urlPos >= 0 ? urlPos + url.length : remaining.length;
      const { couponCode } = extractCouponFromText(remaining.slice(0, sectionEnd));
      textCouponsPerUrl.push(couponCode);
      if (urlPos >= 0) remaining = remaining.slice(urlPos + url.length);
    }
    if (textCouponsPerUrl.some(Boolean)) console.log(`[tg-monitor] ${userId} — coupon per URL: ${textCouponsPerUrl.map((c, i) => `url${i}="${c || '-'}"`).join(' ')}`);
  }

  // Rileva errori di prezzo nel testo sorgente → imposta {custom}
  const PRICE_ERROR_RE = /errore\s+di\s+prezzo|errore\s+del\s+prezzo|errore\s+sul\s+prezzo|errore\s+nel\s+prezzo|errore\s+prezzo|prezzo\s+errato|prezzo\s+sbagliato|prezzo\s+anomalo|anomalia\s+(?:di\s+)?prezzo|probabile\s+errore|possibile\s+errore|sembra\s+(?:un\s+)?errore|forse\s+(?:un\s+)?errore|potrebbe\s+essere\s+(?:un\s+)?errore|glitch\s+(?:di\s+)?prezzo|prezzo\s+glitch|price\s+error|pricing\s+error|price\s+glitch|price\s+mistake|errore!/i;
  const detectedCustom = PRICE_ERROR_RE.test(messageText) ? '❌ERRORE DI PREZZO❌' : '';
  if (detectedCustom) console.log(`[tg-monitor] ${profileId} — rilevato errore di prezzo nel testo sorgente`);

  // Costruisce e salva ogni post
  const savedPosts: any[] = [];
  for (const product of products) {
    const platform: 'amazon' | 'aliexpress' = product._platform;
    const { layoutId, keyboardId } = getLayoutAndKeyboard(platform, isMulti);

    // Coupon: per post singolo l'API ha priorità (clip coupon Amazon preciso).
    // Per post multi-prodotto il testo ha priorità: ogni prodotto ha il suo coupon specifico
    // nel canale sorgente, più preciso del coupon generico del brand restituito dall'API.
    const urlTextCoupon = isMulti ? (textCouponsPerUrl[(product as any)._urlIdx ?? 0] || textCoupon) : textCoupon;
    const finalCoupon   = isMulti ? (urlTextCoupon || product.coupon) : (product.coupon || textCoupon);
    const finalBoxcoupon = (!isMulti && product.coupon) ? (product.couponBox ?? false) : false;

    // Prezzi: per post singolo il testo ha priorità sull'API (più preciso).
    // Per post multi-prodotto NON si sovrascrive: il prezzo nel testo potrebbe
    // riferirsi a un solo prodotto e verrebbe applicato sbagliato a tutti gli altri.
    let finalOriginalPrice   = product.originalPrice ?? 0;
    let finalDiscountedPrice = product.discountedPrice ?? 0;
    if (!isMulti && textPrice > 0) {
      console.log(`[tg-monitor] ${userId} — prezzi da testo: scontato=${textPrice} precedente=${textOriginalPrice || '(non trovato)'} | API: scontato=${finalDiscountedPrice} precedente=${finalOriginalPrice}`);
      finalDiscountedPrice = textPrice;
      if (textOriginalPrice > textPrice) finalOriginalPrice = textOriginalPrice;
    } else if (!isMulti && textOriginalPrice > 0 && textOriginalPrice > finalDiscountedPrice) {
      console.log(`[tg-monitor] ${userId} — prezzo precedente da testo: ${textOriginalPrice} (API aveva orig=${finalOriginalPrice})`);
      finalOriginalPrice = textOriginalPrice;
    }

    // Sicurezza: se i due prezzi sono uguali (o il precedente è minore), non mostrare "X invece di X"
    if (finalOriginalPrice > 0 && finalOriginalPrice <= finalDiscountedPrice) {
      console.log(`[tg-monitor] ${userId} — prezzo precedente (${finalOriginalPrice}) <= scontato (${finalDiscountedPrice}), azzerato per evitare "X invece di X"`);
      finalOriginalPrice = 0;
    }

    // Fallback: se il prezzo precedente non è stato trovato, stima +33% del prezzo scontato
    if (finalOriginalPrice <= 0 && finalDiscountedPrice > 0) {
      finalOriginalPrice = parseFloat((finalDiscountedPrice * 1.33).toFixed(2));
      console.log(`[tg-monitor] ${userId} — prezzo precedente non trovato, fallback +33%: scontato=${finalDiscountedPrice} → stimato=${finalOriginalPrice}`);
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
      customText:      detectedCustom,
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
      destChannel: destChannel ?? undefined,
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
