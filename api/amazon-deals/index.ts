import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';
import { getToken, runAmazonSearch, MARKETPLACE_DOMAINS, MARKETPLACE_CURRENCY, PAGES_PER_CATEGORY } from '../_amazonSearch.js';
import sql from '../../lib/db.js';

async function saveToCache(userId: string, products: any[]): Promise<void> {
  if (!products.length) return;
  try {
    for (const p of products) {
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
          search_index = EXCLUDED.search_index, url = EXCLUDED.url,
          affiliate_url = EXCLUDED.affiliate_url, found_at = now()
      `;
    }
    console.log(`[amazon-deals] salvati ${products.length} prodotti in cache per userId=${userId}`);
  } catch (e: any) {
    console.warn('[amazon-deals] cache save error:', e.message);
  }
}

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;

  const [settingsRow] = await sql`SELECT data FROM settings WHERE user_id = ${userId}`;
  const rawData = settingsRow?.data ?? {};
  const cfg = (typeof rawData === 'string' ? JSON.parse(rawData) : rawData) as Record<string, any>;

  const userHasCreds     = !!(cfg.amazon?.credentialId && cfg.amazon?.credentialSecret);
  const credentialId     = cfg.amazon?.credentialId     || process.env.AMAZON_CREDENTIAL_ID     || '';
  const credentialSecret = cfg.amazon?.credentialSecret || process.env.AMAZON_CREDENTIAL_SECRET || '';
  const apiTag           = userHasCreds ? (cfg.amazon?.affiliateTag || '') : (process.env.AMAZON_AFFILIATE_TAG || '');
  const affiliateTag     = cfg.amazon?.affiliateTag || process.env.AMAZON_AFFILIATE_TAG || '';
  const version          = userHasCreds
    ? (cfg.amazon?.version || process.env.AMAZON_VERSION || '2.2')
    : (process.env.AMAZON_VERSION || '2.2');
  const marketplaceCode   = ((cfg.amazon?.marketplace || process.env.AMAZON_MARKETPLACE || 'IT').toUpperCase());
  const marketplaceDomain = MARKETPLACE_DOMAINS[marketplaceCode] ?? 'www.amazon.it';
  const currency          = MARKETPLACE_CURRENCY[marketplaceCode] ?? 'EUR';

  if (!credentialId || !credentialSecret || !apiTag) {
    res.status(400).json({ error: 'Credenziali Amazon non configurate. Vai in Impostazioni → Amazon.' });
    return;
  }

  const q           = req.query as Record<string, string>;
  const keywords    = (q.keywords    ?? '').trim();
  const minDiscount = parseInt(q.minDiscount  ?? '0') || 0;
  const maxDiscount = parseInt(q.maxDiscount  ?? '0') || 0;
  const minPrice    = parseFloat(q.minPrice   ?? '0') || 0;
  const maxPrice    = parseFloat(q.maxPrice   ?? '0') || 0;
  const sortBy      = q.sort || 'Featured';
  const searchIndexesRaw = (q.searchIndexes ?? q.searchIndex ?? '').trim();
  const searchIndexes    = searchIndexesRaw ? searchIndexesRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  const pageBlock   = Math.max(1, parseInt(q.page ?? '1') || 1);
  const isMulti     = searchIndexes.length > 1 || (!keywords && !searchIndexesRaw);

  const token = await getToken(credentialId, credentialSecret, version);

  const { products, anyPageHadResults } = await runAmazonSearch(token, marketplaceDomain, currency, affiliateTag, {
    keywords, minDiscount, maxDiscount, minPrice, maxPrice, sortBy,
    searchIndexes, pageBlock, includeGoldbox: true,
  });

  // Salva in cache solo al blocco 1 (evita duplicati con reset)
  if (pageBlock === 1) saveToCache(userId, products).catch(() => {});

  const total = isMulti
    ? (anyPageHadResults ? products.length + PAGES_PER_CATEGORY * 10 : products.length)
    : products.length;

  res.json({ products, total, page: pageBlock });
});
