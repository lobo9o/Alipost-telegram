import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';
import sql from '../../lib/db.js';

const TOKEN_ENDPOINTS: Record<string, string> = {
  '2.1': 'https://creatorsapi.auth.us-east-1.amazoncognito.com/oauth2/token',
  '2.2': 'https://creatorsapi.auth.eu-south-2.amazoncognito.com/oauth2/token',
  '2.3': 'https://creatorsapi.auth.us-west-2.amazoncognito.com/oauth2/token',
  '3.1': 'https://api.amazon.com/auth/o2/token',
  '3.2': 'https://api.amazon.co.uk/auth/o2/token',
  '3.3': 'https://api.amazon.co.jp/auth/o2/token',
};

const MARKETPLACE_DOMAINS: Record<string, string> = {
  IT: 'www.amazon.it',
  US: 'www.amazon.com',
  DE: 'www.amazon.de',
  FR: 'www.amazon.fr',
  ES: 'www.amazon.es',
  UK: 'www.amazon.co.uk',
  JP: 'www.amazon.co.jp',
  CA: 'www.amazon.ca',
};

const MARKETPLACE_CURRENCY: Record<string, string> = {
  IT: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', NL: 'EUR',
  UK: 'GBP', US: 'USD', JP: 'JPY', CA: 'CAD',
};

