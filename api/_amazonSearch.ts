// Logica di ricerca Amazon condivisa tra amazon-deals e deals-cache

export const TOKEN_ENDPOINTS: Record<string, string> = {
  '2.1': 'https://creatorsapi.auth.us-east-1.amazoncognito.com/oauth2/token',
  '2.2': 'https://creatorsapi.auth.eu-south-2.amazoncognito.com/oauth2/token',
  '2.3': 'https://creatorsapi.auth.us-west-2.amazoncognito.com/oauth2/token',
  '3.1': 'https://api.amazon.com/auth/o2/token',
  '3.2': 'https://api.amazon.co.uk/auth/o2/token',
  '3.3': 'https://api.amazon.co.jp/auth/o2/token',
};

export const MARKETPLACE_DOMAINS: Record<string, string> = {
  IT: 'www.amazon.it', US: 'www.amazon.com', DE: 'www.amazon.de',
  FR: 'www.amazon.fr', ES: 'www.amazon.es', UK: 'www.amazon.co.uk',
  JP: 'www.amazon.co.jp', CA: 'www.amazon.ca',
};

export const MARKETPLACE_CURRENCY: Record<string, string> = {
  IT: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', NL: 'EUR',
  UK: 'GBP', US: 'USD', JP: 'JPY', CA: 'CAD',
};

export const DEFAULT_INDEXES = [
  'Electronics', 'Computers', 'VideoGames', 'HomeAndKitchen',
  'SportsAndOutdoors', 'HealthPersonalCare', 'Beauty', 'Automotive',
  'Baby', 'Books', 'Apparel', 'Shoes',
];

export const DEFAULT_BRAND_KEYWORDS = [
  'absolut','acer','activision','adidas','aeg','aigostar',
  'airwick','alpro','amaro montenegro','amazfit','amazon','ambi pur',
  'amd','amuchina','anker','aoc','aperol','apple',
  'arctic','ariete','armani','asrock','astro gaming','asus',
  'aukey','bacardi','baileys','bandai','barbie','barilla',
  'bauli','bayer','be-total','belkin','bellissima','benq',
  'bethesda','bialetti','biffi','bifinett','bistefani','black+decker',
  'blink','bombay','bonomelli','borbone','borotalco','bosch',
  'boss','bottega verde','braun','breil','brita','calgon',
  'calvé','calvin klein','cameo','candy','canon','capcom',
  'carrera','casio','cecotec','cerave','champion','chanteclair',
  'chicco','chupa chups','ciarra','cif','citrosodina','clementoni',
  'coca-cola','cocolino','codemasters','colgate','collistar','comfee',
  'converse','cooler master','corsair','creative','crocs','crucial',
  'cuisinart','daniel wellington','dash','david jones','de cecco',"de'longhi",
  'delicius','dell','der-franz','diadora','diesel','dior',
  'disney','dixan','doritos','dove','dreame','dreo',
  'duracell','durex','echo dot','echo show','ecovacs','eero',
  'electrolux','electronic arts','emporio armani','epson','equilibra','eufy',
  'eureka','evga','fairy','ferrero','fila','finish',
  'fire hd','fire tv','fitbit','foppapedretti','forno bonomi','fossil',
  'frontline','funk','galbusera','garmin','garnier','garofalo',
  'geox','gigabyte','gillette','goleador','google','govee',
  'gran cereale','granarolo','granbest','grisbi','gucci','haier',
  'haribo','hasbro','hasbro gaming','head & shoulders','herbal essence','hisense',
  'honor','hoover','hotpoint','hp','huawei','hugo',
  'hugo boss','hyperx','illy','imetec','indesit','intel',
  'intex','irobot','jabra',"jack daniel's",'jaotto','jbl',
  "kellogg's",'kenwood','kimbo','kinder','kingston','kipling',
  'kitkat','knorr','kodak','konami',"l'oréal paris","l'oréal professionnel",
  'la cafetiere','la molisana','labello','lacoste','lagostina','laica',
  'lamborghini','laura biagiotti','lavazza','lego','lenor','lenovo',
  "levi's",'levoit','lexar','lg','lindor','lindt',
  'lines','lipton','listerine','loacker','logitech','lydevo',
  "m&m's",'maalox','magic the gathering','mars gaming','marvel','maybelline',
  'merross','microsoft','milestones','milka','misura','morellato',
  'motorola','motta','moulinex','msi','mulino bianco','nacon',
  'namco','narwal','nero giardini','nescafé','nespresso','nestlé',
  'netac','netgear','nike','nintendo','nivea','nothing',
  'nutella','nzxt','olay','olaz','olimpia splendid','oneplus',
  'oppo','oral-b','oreo','oversteel','paco rabanne','pan di stelle',
  'panasonic','panini','pantene','patriot memory','pavesi','pedigree',
  'pellini','peroni','perugina','philips','pioneer','playstation',
  'pokémon','polti','poretti','powera','pringles','protein works',
  'puma','purina','quasar','raid','ray-ban','razer',
  'realme','red bull','remington','renpho','reolink','revlon',
  'ring','riso scotti','roblox','roborock','roscenic','rowenta',
  "rubik's",'russel hobbs','sacla','samsung','san benedetto','san carlo',
  'sandisk','sapphire','scholl','schwarzkopf','scottex','seagate',
  'sega','sennheiser','severin','sharp','snickers','sodastream',
  'sonoff','sony','spigen','starbucks','steelseries','sunsilk',
  'superga','swarovski','swiffer','tapo','tcl','tena',
  "tennent's","tesori d'oriente",'the north face','thermalright','thq nordic','thun',
  'ticwatch','tigullio','timberland','tineco','toshiba','tp-link',
  'tristar','trust','tuborg','tuc','twinings','ubena',
  'ubisoft','ugreen','ultenic','under armour','united colors of benetton','v-tac',
  'vagisil','vanish','vans','varta','veet','vergnano',
  'versace','versuni','vidal','vigorsol','vileda','vitalcare',
  'vivident','voiello','warner bros','wd','western digital','whirlpool',
  'whiskas','wilkinson','xbox','xiaomi',
];


