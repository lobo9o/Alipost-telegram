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
  IT: 'www.amazon.it', US: 'www.amazon.com', DE: 'www.amazon.de',
  FR: 'www.amazon.fr', ES: 'www.amazon.es', UK: 'www.amazon.co.uk',
  JP: 'www.amazon.co.jp', CA: 'www.amazon.ca',
};

const MARKETPLACE_CURRENCY: Record<string, string> = {
  IT: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', NL: 'EUR',
  UK: 'GBP', US: 'USD', JP: 'JPY', CA: 'CAD',
};

// Categorie valide per il marketplace IT (fonte: amazon.it/paapi5/locale-reference/italy)
const DEFAULT_INDEXES = [
  'Electronics', 'Computers', 'VideoGames', 'HomeAndKitchen', 'SportsAndOutdoors',
  'HealthPersonalCare', 'Beauty', 'Automotive', 'Baby', 'Books', 'Apparel',
  'Shoes', 'Watches', 'Jewelry', 'GardenAndOutdoor', 'MusicalInstruments',
  'OfficeProducts', 'PetSupplies', 'ToolsAndHomeImprovement', 'Luggage', 'EverythingElse',
];

const PAGES_PER_CATEGORY = 3;

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

async function searchOne(
  token: string,
  marketplaceDomain: string,
  body: Record<string, any>,
): Promise<{ products: any[]; total: number }> {
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
  const label = `${body.searchIndex ?? 'noIdx'} p${body.itemPage}`;
  console.log('[amazon-deals]', label, apiRes.status, text.slice(0, 150));

  if (!apiRes.ok) throw new Error(`Amazon API ${apiRes.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text) as any;
  const sr    = pick(data, 'searchResult', 'SearchResult') as any;
  const items = (pick(sr, 'items', 'Items') as any[]) ?? [];
  const total = Number(pick(sr, 'totalResultCount', 'TotalResultCount') ?? items.length);
  return { products: items, total };
}

async function batchAll<T>(tasks: (() => Promise<T>)[], batchSize = 3, delayMs = 600): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(t => t()));
    results.push(...batchResults);
    if (i + batchSize < tasks.length) await new Promise(r => setTimeout(r, delayMs));
  }
  return results;
}

// Estrae ASIN dalla pagina pubblica Amazon Deals/Goldbox
async function fetchGoldboxAsins(marketplaceDomain: string): Promise<string[]> {
  const urls = [
    `https://${marketplaceDomain}/deals`,
    `https://${marketplaceDomain}/gp/goldbox`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const matches = [...html.matchAll(/data-asin="([A-Z0-9]{10})"/g)];
      const asins = [...new Set(matches.map(m => m[1]))].filter(Boolean);
      if (asins.length > 0) {
        console.log(`[amazon-deals] goldbox ${url}: ${asins.length} ASIN trovati`);
        return asins.slice(0, 120);
      }
    } catch (e: any) {
      console.warn('[amazon-deals] goldbox fetch error:', e.message);
    }
  }
  return [];
}

