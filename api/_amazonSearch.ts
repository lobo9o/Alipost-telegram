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
  'samsung','apple','mulino bianco','philips','gillette','acer','lenovo','blink','nespresso',
  'bialetti','borbone',"kellogg's",'nescafé','kinder','peroni','misura','echo show','huawei',
  'msi','pavesi','adidas','echo dot','braun','sandisk','pringles','kimbo','nestlé','tuborg',
  "m&m's",'pan di stelle','aukey','pellini','honor','gran cereale','epson','lg','san carlo',
  'lavazza','nike',"jack daniel's",'wd','jbl','galbusera','starbucks','riso scotti','xiaomi',
  'fitbit','realme','fire tv','diadora','twinings','coca-cola','lipton','lindor','ferrero',
  'kitkat','benq','hp','perugina','poretti','panasonic','kingston','crucial','paco rabanne',
  'netac','amazfit','vergnano','chupa chups','bottega verde','calvin klein','tuc','microsoft',
  'collistar','lexar','toshiba','fila','remington','sony','motta','belkin','fire hd','wilkinson',
  "levi's",'diesel','hugo boss','nero giardini','laura biagiotti','bauli','snickers','dell',
  'hisense','puma','amazon','oneplus','oppo','nutella','fossil','canon','google','garnier',
  'nivea','logitech','tp-link','whirlpool','bosch','netgear','revlon','pantene','olaz','armani',
  'hoover','imetec',"de'longhi",'rowenta','vileda','durex','seagate','irobot','illy','kenwood',
  'sharp','geox','electrolux','ariete','veet','moulinex','spigen','candy','sennheiser',
  'indesit','haier','pedigree','razer','asus','bayer','aigostar','gucci','dior','anker',
  'eero','garmin','casio','dove','lacoste','vans','western digital','amuchina','cocolino',
  'dash','dixan','fairy','finish','haribo','lenor','lindt','loacker','motorola','nintendo',
  'corsair','ubisoft','steelseries','capcom','oreo','playstation','schwarzkopf','sodastream',
  'timberland','vanish','xbox','chicco','disney','barilla',"l'oréal paris",'maybelline',
  'morellato','oral-b','clementoni','kipling','colgate','brita','borotalco','de cecco',
  'doritos','milka','olay','lego','marvel','pokémon','ray-ban','reolink','roborock','scholl',
  'tena','gigabyte','govee','hasbro','hyperx','kodak','panini','converse','knorr','la molisana',
  'garofalo','head & shoulders','hotpoint','lagostina','tapo','alpro','airwick','bacardi',
  'cif','emporio armani','levoit','granarolo','tcl','konami','crocs','intex','superga','sonoff',
  'hugo','labello','jabra','varta','eufy','intel','amd','ugreen','aoc','cerave','under armour',
  'aperol','bandai','barbie','black+decker','renpho',"rubik's",'nzxt','logitech','pioneer',
  'trust','anker','swarovski','duracell','frontline','dreame','ecovacs','the north face',
  'versace','oral-b','ticwatch','nothing','asrock','cooler master','roborock','tineco',
  'thun','voiello','sacla','olimpia splendid','severin','cecotec','eureka','thermalright',
  'narwal','laica','sunsilk','tesori d\'oriente','vagisil','vidal','vivident','ciarra','dreo',
  'patriot memory','intex','equilibra','aeg','united colors of benetton','creative','mars gaming',
  'arctic','oversteel','sapphire','evga','powera','calgon','foppapedretti','protein works',
  'aperol','polti','swiffer','scottex','red bull','san benedetto','purina','whiskas',
  "l'oréal professionnel",'russel hobbs','cuisinart','merross','forno bonomi','bifinett',
  'baileys','boss','david jones','funk','maalox','quasar','tristar','lamborghini',
  'bellissima','der-franz','biffi','levoit','breil','electronic arts','sega','thq nordic',
  'namco','nacon','warner bros','ubisoft','activision','milestones','codemasters',
  'roblox','ring','bethesda','bonomelli','carrera','champion','chanteclair',
  'herbal essence','amaro montenegro','daniel wellington','grisbi','hasbro gaming','listerine',
  'absolut','astro gaming','baileys','bombay','cameo','gigabyte','hyperx','kodak',
  'roscenic','reolink','scholl','tennent\'s','tineco','converse','knorr','raid',
  'delicius','granbest','jaotto','la cafetiere','lydevo','v-tac','ultenic','versuni',
  'calvé','cif','cuisinart','emporio armani','granarolo','sonoff','hugo','ambi pur',
  'lines','tigullio','bistefani','ubena','comfee','jabra','be-total','goleador',
  'vigorsol','vitalcare','vivident','citrosodina','dreo','magic the gathering',
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
          itemIds: batch, partnerTag: affiliateTag, partnerType: 'associates',
          resources: SEARCH_RESOURCES,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!apiRes.ok) continue;
      const data = await apiRes.json() as any;
      const items = (data.itemsResult?.items ?? data.ItemsResult?.Items ?? []) as any[];
      results.push(...items);
    } catch {}
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
  const reviewRating = Number(pick(reviews, 'starRating', 'StarRating') ?? 0);
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
  opts: { merchant?: string; minRating?: number } = {},
): Promise<DealProduct[]> {
  const baseBody: Record<string, any> = {
    partnerTag: affiliateTag, partnerType: 'associates',
    resources: SEARCH_RESOURCES,
    minSavingPercent: 1,
    itemPage: 1,
  };
  if (opts.merchant === 'amazon') baseBody.merchant = 'Amazon';
  if (opts.minRating && opts.minRating > 0) baseBody.minReviewsRating = opts.minRating;

  const seen = new Set<string>();
  const allProducts: DealProduct[] = [];

  const tasks = brandKeywords.map(kw => () =>
    searchOne(token, marketplaceDomain, { ...baseBody, keywords: kw })
      .then(r => ({ items: r.products, kw }))
      .catch(() => ({ items: [] as any[], kw }))
  );

  const results = await batchAll(tasks, 2, 600);

  for (const { items, kw } of results) {
    for (const item of items) {
      const p = parseItem(item, currency, marketplaceDomain, affiliateTag, '', kw);
      if (p && p.discountPercent >= 1 && !seen.has(p.productId)) {
        seen.add(p.productId);
        allProducts.push(p);
      }
    }
  }

  console.log(`[brand-search] ${brandKeywords.length} keyword → ${allProducts.length} prodotti`);
  return allProducts;
}