export const PAGES_PER_CATEGORY = 3;

export interface DealProduct {
  productId: string;
  title: string;
  image: string;
  originalPrice: number;
  discountedPrice: number;
  discountPercent: number;
  currency: string;
  category: string;
  searchIndex: string;
  url: string;
  affiliateUrl: string;
  platform: 'amazon';
  reviewRating: number;
  reviewCount: number;
  brandKeyword: string;
}

export async function getToken(credentialId: string, credentialSecret: string, version: string): Promise<string> {
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
  if (!res.ok) throw new Error(`Token Amazon (${res.status}): ${text.slice(0, 200)}`);
  return (JSON.parse(text) as { access_token: string }).access_token;
}

export function pick(obj: unknown, ...keys: string[]): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
}

export async function searchOne(
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
  console.log('[amazon-search]', label, apiRes.status, text.slice(0, 100));

  if (!apiRes.ok) throw new Error(`Amazon API ${apiRes.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text) as any;
  const sr    = pick(data, 'searchResult', 'SearchResult') as any;
  const items = (pick(sr, 'items', 'Items') as any[]) ?? [];
  const total = Number(pick(sr, 'totalResultCount', 'TotalResultCount') ?? items.length);
  return { products: items, total };
}

export async function batchAll<T>(tasks: (() => Promise<T>)[], batchSize = 2, delayMs = 600): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(t => t()));
    results.push(...batchResults);
    if (i + batchSize < tasks.length) await new Promise(r => setTimeout(r, delayMs));
  }
  return results;
}

export async function fetchGoldboxAsins(marketplaceDomain: string): Promise<string[]> {
  const urls = [`https://${marketplaceDomain}/deals`, `https://${marketplaceDomain}/gp/goldbox`];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const matches = [...html.matchAll(/data-asin="([A-Z0-9]{10})"/g)];
      const asins = [...new Set(matches.map(m => m[1]))].filter(Boolean);
      if (asins.length > 0) {
        console.log(`[amazon-search] goldbox ${url}: ${asins.length} ASIN`);
        return asins.slice(0, 120);
      }
    } catch (e: any) {
      console.warn('[amazon-search] goldbox error:', e.message);
    }
  }
  return [];
}

export async function getItemsByAsins(
  token: string, marketplaceDomain: string, asins: string[], affiliateTag: string,
  resourcesOverride?: string[],
): Promise<any[]> {
  if (!asins.length) return [];
  const BATCH = 10;
  const resources = resourcesOverride ?? GETITEMS_RESOURCES;
  const results: any[] = [];
  for (let i = 0; i < asins.length; i += BATCH) {
    const batch = asins.slice(i, i + BATCH);
    try {
      const body = JSON.stringify({
        itemIds: batch, partnerTag: affiliateTag, partnerType: 'associates',
        resources,
      });
      const apiRes = await fetch('https://creatorsapi.amazon/catalog/v1/getItems', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'x-marketplace': marketplaceDomain,
          'User-Agent': 'creatorsapi-nodejs-sdk/1.2.0',
        },
        body,
      });
      if (!apiRes.ok) continue;
      const data = await apiRes.json() as any;
      const items = (data.itemsResult?.items ?? data.ItemsResult?.Items ?? []) as any[];
      results.push(...items);
    } catch { }
    if (i + BATCH < asins.length) await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

