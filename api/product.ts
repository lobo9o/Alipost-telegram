import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withErrorHandler, allowMethods, requireUserId } from './_utils.js';
import sql from '../lib/db.js';
import crypto from 'crypto';

// Token endpoints per versione credenziale
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

async function getToken(credentialId: string, credentialSecret: string, version: string): Promise<string> {
  const tokenUrl = TOKEN_ENDPOINTS[version];
  if (!tokenUrl) throw new Error(`Versione credenziale non supportata: ${version}`);

  const isCognito = version.startsWith('2');
  let res: Response;

  if (isCognito) {
    const basic = Buffer.from(`${credentialId}:${credentialSecret}`).toString('base64');
    res = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basic}`,
      },
      body: 'grant_type=client_credentials&scope=creatorsapi%2Fdefault',
    });
  } else {
    // LWA (v3.x) — Amazon Creators API usa JSON body con scope ::
    res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: credentialId,
        client_secret: credentialSecret,
        scope: 'creatorsapi::default',
      }),
    });
  }

  const tokenText = await res.text();
  console.log(`[product] token ${res.status}:`, tokenText.slice(0, 120));
  if (!res.ok) throw new Error(`Errore token Amazon (${res.status}): ${tokenText}`);
  const data = JSON.parse(tokenText) as { access_token: string };
  return data.access_token;
}

async function creatorsGetItem(
  asin: string,
  credentialId: string,
  credentialSecret: string,
  partnerTag: string,
  version: string,
  marketplaceDomain: string,
): Promise<unknown> {
  const token = await getToken(credentialId, credentialSecret, version);
  const authHeader = `Bearer ${token}`;

  const requestBody = {
    itemIds: [asin],
    partnerTag: partnerTag,
    partnerType: 'associates',
    resources: [
      'itemInfo.title',
      'images.primary.large',
      'offersV2.listings.price',
      'customerReviews.starRating',
      'customerReviews.count',
      'itemInfo.byLineInfo',
      'browseNodeInfo.browseNodes',
      'offersV2.listings.dealDetails',
    ],
  };

  const apiUrl = 'https://creatorsapi.amazon/catalog/v1/getItems';

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
      'x-marketplace': marketplaceDomain,
      'User-Agent': 'creatorsapi-nodejs-sdk/1.2.0',
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await res.text();
  console.log('[product] SUMMARY', JSON.stringify({
    asin, tag: partnerTag.slice(0, 30), ver: version, mkt: marketplaceDomain,
    tok: token.slice(0, 20), status: res.status, resp: responseText.slice(0, 200),
  }));

  if (!res.ok) {
    throw new Error(`Creators API (${res.status}): ${responseText}`);
  }
  return JSON.parse(responseText);
}

function extractAsin(url: string): string | null {
  for (const p of [/\/dp\/([A-Z0-9]{10})/i, /\/gp\/product\/([A-Z0-9]{10})/i, /\/ASIN\/([A-Z0-9]{10})/i, /[?&]asin=([A-Z0-9]{10})/i]) {
    const m = url.match(p);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

function extractAliId(url: string): string | null {
  // /item/Nome-Prodotto-1234567890.html  oppure  /item/1234567890.html
  let m = url.match(/\/item\/(?:[\w%-]*?[-_])?(\d{6,})(?:\.html|[?#&]|$)/i);
  if (m) return m[1];
  // /i/1234567890.html  (formato breve)
  m = url.match(/\/i\/(\d{6,})(?:\.html|[?#&]|$)/i);
  if (m) return m[1];
  // ?productId=xxx  o  &product_id=xxx
  m = url.match(/[?&](?:productId|product_id)=(\d+)/i);
  if (m) return m[1];
  // ultimo tentativo: qualsiasi sequenza di 10+ cifre nell'URL
  m = url.match(/\b(\d{10,})\b/);
  if (m) return m[1];
  return null;
}

async function resolveAliUrl(url: string): Promise<string> {
  if (!/s\.click\.aliexpress|a\.aliexpress\.com|ali\.ski|aliexpress\.page\.link/i.test(url)) return url;
  try {
    // GET con redirect:follow — r.url è l'URL finale dopo tutti i redirect, il body non viene letto
    const r = await fetch(url, { redirect: 'follow' });
    const final = r.url || url;
    console.log('[ali] redirect', url.slice(0, 60), '→', final.slice(0, 100));
    return final;
  } catch (e) {
    console.warn('[ali] resolveAliUrl failed:', e);
    return url;
  }
}

// ── AliExpress API helpers ────────────────────────────────────────────────────

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

async function aliCall(method: string, appKey: string, appSecret: string, extra: Record<string, string>): Promise<unknown> {
  const params: Record<string, string> = {
    app_key: appKey.trim(),
    method,
    sign_method: 'md5',
    timestamp: aliTimestamp(),
    v: '2.0',
    ...extra,
  };
  params.sign = aliSign(params, appSecret.trim());

  const body = new URLSearchParams(params).toString();
  const res = await fetch('https://api-sg.aliexpress.com/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body,
  });
  const text = await res.text();
  console.log(`[ali] ${method} ${res.status}:`, text.slice(0, 300));
  if (!res.ok) throw new Error(`AliExpress API HTTP ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  // Errore di autenticazione o parametro restituito al livello radice
  if (json.error_response) {
    const e = json.error_response;
    throw new Error(`AliExpress [${e.code}]: ${e.msg}`);
  }
  return json;
}

