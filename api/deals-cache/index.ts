import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withErrorHandler, requireUserId, getUserId } from '../_utils.js';
import { getToken, runAmazonSearch, MARKETPLACE_DOMAINS, MARKETPLACE_CURRENCY } from '../_amazonSearch.js';
import sql from '../../lib/db.js';

function isCronRequest(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers['authorization'] === `Bearer ${secret}`;
}

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  // GET: restituisce la cache deals dell'utente
  if (req.method === 'GET') {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const q = req.query as Record<string, string>;
    const platform     = q.platform || 'amazon';
    const minDiscount  = parseInt(q.minDiscount ?? '0') || 0;
    const maxDiscount  = parseInt(q.maxDiscount ?? '0') || 0;
    const searchIdxRaw = (q.searchIndexes ?? '').trim();
    const searchIdxs   = searchIdxRaw ? searchIdxRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

    let rows = await sql`
      SELECT product_id AS "productId", title, image,
             original_price::float AS "originalPrice",
             discounted_price::float AS "discountedPrice",
             discount_percent AS "discountPercent",
             currency, category, search_index AS "searchIndex",
             url, affiliate_url AS "affiliateUrl",
             found_at AS "foundAt"
      FROM deals_cache
      WHERE user_id = ${userId} AND platform = ${platform}
        AND (${minDiscount} = 0 OR discount_percent >= ${minDiscount})
        AND (${maxDiscount} = 0 OR discount_percent <= ${maxDiscount})
      ORDER BY discount_percent DESC
      LIMIT 800
    `;

    // Filtro categorie lato applicazione (search_index)
    if (searchIdxs.length > 0) {
      rows = rows.filter((r: any) => !r.searchIndex || searchIdxs.includes(r.searchIndex));
    }

    // Timestamp dell'ultimo aggiornamento
    const [lastRow] = await sql`
      SELECT MAX(found_at) AS last_found FROM deals_cache
      WHERE user_id = ${userId} AND platform = ${platform}
    `;

    res.json({
      products: rows.map((r: any) => ({ ...r, platform, rating: '' })),
      total: rows.length,
      refreshedAt: lastRow?.last_found ?? null,
    });
    return;
  }

  // POST: avvia refresh della cache (da UI con auth utente, o da cron con secret)
  if (req.method === 'POST') {
    const cronMode = isCronRequest(req);
    if (!cronMode) {
      const userId = requireUserId(req, res);
      if (!userId) return;
      // Avvia refresh in background per questo utente
      refreshUserCache(userId).catch(e => console.error('[deals-cache] refresh error:', e));
      res.json({ ok: true, message: 'Aggiornamento avviato in background' });
      return;
    }

    // Modalità cron: aggiorna tutti gli utenti con auto-publish attivo
    const activeUsers = await sql`
      SELECT user_id FROM settings
      WHERE (data->>'dealSearch')::jsonb->>'autoPublishAmazon' = 'true'
         OR (data->>'dealSearch')::jsonb->>'autoPublishAliexpress' = 'true'
    `;
    console.log(`[deals-cache] cron refresh per ${activeUsers.length} utenti`);
    for (const u of activeUsers) {
      try { await refreshUserCache(String(u.user_id)); } catch (e: any) {
        console.error(`[deals-cache] cron error userId=${u.user_id}:`, e.message);
      }
    }
    res.json({ ok: true, refreshed: activeUsers.length });
    return;
  }

  // DELETE: svuota cache
  if (req.method === 'DELETE') {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const { platform = 'amazon' } = req.query as Record<string, string>;
    const result = await sql`DELETE FROM deals_cache WHERE user_id = ${userId} AND platform = ${platform}`;
    res.json({ ok: true, deleted: (result as any).count ?? 0 });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
});

