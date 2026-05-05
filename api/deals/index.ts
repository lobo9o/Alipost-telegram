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

  const q = req.query as Record<string, string>;
  const keywords    = (q.keywords    ?? '').trim();
  const minDiscount = parseInt(q.minDiscount  ?? '0') || 0;
  const minPrice    = parseFloat(q.minPrice   ?? '0') || 0;
  const maxPrice    = parseFloat(q.maxPrice   ?? '0') || 0;
  const sortReq     = q.sort || 'DEFAULT_SORT';
  // RATING_DESC è gestito lato server (post-sort) — per l'API usiamo LAST_VOLUME_DESC
  const sort        = sortReq === 'RATING_DESC' ? 'LAST_VOLUME_DESC' : sortReq;
  const deliveryDays = parseInt(q.deliveryDays ?? '0') || 0;
  const categoryIds = (q.categoryIds ?? '').trim();
  const page        = Math.max(1, parseInt(q.page ?? '1') || 1);
  const minRating   = parseFloat(q.minRating ?? '0') || 0;

  const { currency, language } = ALI_COUNTRY_MAP[country.toUpperCase()] ?? { currency: 'EUR', language: 'IT' };

  const extra: Record<string, string> = {
    tracking_id: trackId,
    target_currency: currency,
    target_language: language,
    ship_to_country: country.toUpperCase(),
    sort,
    page_size: '50',
    page_no: String(page),
    fields: [
      'product_id', 'product_title', 'product_main_image_url',
      'target_sale_price', 'target_original_price', 'target_sale_price_currency',
      'discount', 'evaluate_rate', 'second_level_category_name',
      'promotion_link',
    ].join(','),
  };

  if (keywords)              extra.keywords       = keywords;
  if (categoryIds)           extra.category_ids   = categoryIds;
  if (minPrice > 0)          extra.min_sale_price = String(Math.round(minPrice * 100));
  if (maxPrice > 0)          extra.max_sale_price = String(Math.round(maxPrice * 100));
  if (deliveryDays > 0)      extra.delivery_days  = String(deliveryDays);

  const params: Record<string, string> = {
    app_key: appKey.trim(),
    method: 'aliexpress.affiliate.product.query',
    sign_method: 'md5',
    timestamp: aliTimestamp(),
    v: '2.0',
    ...extra,
  };
  params.sign = aliSign(params, appSecret.trim());

  const body = new URLSearchParams(params).toString();
  const apiRes = await fetch('https://api-sg.aliexpress.com/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body,
  });
  const text = await apiRes.text();
  console.log('[deals] product.query status:', apiRes.status, text.slice(0, 300));

  if (!apiRes.ok) {
    res.status(500).json({ error: `AliExpress API error (${apiRes.status})` });
    return;
  }

  const json = JSON.parse(text) as any;
  if (json.error_response) {
    const e = json.error_response;
    res.status(400).json({ error: `AliExpress [${e.code}]: ${e.msg}` });
    return;
  }

  const resp = json?.aliexpress_affiliate_product_query_response?.resp_result;
  if (!resp || resp.resp_code !== 200) {
    res.status(400).json({ error: `AliExpress [${resp?.resp_code ?? '?'}]: ${resp?.resp_msg ?? 'Errore sconosciuto'}` });
    return;
  }

  const products: any[] = resp?.result?.products?.product ?? [];
  const total: number   = resp?.result?.total_record_count ?? products.length;

  const mapped = products
    .map((p: any) => {
      const discPct  = parseInt(String(p.discount ?? '0').replace('%', '')) || 0;
      const ratingNum = parseFloat(String(p.evaluate_rate ?? '0').replace('%', '')) || 0;
      const productUrl = `https://www.aliexpress.com/item/${p.product_id}.html`;
      return {
        productId:       String(p.product_id),
        title:           p.product_title ?? '',
        image:           p.product_main_image_url ?? '',
        originalPrice:   parseFloat(p.target_original_price ?? '0') || 0,
        discountedPrice: parseFloat(p.target_sale_price ?? '0') || 0,
        discountPercent: discPct,
        currency:        p.target_sale_price_currency ?? currency,
        category:        p.second_level_category_name ?? '',
        rating:          p.evaluate_rate ?? '',
        ratingNum,
        url:             productUrl,
        affiliateUrl:    p.promotion_link || productUrl,
      };
    })
    .filter((p: any) => p.discountPercent >= minDiscount)
    .filter((p: any) => minRating <= 0 || p.ratingNum >= minRating);

  // Se l'utente ha chiesto "Valutazione ↓", ordina per rating decrescente nella pagina
  if (sortReq === 'RATING_DESC') {
    mapped.sort((a: any, b: any) => b.ratingNum - a.ratingNum);
  }

  res.json({ products: mapped, total, page });
});
