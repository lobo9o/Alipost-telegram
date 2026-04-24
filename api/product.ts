import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withErrorHandler, allowMethods } from './_utils.js';
import sql from '../lib/db.js';

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
    resources: ['itemInfo.title', 'images.primary.large', 'offersV2.listings.price'],
  };

  const apiUrl = 'https://creatorsapi.amazon/getItems';

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'x-marketplace': marketplaceDomain,
      'Authorization': authHeader,
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await res.text();
  // Unica riga finale — visibile senza espandere i log Vercel
  const isCognitoVer = version.startsWith('2');
  console.log('[product] SUMMARY', JSON.stringify({
    asin, tag: partnerTag.slice(0, 30), ver: version, mkt: marketplaceDomain,
    scope: isCognitoVer ? 'creatorsapi/default' : 'creatorsapi/default',
    tok: token.slice(0, 30), status: res.status, resp: responseText.slice(0, 200),
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
  const m = url.match(/\/item\/(\d+)\.html/) ?? url.match(/[?&]productId=(\d+)/);
  return m ? m[1] : null;
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

  const { platform, url, asin } = req.body ?? {};
  if (!platform || !url) { res.status(400).json({ error: 'platform e url sono richiesti' }); return; }

  const [settingsRow] = await sql`SELECT data FROM settings WHERE id = 1`;
  const rawData = settingsRow?.data ?? {};
  const cfg = (typeof rawData === 'string' ? JSON.parse(rawData) : rawData) as Record<string, any>;
  console.log('[product] cfg.amazon:', JSON.stringify(cfg.amazon));

  if (platform === 'amazon') {
    const resolvedAsin = (asin ?? extractAsin(url) ?? '').toUpperCase();
    if (!resolvedAsin) { res.status(400).json({ error: 'Impossibile estrarre ASIN dal link' }); return; }

    const credentialId     = cfg.amazon?.credentialId     ?? process.env.AMAZON_CREDENTIAL_ID     ?? '';
    const credentialSecret = cfg.amazon?.credentialSecret ?? process.env.AMAZON_CREDENTIAL_SECRET ?? '';
    const partnerTag       = cfg.amazon?.affiliateTag     ?? process.env.AMAZON_AFFILIATE_TAG     ?? '';
    const version          = cfg.amazon?.version          ?? process.env.AMAZON_VERSION           ?? '2.2';
    const marketplaceCode  = (cfg.amazon?.marketplace     ?? process.env.AMAZON_MARKETPLACE       ?? 'IT').toUpperCase();
    const marketplaceDomain = MARKETPLACE_DOMAINS[marketplaceCode] ?? 'www.amazon.it';

    if (!credentialId || !credentialSecret || !partnerTag) {
      res.status(400).json({ error: 'Credenziali Amazon Creators API non configurate. Vai in Impostazioni e inserisci Credential ID, Credential Secret e Partner Tag.' });
      return;
    }

    const data = await creatorsGetItem(resolvedAsin, credentialId, credentialSecret, partnerTag, version, marketplaceDomain) as any;

    // Supporto risposta camelCase e PascalCase
    const itemsResult = pick(data, 'itemsResult', 'ItemsResult') as any;
    const items = pick(itemsResult, 'items', 'Items') as any[];
    const item = items?.[0];
    if (!item) { res.status(404).json({ error: 'Prodotto non trovato nella risposta Creators API' }); return; }

    const titleObj   = pick(pick(pick(item, 'itemInfo', 'ItemInfo'), 'title', 'Title'), 'displayValue', 'DisplayValue');
    const imageUrl   = pick(pick(pick(pick(item, 'images', 'Images'), 'primary', 'Primary'), 'large', 'Large'), 'url', 'URL');
    // Creators API usa offersV2 (non offers/Offers come PA-API)
    const listings   = (pick(pick(item, 'offersV2', 'offers', 'Offers'), 'listings', 'Listings') as any[])?.[0];
    const priceAmt   = pick(pick(listings, 'price', 'Price'), 'amount', 'Amount') as number ?? 0;
    const originalPrice   = priceAmt;
    const discountedPrice = priceAmt;
    const discountPercent = originalPrice > discountedPrice
      ? Math.round((1 - discountedPrice / originalPrice) * 100) : 0;

    res.json({
      asin: resolvedAsin,
      title: titleObj ?? '',
      image: imageUrl ?? '',
      originalPrice,
      discountedPrice,
      discountPercent,
      affiliateUrl: `https://${marketplaceDomain}/dp/${resolvedAsin}?tag=${partnerTag}`,
    });

  } else if (platform === 'aliexpress') {
    const productId = extractAliId(url);
    if (!productId) { res.status(400).json({ error: 'Impossibile estrarre product ID dal link AliExpress' }); return; }

    const trackingId = cfg.aliexpress?.trackingId ?? process.env.ALIEXPRESS_TRACKING_ID ?? '';

    res.json({
      productId,
      title: `Prodotto AliExpress #${productId}`,
      image: '',
      originalPrice: 0,
      discountedPrice: 0,
      discountPercent: 0,
      affiliateUrl: `https://s.click.aliexpress.com/e/_link?productId=${productId}&trackingId=${trackingId}`,
    });

  } else {
    res.status(400).json({ error: 'platform deve essere amazon o aliexpress' });
  }
});