async function aliGetProductDetail(productId: string, appKey: string, appSecret: string, trackingId: string, country: string) {
  const { currency, language } = ALI_COUNTRY_MAP[country.toUpperCase()] ?? { currency: 'EUR', language: 'IT' };
  const data = await aliCall('aliexpress.affiliate.productdetail.get', appKey, appSecret, {
    product_ids: productId,
    target_currency: currency,
    target_language: language,
    tracking_id: trackingId,
    fields: 'product_id,product_title,product_main_image_url,target_sale_price,target_original_price,target_sale_price_currency,discount,shop_id',
  }) as any;

  const resp = data?.aliexpress_affiliate_productdetail_get_response?.resp_result;
  if (!resp || resp.resp_code !== 200) {
    throw new Error(`AliExpress prodotto [${resp?.resp_code ?? '?'}]: ${resp?.resp_msg ?? JSON.stringify(data).slice(0, 200)}`);
  }
  const product = resp?.result?.products?.product?.[0];
  if (!product) throw new Error('Prodotto non trovato su AliExpress (ID: ' + productId + ')');
  return product;
}

async function aliGetAffiliateLink(productUrl: string, appKey: string, appSecret: string, trackingId: string): Promise<string> {
  const data = await aliCall('aliexpress.affiliate.link.generate', appKey, appSecret, {
    promotion_link_type: '0',
    source_values: productUrl,
    tracking_id: trackingId,
  }) as any;

  const resp = data?.aliexpress_affiliate_link_generate_response?.resp_result;
  if (!resp || resp.resp_code !== 200) {
    throw new Error(`AliExpress link [${resp?.resp_code ?? '?'}]: ${resp?.resp_msg ?? JSON.stringify(data).slice(0, 200)}`);
  }
  const link = resp?.result?.promotion_links?.promotion_link?.[0]?.promotion_link;
  if (!link) throw new Error('Link affiliato non restituito dall\'API (verifica Tracking ID)');
  return link;
}