export function parseItem(
  item: any, currency: string, marketplaceDomain: string, affiliateTag: string,
  searchIndex = '', brandKeyword = '',
): DealProduct | null {
  const asin = String(pick(item, 'asin', 'ASIN') ?? '');
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

  const browseNodes  = (pick(pick(item, 'browseNodeInfo', 'BrowseNodeInfo'), 'browseNodes', 'BrowseNodes') as any[]) ?? [];
  const category     = browseNodes[0] ? String(pick(browseNodes[0], 'displayName', 'DisplayName') ?? '') : '';
  const reviews      = pick(item, 'customerReviews', 'CustomerReviews') as any;
  // starRating è un oggetto { Value: 4.5, DisplayValue: "..." } — estrai .Value
  const starRatingRaw = pick(reviews, 'starRating', 'StarRating') as any;
  const reviewRating  = Number(
    (starRatingRaw && typeof starRatingRaw === 'object')
      ? (pick(starRatingRaw, 'value', 'Value') ?? 0)
      : (starRatingRaw ?? 0)
  );
  const reviewCount  = Number(pick(reviews, 'count', 'Count') ?? 0);

  return {
    productId: asin, title: String(titleVal ?? ''), image: String(imageUrl ?? ''),
    originalPrice, discountedPrice, discountPercent, currency, category, searchIndex,
    url: `https://${marketplaceDomain}/dp/${asin}`,
    affiliateUrl: `https://${marketplaceDomain}/dp/${asin}?tag=${affiliateTag}`,
    platform: 'amazon', reviewRating, reviewCount, brandKeyword,
  };
}

export interface SearchParams {
  keywords?: string;
  minDiscount?: number;
  maxDiscount?: number;
  minPrice?: number;
  maxPrice?: number;
  sortBy?: string;
  searchIndexes?: string[];
  pageBlock?: number;
  includeGoldbox?: boolean;
  merchant?: string;   // 'Amazon' = sold by Amazon
  minRating?: number;  // 1-5
}

const SEARCH_RESOURCES = [
  'itemInfo.title', 'images.primary.large', 'offersV2.listings.price',
  'browseNodeInfo.browseNodes', 'customerReviews.starRating', 'customerReviews.count',
];

// GetItems supporta customerReviews a differenza di SearchItems
const GETITEMS_RESOURCES = [
  'itemInfo.title', 'images.primary.large', 'offersV2.listings.price',
  'customerReviews.starRating', 'customerReviews.count',
];