// Recupera dettagli prodotto per lista ASIN tramite Creators API getItems
async function getItemsByAsins(
  token: string,
  marketplaceDomain: string,
  asins: string[],
  affiliateTag: string,
): Promise<any[]> {
  if (!asins.length) return [];
  const BATCH = 10;
  const results: any[] = [];
  for (let i = 0; i < asins.length; i += BATCH) {
    const batch = asins.slice(i, i + BATCH);
    try {
      const apiRes = await fetch('https://creatorsapi.amazon/catalog/v1/getItems', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'x-marketplace': marketplaceDomain,
          'User-Agent': 'creatorsapi-nodejs-sdk/1.2.0',
        },
        body: JSON.stringify({
          itemIds: batch,
          partnerTag: affiliateTag,
          partnerType: 'associates',
          resources: ['itemInfo.title', 'images.primary.large', 'offersV2.listings.price', 'browseNodeInfo.browseNodes'],
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!apiRes.ok) { console.warn('[amazon-deals] getItems', apiRes.status); continue; }
      const data = await apiRes.json() as any;
      const items = (data.itemsResult?.items ?? data.ItemsResult?.Items ?? []) as any[];
      results.push(...items);
    } catch (e: any) {
      console.warn('[amazon-deals] getItems batch error:', e.message);
    }
    if (i + BATCH < asins.length) await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

function parseItem(item: any, currency: string, marketplaceDomain: string, affiliateTag: string) {
  const asin     = String(pick(item, 'asin', 'ASIN') ?? '');
  if (!asin) return null;

  const titleVal  = pick(pick(pick(item, 'itemInfo', 'ItemInfo'), 'title', 'Title'), 'displayValue', 'DisplayValue');
  const imageUrl  = pick(pick(pick(pick(item, 'images', 'Images'), 'primary', 'Primary'), 'large', 'Large'), 'url', 'URL');
  const offersV2  = pick(item, 'offersV2', 'OffersV2') as any;
  const listings  = ((pick(offersV2, 'listings', 'Listings') as any[]) ?? [])[0];
  const priceObj  = pick(listings, 'price', 'Price') as any;

  const discountedPrice = Number(pick(pick(priceObj, 'money', 'Money'), 'amount', 'Amount') ?? 0);
  const savingBasisAmt  = Number(pick(pick(pick(priceObj, 'savingBasis', 'SavingBasis'), 'money', 'Money'), 'amount', 'Amount') ?? 0);
  const savingsPct      = Number(pick(pick(priceObj, 'savings', 'Savings'), 'percentage', 'Percentage') ?? 0);
  const originalPrice   = savingBasisAmt > 0 ? savingBasisAmt : discountedPrice;
  const discountPercent = savingsPct > 0
    ? Math.round(savingsPct)
    : originalPrice > discountedPrice ? Math.round((1 - discountedPrice / originalPrice) * 100) : 0;

  if (discountedPrice <= 0) return null;

  const browseNodes = (pick(pick(item, 'browseNodeInfo', 'BrowseNodeInfo'), 'browseNodes', 'BrowseNodes') as any[]) ?? [];
  const category    = browseNodes[0] ? String(pick(browseNodes[0], 'displayName', 'DisplayName') ?? '') : '';

  return {
    productId: asin, title: String(titleVal ?? ''), image: String(imageUrl ?? ''),
    originalPrice, discountedPrice, discountPercent, currency, category,
    rating: '', url: `https://${marketplaceDomain}/dp/${asin}`,
    affiliateUrl: `https://${marketplaceDomain}/dp/${asin}?tag=${affiliateTag}`,
    platform: 'amazon',
  };
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

  const baseBody: Record<string, any> = {
    partnerTag: apiTag, partnerType: 'associates',
    resources: ['itemInfo.title', 'images.primary.large', 'offersV2.listings.price', 'browseNodeInfo.browseNodes'],
  };
  if (keywords)              baseBody.keywords         = keywords;
  baseBody.minSavingPercent = minDiscount > 0 ? minDiscount : 1;
  if (minPrice > 0)          baseBody.minPrice         = Math.round(minPrice * 100);
  if (maxPrice > 0)          baseBody.maxPrice         = Math.round(maxPrice * 100);
  if (sortBy !== 'Featured') baseBody.sortBy           = sortBy;

  const indexes = searchIndexes.length > 0
    ? searchIndexes
    : keywords ? [''] : DEFAULT_INDEXES;

  const seen = new Set<string>();
  let rawItems: any[] = [];
  let anyPageHadResults = false;

  // ── Metodo 1: Creators API searchItems ──────────────────────────────────────
  if (isMulti) {
    const startPage = (pageBlock - 1) * PAGES_PER_CATEGORY + 1;
    const pagesToFetch = Array.from({ length: PAGES_PER_CATEGORY }, (_, i) => startPage + i);

    const tasks = indexes.flatMap(idx =>
      pagesToFetch.map(pg => () => {
        const body = { ...baseBody, itemPage: pg };
        if (idx) body.searchIndex = idx;
        return searchOne(token, marketplaceDomain, body).catch(e => {
          console.warn('[amazon-deals] skip', idx, 'p'+pg, e.message);
          return { products: [], total: 0 };
        });
      })
    );

    // ── Metodo 2: Goldbox (solo blocco 1) ────────────────────────────────────
    const goldboxPromise = pageBlock === 1
      ? fetchGoldboxAsins(marketplaceDomain)
          .then(asins => {
            if (!asins.length) return [];
            // Rimuovi ASIN già trovati da searchItems (li aggiungiamo dopo)
            return getItemsByAsins(token, marketplaceDomain, asins, affiliateTag);
          })
          .catch(() => [] as any[])
      : Promise.resolve([] as any[]);

    const [searchResults, goldboxItems] = await Promise.all([
      batchAll(tasks, 6, 250),
      goldboxPromise,
    ]);

    for (const r of searchResults) {
      if (r.products.length > 0) anyPageHadResults = true;
      for (const item of r.products) {
        const asin = String(pick(item, 'asin', 'ASIN') ?? '');
        if (asin && !seen.has(asin)) { seen.add(asin); rawItems.push(item); }
      }
    }

    // Aggiunge i prodotti goldbox non ancora presenti
    let goldboxNew = 0;
    for (const item of goldboxItems) {
      const asin = String(pick(item, 'asin', 'ASIN') ?? '');
      if (asin && !seen.has(asin)) { seen.add(asin); rawItems.push(item); goldboxNew++; }
    }
    if (goldboxNew > 0) console.log(`[amazon-deals] goldbox ha aggiunto ${goldboxNew} nuovi prodotti`);

  } else {
    const body = { ...baseBody, itemPage: pageBlock };
    if (indexes[0]) body.searchIndex = indexes[0];
    const r = await searchOne(token, marketplaceDomain, body);
    rawItems = r.products;
    anyPageHadResults = r.products.length > 0;
  }

  // ── Mappa, filtra e ordina ──────────────────────────────────────────────────
  let products = rawItems
    .map(item => parseItem(item, currency, marketplaceDomain, affiliateTag))
    .filter((p): p is NonNullable<ReturnType<typeof parseItem>> => p !== null);

  if (maxDiscount > 0) products = products.filter(p => p.discountPercent <= maxDiscount);

  products.sort((a, b) => b.discountPercent - a.discountPercent);

  const total = isMulti
    ? (anyPageHadResults ? products.length + PAGES_PER_CATEGORY * 10 : products.length)
    : rawItems.length;

  res.json({ products, total, page: pageBlock });
});
