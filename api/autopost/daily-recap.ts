import sql from '../../lib/db.js';

// Tiene traccia dei riepiloghi già pubblicati oggi per evitare doppioni (in-memory, reset al restart)
const sentToday = new Map<string, string>(); // key: "userId:channel" → value: "YYYY-MM-DD"

function todayStr() {
  return new Date().toLocaleDateString('sv-SE'); // "2026-07-07" formato ISO
}

function currentHHMM() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export async function runDailyRecapCheck(serverPort: number) {
  const hhmm = currentHHMM();

  // Carica tutti gli utenti con impostazioni
  const settingRows = await sql<{ user_id: string; data: any }[]>`
    SELECT user_id, data FROM settings WHERE user_id NOT LIKE '%_dev'
  `.catch(() => [] as { user_id: string; data: any }[]);

  for (const row of settingRows) {
    const userId = row.user_id;
    // Salta profili secondari (user_id con ":")
    if (userId.includes(':')) continue;

    const recap = (row.data?.dailyRecap ?? {}) as Record<string, { enabled?: boolean; time?: string; title?: string }>;

    for (const [channelKey, cfg] of Object.entries(recap)) {
      if (!cfg?.enabled || cfg.time !== hhmm) continue;

      const sentKey = `${userId}:${channelKey}`;
      if (sentToday.get(sentKey) === todayStr()) continue;

      sentToday.set(sentKey, todayStr());

      try {
        await publishRecap(userId, channelKey, cfg.title ?? 'I MIGLIORI POST DELLA GIORNATA', serverPort);
        console.log(`[daily-recap] pubblicato riepilogo per ${userId} canale=${channelKey}`);
      } catch (e: any) {
        console.error(`[daily-recap] errore per ${userId} canale=${channelKey}:`, e?.message ?? e);
        // Rimuovi dal "già inviato" per riprovare al prossimo minuto
        sentToday.delete(sentKey);
      }
    }
  }
}

async function publishRecap(userId: string, channelKey: string, title: string, serverPort: number) {
  const destChannel = channelKey === 'default' ? null : channelKey;

  // Top 6 post singoli della giornata per questo canale, ordinati per sconto
  const posts = await sql<any[]>`
    SELECT id, platform, source_url, product_id, title, image,
           original_price, discounted_price, discount_percent,
           custom_text, layout_id, is_historical_low, emoji
    FROM published_posts
    WHERE user_id = ${userId}
      AND is_multi = false
      AND COALESCE(terminata, false) = false
      AND published_at >= now() - interval '24 hours'
      AND (
        ${destChannel} IS NULL
          AND (dest_channel IS NULL OR dest_channel = '')
        OR dest_channel = ${destChannel}
      )
    ORDER BY discount_percent DESC
    LIMIT 6
  `;

  if (posts.length < 2) {
    console.log(`[daily-recap] ${userId} canale=${channelKey}: solo ${posts.length} post, riepilogo saltato`);
    return;
  }

  // Carica layout multi-prodotto e keyboard dell'utente
  const [layoutRow] = await sql<{ id: string; body: string }[]>`
    SELECT id, body FROM layouts
    WHERE user_id = ${userId} AND tipo = 'multi'
    ORDER BY created_at DESC NULLS LAST LIMIT 1
  `.catch(() => []);

  const [kbRow] = await sql<{ id: string }[]>`
    SELECT id FROM keyboards
    WHERE user_id = ${userId}
    ORDER BY created_at ASC LIMIT 1
  `.catch(() => []);

  // Carica template per generare l'immagine multi
  const [tplRow] = await sql<{ id: string }[]>`
    SELECT id FROM templates
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC NULLS LAST LIMIT 1
  `.catch(() => []);

  const recapPosts = posts.map((p: any) => ({
    id:              p.id,
    platform:        p.platform ?? 'amazon',
    sourceUrl:       p.source_url ?? '',
    productId:       p.product_id ?? '',
    title:           p.title ?? '',
    image:           p.image ?? '',
    originalPrice:   Number(p.original_price ?? 0),
    discountedPrice: Number(p.discounted_price ?? 0),
    discountPercent: Number(p.discount_percent ?? 0),
    customText:      p.custom_text ?? '',
    isHistoricalLow: p.is_historical_low ?? false,
    templateId:      tplRow?.id ?? 'tpl1',
    layoutId:        layoutRow?.id ?? '',
    keyboardId:      kbRow?.id ?? '',
    emoji:           p.emoji ?? '📦',
  }));

  const queueId = crypto.randomUUID();

  await sql`
    INSERT INTO autopost_queue (id, user_id, posts, status, auto, immediate, dest_channel, caption_prefix)
    VALUES (
      ${queueId}, ${userId}, ${JSON.stringify(recapPosts)},
      'draft', true, true,
      ${destChannel}, ${title}
    )
  `;

  // Forza pubblicazione immediata
  await fetch(`http://localhost:${serverPort}/api/autopost/publish`, {
    method: 'GET',
    headers: { 'x-internal-user-id': userId },
  }).catch(() => {});
}

export default async function handler(req: any, res: any) {
  // Endpoint per trigger manuale (POST con userId opzionale nel body)
  const userId = req.body?.userId ?? req.query?.userId;
  const channelKey = req.body?.channel ?? req.query?.channel ?? 'default';
  const serverPort = parseInt(process.env.PORT || '3000', 10);

  if (req.method === 'POST' && userId) {
    // Trigger manuale: pubblica subito indipendentemente dall'orario
    const [settingRow] = await sql<{ data: any }[]>`
      SELECT data FROM settings WHERE user_id = ${userId}
    `.catch(() => []);
    const recap = (settingRow?.data?.dailyRecap ?? {}) as Record<string, any>;
    const cfg = recap[channelKey];
    const title = cfg?.title ?? 'I MIGLIORI POST DELLA GIORNATA';

    try {
      await publishRecap(userId, channelKey, title, serverPort);
      return res.json({ ok: true, message: 'Riepilogo inviato' });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message ?? 'Errore' });
    }
  }

  // GET: chiamato dal cron ogni minuto
  await runDailyRecapCheck(serverPort);
  res.json({ ok: true });
}