async function getToken(credentialId: string, credentialSecret: string, version: string): Promise<string> {
  const tokenUrl = TOKEN_ENDPOINTS[version];
  if (!tokenUrl) throw new Error(`Versione non supportata: ${version}`);
  const isCognito = version.startsWith('2');

  let res: Response;
  if (isCognito) {
    const basic = Buffer.from(`${credentialId}:${credentialSecret}`).toString('base64');
    res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${basic}` },
      body: 'grant_type=client_credentials&scope=creatorsapi%2Fdefault',
    });
  } else {
    res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: credentialId,
        client_secret: credentialSecret,
        scope: 'creatorsapi::default',
      }).toString(),
    });
  }

  const text = await res.text();
  console.log(`[amazon-deals] token ${res.status}:`, text.slice(0, 80));
  if (!res.ok) throw new Error(`Token Amazon (${res.status}): ${text.slice(0, 200)}`);
  return (JSON.parse(text) as { access_token: string }).access_token;
}

function pick(obj: unknown, ...keys: string[]): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
}

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;

  const [settingsRow] = await sql`SELECT data FROM settings WHERE user_id = ${userId}`;
  const rawData = settingsRow?.data ?? {};
  const cfg = (typeof rawData === 'string' ? JSON.parse(rawData) : rawData) as Record<string, any>;

  const userHasCreds   = !!(cfg.amazon?.credentialId && cfg.amazon?.credentialSecret);
  const credentialId   = cfg.amazon?.credentialId     || process.env.AMAZON_CREDENTIAL_ID     || '';
  const credentialSecret = cfg.amazon?.credentialSecret || process.env.AMAZON_CREDENTIAL_SECRET || '';
  const apiTag         = userHasCreds ? (cfg.amazon?.affiliateTag || '') : (process.env.AMAZON_AFFILIATE_TAG || '');
  const affiliateTag   = cfg.amazon?.affiliateTag || process.env.AMAZON_AFFILIATE_TAG || '';
  const version        = userHasCreds
    ? (cfg.amazon?.version      || process.env.AMAZON_VERSION      || '2.2')
    : (process.env.AMAZON_VERSION || '2.2');
  const marketplaceCode = ((cfg.amazon?.marketplace || process.env.AMAZON_MARKETPLACE || 'IT').toUpperCase());
  const marketplaceDomain = MARKETPLACE_DOMAINS[marketplaceCode] ?? 'www.amazon.it';
  const currency = MARKETPLACE_CURRENCY[marketplaceCode] ?? 'EUR';

  if (!credentialId || !credentialSecret || !apiTag) {
    res.status(400).json({ error: 'Credenziali Amazon non configurate. Vai in Impostazioni → Amazon.' });
    return;
  }

  const q           = req.query as Record<string, string>;
  const keywords    = (q.keywords ?? '').trim();
  const minDiscount = parseInt(q.minDiscount  ?? '0') || 0;
  const minPrice    = parseFloat(q.minPrice   ?? '0') || 0;
  const maxPrice    = parseFloat(q.maxPrice   ?? '0') || 0;
  const sortBy      = q.sort || 'Featured';
  const searchIndex = (q.searchIndex ?? '').trim();
  const page        = Math.max(1, parseInt(q.page ?? '1') || 1);
  const minRating   = parseFloat(q.minRating ?? '0') || 0;

  if (!keywords && !searchIndex) {
    res.status(400).json({ error: 'Inserisci almeno una parola chiave o seleziona una categoria.' });
    return;
  }

  const token = await getToken(credentialId, credentialSecret, version);

  const body: Record<string, any> = {
    partnerTag:  apiTag,
    partnerType: 'associates',
    resources: [
      'itemInfo.title',
      'images.primary.large',
      'offersV2.listings.price',
      'browseNodeInfo.browseNodes',
    ],
    itemPage: page,
  };
  if (keywords)           body.keywords        = keywords;
  if (searchIndex)        body.searchIndex     = searchIndex;
  if (minDiscount > 0)    body.minSavingPercent = minDiscount;
  if (minPrice > 0)       body.minPrice        = Math.round(minPrice * 100);
  if (maxPrice > 0)       body.maxPrice        = Math.round(maxPrice * 100);
  if (minRating > 0)      body.minReviewsRating = Math.round(minRating);
  if (sortBy && sortBy !== 'Featured') body.sortBy = sortBy;

  const apiRes = await fetch('https://creatorsapi.amazon/catalog/v1/searchItems', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-marketplace': marketplaceDomain,
      'User-Agent': 'creatorsapi-nodejs-sdk/1.2.0',
    },
    body: JSON.stringify(body),
  });
  const text = await apiRes.text();
  console.log('[amazon-deals] searchItems', apiRes.status, text.slice(0, 400));

  if (!apiRes.ok) {
    res.status(apiRes.status).json({ error: `Amazon API (${apiRes.status}): ${text.slice(0, 300)}` });
    return;
  }

  const data = JSON.parse(text) as any;
  const searchResult    = pick(data, 'searchResult', 'SearchResult') as any;
  const items           = (pick(searchResult, 'items', 'Items') as any[]) ?? [];
  const totalResultCount = Number(pick(searchResult, 'totalResultCount', 'TotalResultCount') ?? items.length);

  const products = items.flatMap((item: any) => {
    const asin       = String(pick(item, 'asin', 'ASIN') ?? '');
    if (!asin) return [];

    const titleVal   = pick(pick(pick(item, 'itemInfo', 'ItemInfo'), 'title', 'Title'), 'displayValue', 'DisplayValue');
    const imageUrl   = pick(pick(pick(pick(item, 'images', 'Images'), 'primary', 'Primary'), 'large', 'Large'), 'url', 'URL');

    const offersV2   = pick(item, 'offersV2', 'OffersV2') as any;
    const listings   = ((pick(offersV2, 'listings', 'Listings') as any[]) ?? [])[0];
    const priceObj   = pick(listings, 'price', 'Price') as any;

    const discountedPrice  = Number(pick(pick(priceObj, 'money', 'Money'), 'amount', 'Amount') ?? 0);
    const savingBasisAmt   = Number(pick(pick(pick(priceObj, 'savingBasis', 'SavingBasis'), 'money', 'Money'), 'amount', 'Amount') ?? 0);
    const savingsPct       = Number(pick(pick(priceObj, 'savings', 'Savings'), 'percentage', 'Percentage') ?? 0);
    const originalPrice    = savingBasisAmt > 0 ? savingBasisAmt : discountedPrice;
    const discountPercent  = savingsPct > 0
      ? Math.round(savingsPct)
      : originalPrice > discountedPrice
        ? Math.round((1 - discountedPrice / originalPrice) * 100) : 0;

    if (discountedPrice <= 0) return [];

    const browseNodes = (pick(pick(item, 'browseNodeInfo', 'BrowseNodeInfo'), 'browseNodes', 'BrowseNodes') as any[]) ?? [];
    const category    = browseNodes[0] ? String(pick(browseNodes[0], 'displayName', 'DisplayName') ?? '') : '';

    return [{
      productId:       asin,
      title:           String(titleVal ?? ''),
      image:           String(imageUrl ?? ''),
      originalPrice,
      discountedPrice,
      discountPercent,
      currency,
      category,
      rating:          '',
      url:             `https://${marketplaceDomain}/dp/${asin}`,
      affiliateUrl:    `https://${marketplaceDomain}/dp/${asin}?tag=${affiliateTag}`,
      platform:        'amazon',
    }];
  });

  // Ordina per sconto decrescente
  products.sort((a, b) => b.discountPercent - a.discountPercent);

  res.json({ products, total: totalResultCount, page });
});