async function refreshUserCache(userId: string): Promise<void> {
  const [settingsRow] = await sql`SELECT data FROM settings WHERE user_id = ${userId}`;
  if (!settingsRow) return;
  const cfg = (typeof settingsRow.data === 'string' ? JSON.parse(settingsRow.data) : settingsRow.data) as Record<string, any>;

  const userHasCreds = !!(cfg.amazon?.credentialId && cfg.amazon?.credentialSecret);
  const credentialId     = cfg.amazon?.credentialId     || process.env.AMAZON_CREDENTIAL_ID     || '';
  const credentialSecret = cfg.amazon?.credentialSecret || process.env.AMAZON_CREDENTIAL_SECRET || '';
  const affiliateTag     = cfg.amazon?.affiliateTag || process.env.AMAZON_AFFILIATE_TAG || '';
  const version          = userHasCreds
    ? (cfg.amazon?.version || process.env.AMAZON_VERSION || '2.2')
    : (process.env.AMAZON_VERSION || '2.2');
  const marketplaceCode   = ((cfg.amazon?.marketplace || process.env.AMAZON_MARKETPLACE || 'IT').toUpperCase());
  const marketplaceDomain = MARKETPLACE_DOMAINS[marketplaceCode] ?? 'www.amazon.it';
  const currency          = MARKETPLACE_CURRENCY[marketplaceCode] ?? 'EUR';

  if (!credentialId || !credentialSecret || !affiliateTag) {
    console.log(`[deals-cache] refresh saltato userId=${userId}: credenziali Amazon mancanti`);
    return;
  }

  const ds = cfg.dealSearch?.amazon ?? {};
  const searchIndexesRaw = (ds.searchIndexes ?? '').trim();
  const searchIndexes    = searchIndexesRaw ? searchIndexesRaw.split(',').map((s: string) => s.trim()).filter(Boolean) : [];

  console.log(`[deals-cache] refresh userId=${userId} searchIndexes=${searchIndexes.join(',') || 'default'}`);

  const token = await getToken(credentialId, credentialSecret, version);

  // Scarica più blocchi di pagine per avere più risultati
  const allProducts: any[] = [];
  const seenAsins = new Set<string>();

  for (let block = 1; block <= 3; block++) {
    const { products, anyPageHadResults } = await runAmazonSearch(
      token, marketplaceDomain, currency, affiliateTag, {
        keywords: ds.keywords?.trim() || '',
        minDiscount: ds.minDiscount || 0,
        maxDiscount: ds.maxDiscount || 0,
        minPrice: ds.minPrice || 0,
        maxPrice: ds.maxPrice || 0,
        sortBy: ds.sort || 'Featured',
        searchIndexes,
        pageBlock: block,
        includeGoldbox: block === 1,
      }
    );
    for (const p of products) {
      if (!seenAsins.has(p.productId)) { seenAsins.add(p.productId); allProducts.push(p); }
    }
    if (!anyPageHadResults) break;
    // Pausa tra blocchi per non sforare rate limit
    if (block < 3) await new Promise(r => setTimeout(r, 3000));
  }

  // Upsert tutto in deals_cache
  for (const p of allProducts) {
    await sql`
      INSERT INTO deals_cache (id, user_id, platform, product_id, title, image,
        original_price, discounted_price, discount_percent, currency, category,
        search_index, url, affiliate_url, found_at)
      VALUES (
        gen_random_uuid(), ${userId}, 'amazon', ${p.productId}, ${p.title}, ${p.image},
        ${p.originalPrice}, ${p.discountedPrice}, ${p.discountPercent}, ${p.currency},
        ${p.category}, ${p.searchIndex ?? ''}, ${p.url}, ${p.affiliateUrl}, now()
      )
      ON CONFLICT (user_id, platform, product_id) DO UPDATE SET
        title = EXCLUDED.title, image = EXCLUDED.image,
        original_price = EXCLUDED.original_price, discounted_price = EXCLUDED.discounted_price,
        discount_percent = EXCLUDED.discount_percent, category = EXCLUDED.category,
        url = EXCLUDED.url, affiliate_url = EXCLUDED.affiliate_url, found_at = now()
    `;
  }

  // Rimuovi prodotti vecchi (trovati più di 48h fa e non aggiornati ora)
  await sql`
    DELETE FROM deals_cache
    WHERE user_id = ${userId} AND platform = 'amazon'
      AND found_at < now() - INTERVAL '48 hours'
  `;

  console.log(`[deals-cache] refresh completato userId=${userId}: ${allProducts.length} prodotti salvati`);
}

export { refreshUserCache };
