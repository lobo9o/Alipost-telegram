import crypto from 'crypto';

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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function getAmazonToken(credentialId: string, credentialSecret: string, version: string): Promise<string> {
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
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: credentialId, client_secret: credentialSecret, scope: 'creatorsapi::default' }).toString(),
    });
  }
  if (!res.ok) throw new Error(`Token Amazon (${res.status})`);
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

async function fetchAmazonPrice(asin: string, credentialId: string, credentialSecret: string, partnerTag: string, version: string, marketplaceCode: string): Promise<number | null> {
  const domain = MARKETPLACE_DOMAINS[marketplaceCode] ?? 'www.amazon.it';
  const token = await getAmazonToken(credentialId, credentialSecret, version);
  const res = await fetch('https://creatorsapi.amazon/catalog/v1/getItems', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'x-marketplace': domain, 'User-Agent': 'creatorsapi-nodejs-sdk/1.2.0' },
    body: JSON.stringify({ itemIds: [asin], partnerTag, partnerType: 'associates', resources: ['offersV2.listings.price'] }),
  });
  if (!res.ok) return null;
  const data = await res.json() as any;
  const items = (data?.itemsResult?.items ?? data?.ItemsResult?.Items) as any[];
  const listings = items?.[0]?.offersV2?.listings;
  const price = listings?.[0]?.price?.money?.amount;
  return price != null ? Number(price) : null;
}

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

