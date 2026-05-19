import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';
import sql from '../../lib/db.js';
import crypto from 'crypto';

const ALI_COUNTRY_MAP: Record<string, { currency: string; language: string }> = {
  IT: { currency: 'EUR', language: 'IT' },
  US: { currency: 'USD', language: 'EN' },
  DE: { currency: 'EUR', language: 'DE' },
  FR: { currency: 'EUR', language: 'FR' },
  ES: { currency: 'EUR', language: 'ES' },
  UK: { currency: 'GBP', language: 'EN' },
  RU: { currency: 'RUB', language: 'RU' },
  BR: { currency: 'BRL', language: 'PT' },
  PL: { currency: 'PLN', language: 'PL' },
  NL: { currency: 'EUR', language: 'NL' },
};

function aliSign(params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params).sort();
  const str = secret + sorted.map(k => `${k}${params[k]}`).join('') + secret;
  return crypto.createHash('md5').update(str, 'utf8').digest('hex').toUpperCase();
}

function aliTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

// Quante parole chiave (>1 carattere) compaiono nel titolo (0.0 – 1.0)
function titleScore(title: string, term: string): number {
  if (!term) return 1;
  const words = term.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  if (!words.length) return 1;
  const t = title.toLowerCase();
  const matched = words.filter(w => t.includes(w)).length;
  return matched / words.length;
}

// Soglia minima: almeno il 60% delle parole deve comparire nel titolo
function scoreThreshold(term: string): number {
  const words = term.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  if (!words.length) return 0;
  return Math.ceil(words.length * 0.6) / words.length;
}

// Un prodotto passa il filtro se corrisp. a ALMENO UN termine del gruppo |
function passesTitleFilter(title: string, terms: string[]): boolean {
  if (!terms.length) return true;
  return terms.some(t => titleScore(title, t) >= scoreThreshold(t));
}

// Miglior score tra tutti i termini (usato per il ranking)
function bestTitleScore(title: string, terms: string[]): number {
  if (!terms.length) return 1;
  return Math.max(...terms.map(t => titleScore(title, t)));
}