// Esegue una ricerca completa e restituisce i prodotti trovati
export async function runAmazonSearch(
  token: string,
  marketplaceDomain: string,
  currency: string,
  affiliateTag: string,
  params: SearchParams,
): Promise<{ products: DealProduct[]; anyPageHadResults: boolean }> {
  const {
    keywords = '', minDiscount = 0, maxDiscount = 0,
    minPrice = 0, maxPrice = 0, sortBy = 'Featured',
    searchIndexes = [], pageBlock = 1, includeGoldbox = false,
    merchant, minRating,
  } = params;

  const baseBody: Record<string, any> = {
    partnerTag: affiliateTag, partnerType: 'associates',
    resources: SEARCH_RESOURCES,
  };
  if (keywords)              baseBody.keywords         = keywords;
  baseBody.minSavingPercent  = minDiscount > 0 ? minDiscount : 1;
  if (minPrice > 0)          baseBody.minPrice         = Math.round(minPrice * 100);
  if (maxPrice > 0)          baseBody.maxPrice         = Math.round(maxPrice * 100);
  if (sortBy !== 'Featured') baseBody.sortBy           = sortBy;
  if (merchant === 'amazon') baseBody.merchant         = 'Amazon';
  if (minRating && minRating > 0) baseBody.minReviewsRating = minRating;

  const indexes = searchIndexes.length > 0
    ? searchIndexes
    : keywords ? [''] : DEFAULT_INDEXES;

  const isMulti = indexes.length > 1 || (!keywords && searchIndexes.length === 0);
  const seen = new Set<string>();
  const rawItems: Array<{ item: any; searchIndex: string }> = [];
  let anyPageHadResults = false;

  if (isMulti) {
    const startPage = (pageBlock - 1) * PAGES_PER_CATEGORY + 1;
    const pagesToFetch = Array.from({ length: PAGES_PER_CATEGORY }, (_, i) => startPage + i);

    const tasks = indexes.flatMap(idx =>
      pagesToFetch.map(pg => () => {
        const body = { ...baseBody, itemPage: pg };
        if (idx) body.searchIndex = idx;
        return searchOne(token, marketplaceDomain, body)
          .then(r => ({ r, idx }))
          .catch(e => {
            console.warn('[amazon-search] skip', idx, 'p'+pg, e.message);
            return { r: { products: [], total: 0 }, idx };
          });
      })
    );

    const goldboxPromise = (includeGoldbox && pageBlock === 1)
      ? fetchGoldboxAsins(marketplaceDomain)
          .then(asins => asins.length ? getItemsByAsins(token, marketplaceDomain, asins, affiliateTag) : [])
          .catch(() => [] as any[])
      : Promise.resolve([] as any[]);

    const [searchResults, goldboxItems] = await Promise.all([
      batchAll(tasks, 2, 600),
      goldboxPromise,
    ]);

    for (const { r, idx } of searchResults) {
      if (r.products.length > 0) anyPageHadResults = true;
      for (const item of r.products) {
        const asin = String(pick(item, 'asin', 'ASIN') ?? '');
        if (asin && !seen.has(asin)) { seen.add(asin); rawItems.push({ item, searchIndex: idx }); }
      }
    }
    for (const item of goldboxItems) {
      const asin = String(pick(item, 'asin', 'ASIN') ?? '');
      if (asin && !seen.has(asin)) { seen.add(asin); rawItems.push({ item, searchIndex: '' }); }
    }
  } else {
    const body = { ...baseBody, itemPage: pageBlock };
    const idx = indexes[0] ?? '';
    if (idx) body.searchIndex = idx;
    const r = await searchOne(token, marketplaceDomain, body);
    for (const item of r.products) {
      rawItems.push({ item, searchIndex: idx });
    }
    anyPageHadResults = r.products.length > 0;
  }

  const effectiveMin = minDiscount > 0 ? minDiscount : 1;
  let products = rawItems
    .map(({ item, searchIndex }) => parseItem(item, currency, marketplaceDomain, affiliateTag, searchIndex))
    .filter((p): p is DealProduct => p !== null && p.discountPercent >= effectiveMin);

  if (maxDiscount > 0) products = products.filter(p => p.discountPercent <= maxDiscount);
  products.sort((a, b) => b.discountPercent - a.discountPercent);

  return { products, anyPageHadResults };
}

// Cerca per ogni brand keyword (1 pagina ciascuna) e restituisce tutti i prodotti trovati
export async function runBrandKeywordsSearch(
  token: string,
  marketplaceDomain: string,
  currency: string,
  affiliateTag: string,
  brandKeywords: string[],
  opts: { merchant?: string; minRating?: number; searchIndexes?: string[] } = {},
): Promise<DealProduct[]> {
  const baseBody: Record<string, any> = {
    partnerTag: affiliateTag, partnerType: 'associates',
    resources: SEARCH_RESOURCES,
    minSavingPercent: 1,
    itemPage: 1,
  };
  if (opts.merchant === 'amazon') baseBody.merchant = 'Amazon';
  if (opts.minRating && opts.minRating > 0) baseBody.minReviewsRating = opts.minRating;

  // Se categorie specificate: cerca ogni keyword × ogni categoria
  const indexes = opts.searchIndexes?.length ? opts.searchIndexes : [''];

  const seen = new Set<string>();
  const allProducts: DealProduct[] = [];

  const tasks = brandKeywords.flatMap(kw =>
    indexes.map(idx => () =>
      searchOne(token, marketplaceDomain, { ...baseBody, keywords: kw, ...(idx ? { searchIndex: idx } : {}) })
        .then(r => ({ items: r.products, kw, idx }))
        .catch(() => ({ items: [] as any[], kw, idx }))
    )
  );

  const results = await batchAll(tasks, 2, 600);

  for (const { items, kw, idx } of results) {
    for (const item of items) {
      const p = parseItem(item, currency, marketplaceDomain, affiliateTag, idx || '', kw);
      if (p && p.discountPercent >= 1 && !seen.has(p.productId)) {
        seen.add(p.productId);
        allProducts.push(p);
      }
    }
  }

  console.log(`[brand-search] ${brandKeywords.length} keyword × ${indexes.length} categorie → ${allProducts.length} prodotti`);
  return allProducts;
}