async function fetchAliPrice(productId: string, appKey: string, appSecret: string, trackingId: string, country: string): Promise<number | null> {
  const currencyMap: Record<string, string> = { IT: 'EUR', US: 'USD', DE: 'EUR', FR: 'EUR', ES: 'EUR', UK: 'GBP' };
  const currency = currencyMap[country.toUpperCase()] ?? 'EUR';
  const params: Record<string, string> = {
    app_key: appKey.trim(), method: 'aliexpress.affiliate.productdetail.get',
    sign_method: 'md5', timestamp: aliTimestamp(), v: '2.0',
    product_ids: productId, target_currency: currency, target_language: 'IT',
    tracking_id: trackingId, fields: 'product_id,target_sale_price',
  };
  params.sign = aliSign(params, appSecret.trim());
  const res = await fetch('https://api-sg.aliexpress.com/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) return null;
  const json = await res.json() as any;
  if (json.error_response) return null;
  const product = json?.aliexpress_affiliate_productdetail_get_response?.resp_result?.result?.products?.product?.[0];
  if (!product) return null;
  return parseFloat(String(product.target_sale_price ?? 0)) || null;
}

export interface PriceCheckResult {
  valid: boolean;
  reason?: string;
  currentPrice?: number;
}

// Soglia: se il prezzo attuale supera il prezzo scontato di più dell'8%, l'offerta è scaduta
// (8% copre offerte dal ~7% di sconto in su; 15% era troppo permissivo per sconti piccoli)
const PRICE_TOLERANCE = 0.08;

export async function checkPostPrice(
  post: Record<string, any>,
  cfg: Record<string, any>,
): Promise<PriceCheckResult> {
  const storedPrice = Number(post.discountedPrice);
  if (!storedPrice) return { valid: false, reason: 'Prezzo non disponibile (0)' };

  try {
    let currentPrice: number | null = null;

    if (post.platform === 'amazon' && post.productId) {
      const userHasCreds = !!(cfg.amazon?.credentialId && cfg.amazon?.credentialSecret);
      const credentialId     = cfg.amazon?.credentialId     || process.env.AMAZON_CREDENTIAL_ID     || '';
      const credentialSecret = cfg.amazon?.credentialSecret || process.env.AMAZON_CREDENTIAL_SECRET || '';
      const apiTag           = userHasCreds ? (cfg.amazon?.affiliateTag || '') : (process.env.AMAZON_AFFILIATE_TAG || '');
      const version          = cfg.amazon?.version          || process.env.AMAZON_VERSION            || '2.2';
      const marketplaceCode  = (cfg.amazon?.marketplace     || process.env.AMAZON_MARKETPLACE        || 'IT').toUpperCase();

      if (!credentialId || !credentialSecret || !apiTag) return { valid: true };

      currentPrice = await withTimeout(
        fetchAmazonPrice(post.productId, credentialId, credentialSecret, apiTag, version, marketplaceCode),
        10_000,
      );

    } else if (post.platform === 'aliexpress' && post.productId) {
      const appKey     = cfg.aliexpress?.appKey     || process.env.ALIEXPRESS_APP_KEY     || '';
      const appSecret  = cfg.aliexpress?.appSecret  || process.env.ALIEXPRESS_APP_SECRET  || '';
      const trackingId = cfg.aliexpress?.trackingId || process.env.ALIEXPRESS_TRACKING_ID || '';
      const country    = cfg.aliexpress?.targetCountry || process.env.ALIEXPRESS_COUNTRY   || 'IT';

      if (!appKey || !appSecret || !trackingId) return { valid: true };

      currentPrice = await withTimeout(
        fetchAliPrice(post.productId, appKey, appSecret, trackingId, country),
        10_000,
      );
    }

    if (currentPrice === null) {
      // API non ha restituito prezzo → scrape pagina per verificare disponibilità e prezzo
      if (post.platform === 'amazon' && post.productId) {
        const mktCode = (cfg.amazon?.marketplace || 'IT').toUpperCase();
        const domain = MARKETPLACE_DOMAINS[mktCode] ?? 'www.amazon.it';
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 8000);
          const r = await fetch(`https://${domain}/dp/${post.productId}`, {
            signal: ctrl.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Accept-Language': 'it-IT,it;q=0.9' },
          });
          clearTimeout(t);
          if (r.ok) {
            const html = await r.text();
            const unavailable = /attualmente non disponibile|currently unavailable|non è disponibile|temporaneamente esaurito/i.test(html);
            const hasPrice = /class="a-price-whole"|"priceAmount"|id="priceblock_ourprice"|id="priceblock_dealprice"/i.test(html);
            if (unavailable || !hasPrice) {
              return { valid: false, reason: 'Prodotto non più disponibile (scrape)' };
            }
            // Estrai prezzo corrente dalla pagina e confronta con quello salvato
            const parsePx = (s: string) => parseFloat(s.replace(/[^\d,.]/g, '').replace(',', '.')) || 0;
            let scraped = 0;
            const offscreen = [...html.matchAll(/class="a-offscreen">([^<]+)</g)];
            if (offscreen[0]) scraped = parsePx(offscreen[0][1]);
            if (!scraped) {
              const ldM = html.match(/"@type"\s*:\s*"Offer"[^}]*?"price"\s*:\s*"?([\d]+(?:[.,][\d]+)?)"?/);
              if (ldM) scraped = parsePx(ldM[1]);
            }
            if (!scraped) {
              const cpM = html.match(/"priceAmount"\s*:\s*([\d]+(?:\.\d+)?)/);
              if (cpM) scraped = parseFloat(cpM[1]) || 0;
            }
            if (scraped > 0) {
              currentPrice = scraped;
            }
          }
        } catch { /* ignora — fallisce silenziosamente */ }
      }
      if (currentPrice === null) return { valid: true }; // impossibile verificare → considera valido
    }

    const increase = (currentPrice - storedPrice) / storedPrice;
    if (increase > PRICE_TOLERANCE) {
      return {
        valid: false,
        reason: `Prezzo salito da ${storedPrice.toFixed(2)} a ${currentPrice.toFixed(2)} (+${Math.round(increase * 100)}%)`,
        currentPrice,
      };
    }

    return { valid: true, currentPrice };

  } catch (e) {
    // Timeout o errore API → pubblica comunque (fail open)
    console.warn('[priceCheck] errore, skip check:', e instanceof Error ? e.message : e);
    return { valid: true };
  }
}