async function queryAli(
  appKey: string,
  appSecret: string,
  baseParams: Record<string, string>,
  keyword: string,
  page: number,
): Promise<{ products: any[]; total: number }> {
  const params: Record<string, string> = {
    app_key: appKey.trim(),
    method: 'aliexpress.affiliate.product.query',
    sign_method: 'md5',
    timestamp: aliTimestamp(),
    v: '2.0',
    ...baseParams,
    page_no: String(page),
  };
  if (keyword) params.keywords = keyword;
  params.sign = aliSign(params, appSecret.trim());

  const apiRes = await fetch('https://api-sg.aliexpress.com/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(params).toString(),
  });
  const text = await apiRes.text();
  console.log(`[deals] "${keyword.slice(0, 30)}" → ${apiRes.status} ${text.slice(0, 150)}`);

  if (!apiRes.ok) return { products: [], total: 0 };
  const json = JSON.parse(text) as any;
  if (json.error_response) {
    console.warn('[deals] error_response:', json.error_response.msg);
    return { products: [], total: 0 };
  }
  const resp = json?.aliexpress_affiliate_product_query_response?.resp_result;
  if (!resp || resp.resp_code !== 200) return { products: [], total: 0 };
  return {
    products: resp?.result?.products?.product ?? [],
    total:    resp?.result?.total_record_count ?? 0,
  };
}

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;

  const [settingsRow] = await sql`SELECT data FROM settings WHERE user_id = ${userId}`;
  const rawData = settingsRow?.data ?? {};
  const cfg = (typeof rawData === 'string' ? JSON.parse(rawData) : rawData) as Record<string, any>;

  const appKey    = cfg.aliexpress?.appKey     || process.env.ALIEXPRESS_APP_KEY     || '';
  const appSecret = cfg.aliexpress?.appSecret  || process.env.ALIEXPRESS_APP_SECRET  || '';
  const trackId   = cfg.aliexpress?.trackingId || process.env.ALIEXPRESS_TRACKING_ID || '';
  const country   = cfg.aliexpress?.targetCountry || process.env.ALIEXPRESS_COUNTRY  || 'IT';

  if (!appKey || !appSecret) {
    res.status(400).json({ error: 'Credenziali AliExpress non configurate. Vai in Impostazioni → AliExpress.' });
    return;
  }

  const q          = req.query as Record<string, string>;
  const kwRaw      = (q.keywords ?? '').trim();
  const minDiscount = parseInt(q.minDiscount  ?? '0') || 0;
  const minPrice    = parseFloat(q.minPrice   ?? '0') || 0;
  const maxPrice    = parseFloat(q.maxPrice   ?? '0') || 0;
  const sortReq     = q.sort || 'DEFAULT_SORT';
  // RATING_DESC è gestito lato server; per l'API usiamo LAST_VOLUME_DESC (più venduti)
  const apiSort     = sortReq === 'RATING_DESC' ? 'LAST_VOLUME_DESC' : sortReq;
  const deliveryDays = parseInt(q.deliveryDays ?? '0') || 0;
  const categoryIds  = (q.categoryIds ?? '').trim();
  const page         = Math.max(1, parseInt(q.page ?? '1') || 1);
  const minRating    = parseFloat(q.minRating ?? '0') || 0;

  // Supporto ricerche multiple: "cuffie | auricolari | headset"
  const terms = kwRaw.split('|').map(s => s.trim()).filter(Boolean);
  const isMulti = terms.length > 1;

  const { currency, language } = ALI_COUNTRY_MAP[country.toUpperCase()] ?? { currency: 'EUR', language: 'IT' };

  const base: Record<string, string> = {
    tracking_id:      trackId,
    target_currency:  currency,
    target_language:  language,
    ship_to_country:  country.toUpperCase(),
    sort:             apiSort,
    page_size:        '50',
    fields: [
      'product_id', 'product_title', 'product_main_image_url',
      'target_sale_price', 'target_original_price', 'target_sale_price_currency',
      'discount', 'evaluate_rate', 'second_level_category_name', 'promotion_link',
      'product_country',
    ].join(','),
  };
  if (categoryIds)      base.category_ids  = categoryIds;
  if (minPrice > 0)     base.min_sale_price = String(Math.round(minPrice * 100));
  if (maxPrice > 0)     base.max_sale_price = String(Math.round(maxPrice * 100));
  if (deliveryDays > 0) base.delivery_days  = String(deliveryDays);

  // ── Chiamate API ──────────────────────────────────────────────────────────
  let rawProducts: any[] = [];
  let apiTotal = 0;

  if (!terms.length) {
    // Nessuna keyword: ricerca generica
    const r = await queryAli(appKey, appSecret, base, '', page);
    rawProducts = r.products;
    apiTotal    = r.total;
  } else if (isMulti) {
    // Ricerche parallele per ogni termine, poi merge/dedup
    const results = await Promise.all(terms.map(t => queryAli(appKey, appSecret, base, t, 1)));
    const seen = new Set<string>();
    for (const r of results) {
      apiTotal += r.total;
      for (const p of r.products) {
        const pid = String(p.product_id);
        if (!seen.has(pid)) { seen.add(pid); rawProducts.push(p); }
      }
    }
  } else {
    // Singola keyword, con paginazione
    const r = await queryAli(appKey, appSecret, base, terms[0], page);
    rawProducts = r.products;
    apiTotal    = r.total;
  }

  // ── Mappa ─────────────────────────────────────────────────────────────────
  const withLink = rawProducts.filter((p: any) => !!p.promotion_link).length;
  if (rawProducts.length > 0 && withLink < rawProducts.length) {
    console.warn(`[deals] WARN: ${rawProducts.length - withLink}/${rawProducts.length} prodotti senza promotion_link (tracking_id "${trackId.slice(0, 8)}..." corretto?)`);
  }
  const mapped = rawProducts.map((p: any) => {
    const discPct   = parseInt(String(p.discount ?? '0').replace('%', '')) || 0;
    const ratingNum = parseFloat(String(p.evaluate_rate ?? '0').replace('%', '')) || 0;
    const productUrl = `https://www.aliexpress.com/item/${p.product_id}.html`;
    return {
      productId:       String(p.product_id),
      title:           String(p.product_title ?? ''),
      image:           String(p.product_main_image_url ?? ''),
      originalPrice:   parseFloat(p.target_original_price ?? '0') || 0,
      discountedPrice: parseFloat(p.target_sale_price ?? '0') || 0,
      discountPercent: discPct,
      currency:        String(p.target_sale_price_currency ?? currency),
      category:        String(p.second_level_category_name ?? ''),
      rating:          String(p.evaluate_rate ?? ''),
      ratingNum,
      url:             productUrl,
      affiliateUrl:    String(p.promotion_link || productUrl),
      shipFromCountry: String(p.product_country || '').toUpperCase() || undefined,
    };
  });

  // ── Filtri ────────────────────────────────────────────────────────────────
  let filtered = mapped
    .filter(p => p.discountPercent >= minDiscount)
    .filter(p => minRating <= 0 || p.ratingNum >= minRating)
    .filter(p => passesTitleFilter(p.title, terms));   // ← filtro rilevanza titolo

  // ── Scoring + ordinamento ─────────────────────────────────────────────────
  // Calcola il punteggio di rilevanza per ogni prodotto
  const scored = filtered.map(p => ({ ...p, _score: bestTitleScore(p.title, terms) }));

  if (sortReq === 'RATING_DESC') {
    scored.sort((a, b) => b.ratingNum - a.ratingNum);
  } else {
    // Porta in cima i prodotti con rilevanza significativamente più alta,
    // poi mantieni l'ordine dell'API per quelli con score simile
    scored.sort((a, b) => {
      const diff = b._score - a._score;
      if (diff > 0.2) return 1;
      if (diff < -0.2) return -1;
      return 0;
    });
  }

  // Rimuove i campi interni prima di inviare
  const response = scored.map(({ _score: _, ratingNum: __, ...rest }) => rest);
  const total = isMulti ? response.length : apiTotal;

  res.json({ products: response, total, page });
});