// Legge un campo sia in camelCase che PascalCase dalla risposta
function pick(obj: unknown, ...keys: string[]): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    if (o[k] !== undefined) return o[k];
  }
  return undefined;
}

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['POST'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;

  const { platform, url, asin } = req.body ?? {};
  if (!platform || !url) { res.status(400).json({ error: 'platform e url sono richiesti' }); return; }

  const [settingsRow] = await sql`SELECT data FROM settings WHERE user_id = ${userId}`;
  const rawData = settingsRow?.data ?? {};
  const cfg = (typeof rawData === 'string' ? JSON.parse(rawData) : rawData) as Record<string, any>;
  console.log('[product] cfg.amazon version:', cfg.amazon?.version, 'marketplace:', cfg.amazon?.marketplace);

  if (platform === 'amazon') {
    const resolvedAsin = (asin ?? extractAsin(url) ?? '').toUpperCase();
    if (!resolvedAsin) { res.status(400).json({ error: 'Impossibile estrarre ASIN dal link' }); return; }

    const userHasCreds = !!(cfg.amazon?.credentialId && cfg.amazon?.credentialSecret);
    const credentialId     = cfg.amazon?.credentialId     || process.env.AMAZON_CREDENTIAL_ID     || '';
    const credentialSecret = cfg.amazon?.credentialSecret || process.env.AMAZON_CREDENTIAL_SECRET || '';

    // apiTag: deve corrispondere all'account delle credenziali usate
    const apiTag = userHasCreds
      ? (cfg.amazon?.affiliateTag || '')
      : (process.env.AMAZON_AFFILIATE_TAG || '');

    // affiliateTag: tag nel link del post — sempre quello dell'utente se disponibile
    const affiliateTag = cfg.amazon?.affiliateTag || process.env.AMAZON_AFFILIATE_TAG || '';

    const version = userHasCreds
      ? (cfg.amazon?.version      || process.env.AMAZON_VERSION      || '2.2')
      : (process.env.AMAZON_VERSION                                  || '2.2');
    const marketplaceCode = userHasCreds
      ? ((cfg.amazon?.marketplace || process.env.AMAZON_MARKETPLACE  || 'IT').toUpperCase())
      : ((process.env.AMAZON_MARKETPLACE                             || 'IT').toUpperCase());
    const marketplaceDomain = MARKETPLACE_DOMAINS[marketplaceCode] ?? 'www.amazon.it';

    console.log('[product] creds:', userHasCreds ? 'user' : 'env', '| apiTag:', apiTag.slice(0, 20), '| affiliateTag:', affiliateTag.slice(0, 20));

    if (!credentialId || !credentialSecret || !apiTag) {
      res.status(400).json({ error: userHasCreds
        ? 'Credenziali Amazon non complete. Inserisci Credential ID, Credential Secret e Partner Tag in Impostazioni.'
        : 'Credenziali Amazon di sistema non configurate. Contatta l\'amministratore.'
      });
      return;
    }

    if (!affiliateTag) {
      res.status(400).json({ error: 'Inserisci il tuo Partner Tag (tag affiliato) in Impostazioni → Amazon.' });
      return;
    }

    const data = await creatorsGetItem(resolvedAsin, credentialId, credentialSecret, apiTag, version, marketplaceDomain) as any;

    // Supporto risposta camelCase e PascalCase
    const itemsResult = pick(data, 'itemsResult', 'ItemsResult') as any;
    const items = pick(itemsResult, 'items', 'Items') as any[];
    const item = items?.[0];
    if (!item) { res.status(404).json({ error: 'Prodotto non trovato nella risposta Creators API' }); return; }

    const titleObj   = pick(pick(pick(item, 'itemInfo', 'ItemInfo'), 'title', 'Title'), 'displayValue', 'DisplayValue');
    const imageUrl   = pick(pick(pick(pick(item, 'images', 'Images'), 'primary', 'Primary'), 'large', 'Large'), 'url', 'URL');
    const listings       = (pick(pick(item, 'offersV2'), 'listings') as any[])?.[0];
    const priceObj       = pick(listings, 'price') as any;
    const discountedPrice = (pick(pick(priceObj, 'money'), 'amount') as number) ?? 0;
    const savingBasisAmt  = (pick(pick(pick(priceObj, 'savingBasis'), 'money'), 'amount') as number) ?? 0;
    const savingsPct      = (pick(pick(priceObj, 'savings'), 'percentage') as number) ?? 0;
    const originalPrice   = savingBasisAmt > 0 ? savingBasisAmt : discountedPrice;
    const discountPercent = savingsPct > 0
      ? Math.round(savingsPct)
      : originalPrice > discountedPrice
        ? Math.round((1 - discountedPrice / originalPrice) * 100) : 0;

    // Dati extra (resiliente: non fallisce se non presenti)
    const reviews = pick(data, 'customerReviews', 'CustomerReviews') as any;
    const stelle = reviews ? String(pick(reviews, 'starRating', 'StarRating') ?? '') : '';
    const recensioni = reviews ? String(pick(reviews, 'count', 'Count') ?? '') : '';

    const byLine = pick(pick(item, 'itemInfo', 'ItemInfo'), 'byLineInfo', 'ByLineInfo') as any;
    const contributors = pick(byLine, 'contributors', 'Contributors') as any[] ?? [];
    const author = contributors?.[0] ? String(pick(contributors[0], 'name', 'Name') ?? '') : '';

    const browseNodes = (pick(pick(item, 'browseNodeInfo', 'BrowseNodeInfo'), 'browseNodes', 'BrowseNodes') as any[]) ?? [];
    const cat = browseNodes?.[0] ? String(pick(browseNodes[0], 'displayName', 'DisplayName') ?? '') : '';

    const dealDetails = pick(listings, 'dealDetails', 'DealDetails') as any;
    let coupon = '';
    if (dealDetails) {
      const dealType = String(pick(dealDetails, 'dealType', 'DealType') ?? '').toLowerCase();
      const displayAmount = String(pick(dealDetails, 'displayAmount', 'DisplayAmount', 'amount', 'Amount') ?? '');
      const displayPerc = String(pick(dealDetails, 'displayPercentage', 'DisplayPercentage', 'percentage', 'Percentage') ?? '');
      if (dealType.includes('coupon') || dealType.includes('clip')) {
        coupon = displayAmount || displayPerc || 'coupon';
      } else if (displayAmount || displayPerc) {
        coupon = displayAmount || displayPerc;
      }
      console.log('[product] dealDetails:', JSON.stringify(dealDetails).slice(0, 200));
    }

    res.json({
      asin: resolvedAsin,
      title: titleObj ?? '',
      image: imageUrl ?? '',
      originalPrice,
      discountedPrice,
      discountPercent,
      affiliateUrl: `https://${marketplaceDomain}/dp/${resolvedAsin}?tag=${affiliateTag}`,
      stelle: stelle || undefined,
      recensioni: recensioni || undefined,
      author: author || undefined,
      cat: cat || undefined,
      coupon: coupon || undefined,
    });

  } else if (platform === 'aliexpress') {
    const resolvedUrl = await resolveAliUrl(url);
    const productId = extractAliId(resolvedUrl);
    if (!productId) { res.status(400).json({ error: `Impossibile estrarre product ID dal link AliExpress. URL ricevuto: ${url.slice(0, 80)}` }); return; }

    const appKey     = cfg.aliexpress?.appKey     || process.env.ALIEXPRESS_APP_KEY     || '';
    const appSecret  = cfg.aliexpress?.appSecret  || process.env.ALIEXPRESS_APP_SECRET  || '';
    const trackingId = cfg.aliexpress?.trackingId || process.env.ALIEXPRESS_TRACKING_ID || '';
    const country    = cfg.aliexpress?.targetCountry || process.env.ALIEXPRESS_COUNTRY   || 'IT';

    if (!appKey || !appSecret) {
      res.status(400).json({ error: 'Credenziali AliExpress non configurate. Vai in Impostazioni → AliExpress e inserisci App Key e App Secret.' });
      return;
    }
    if (!trackingId) {
      res.status(400).json({ error: 'Inserisci il Tracking ID AliExpress in Impostazioni → AliExpress.' });
      return;
    }

    const productUrl = `https://www.aliexpress.com/item/${productId}.html`;
    console.log('[ali] productId:', productId, '| url:', productUrl);

    const product = await aliGetProductDetail(productId, appKey, appSecret, trackingId, country);
    const affiliateUrl = await aliGetAffiliateLink(productUrl, appKey, appSecret, trackingId);

    const salePrice = parseFloat(String(product.target_sale_price ?? 0)) || 0;
    const origPrice = parseFloat(String(product.target_original_price ?? 0)) || 0;
    const discountStr = String(product.discount ?? '').replace('%', '');
    const discountPercent = parseInt(discountStr) || (origPrice > salePrice ? Math.round((1 - salePrice / origPrice) * 100) : 0);

    res.json({
      productId,
      title: product.product_title ?? '',
      image: product.product_main_image_url ?? '',
      originalPrice: origPrice || salePrice,
      discountedPrice: salePrice,
      discountPercent,
      affiliateUrl,
    });

  } else {
    res.status(400).json({ error: 'platform deve essere amazon o aliexpress' });
  }
});
