import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, createHash } from 'crypto';
import { withErrorHandler, allowMethods } from './_utils.js';
import sql from '../lib/db.js';

function sha256hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmacBuf(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

const MK: Record<string, { host: string; domain: string }> = {
  it: { host: 'webservices.amazon.it',    domain: 'www.amazon.it' },
  us: { host: 'webservices.amazon.com',   domain: 'www.amazon.com' },
  de: { host: 'webservices.amazon.de',    domain: 'www.amazon.de' },
  fr: { host: 'webservices.amazon.fr',    domain: 'www.amazon.fr' },
  es: { host: 'webservices.amazon.es',    domain: 'www.amazon.es' },
  uk: { host: 'webservices.amazon.co.uk', domain: 'www.amazon.co.uk' },
  jp: { host: 'webservices.amazon.co.jp', domain: 'www.amazon.co.jp' },
};

async function paApiGetItem(
  asin: string,
  accessKey: string,
  secretKey: string,
  partnerTag: string,
  marketplace: string,
) {
  const mk = MK[marketplace.toLowerCase()] ?? MK.it;
  const path = '/paapi5/getitems';
  const target = 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems';
  const region = 'us-east-1';
  const service = 'ProductAdvertisingAPI';

  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const body = JSON.stringify({
    ItemIds: [asin],
    Resources: ['Images.Primary.Large', 'Offers.Listings.Price', 'Offers.Listings.SavingBasis', 'ItemInfo.Title'],
    PartnerTag: partnerTag,
    PartnerType: 'Associates',
    Marketplace: mk.domain,
  });

  const payloadHash = sha256hex(body);

  const sortedHeaders: [string, string][] = [
    ['content-encoding', 'amz-1.0'],
    ['content-type', 'application/json; charset=utf-8'],
    ['host', mk.host],
    ['x-amz-date', amzDate],
    ['x-amz-target', target],
  ];

  const canonicalHeaders = sortedHeaders.map(([k, v]) => `${k}:${v}`).join('\n') + '\n';
  const signedHeaders = sortedHeaders.map(([k]) => k).join(';');
  const canonicalRequest = `POST\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256hex(canonicalRequest)}`;

  const kDate   = hmacBuf(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacBuf(kDate, region);
  const kSvc    = hmacBuf(kRegion, service);
  const kSign   = hmacBuf(kSvc, 'aws4_request');
  const sig     = hmacBuf(kSign, stringToSign).toString('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;

  const res = await fetch(`https://${mk.host}${path}`, {
    method: 'POST',
    headers: Object.fromEntries([...sortedHeaders, ['Authorization', authorization]]),
    body,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`PA-API ${res.status}: ${txt}`);
  }
  return res.json();
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

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['POST'], req, res)) return;

  const { platform, url, asin } = req.body ?? {};
  if (!platform || !url) { res.status(400).json({ error: 'platform and url required' }); return; }

  const [settingsRow] = await sql`SELECT data FROM settings WHERE id = 1`;
  const cfg = (settingsRow?.data ?? {}) as Record<string, any>;

  if (platform === 'amazon') {
    const resolvedAsin = (asin ?? extractAsin(url) ?? '').toUpperCase();
    if (!resolvedAsin) { res.status(400).json({ error: 'Could not extract ASIN' }); return; }

    const accessKey  = cfg.amazon?.accessKey   ?? process.env.AMAZON_ACCESS_KEY   ?? '';
    const secretKey  = cfg.amazon?.secretKey   ?? process.env.AMAZON_SECRET_KEY   ?? '';
    const partnerTag = cfg.amazon?.affiliateTag ?? process.env.AMAZON_AFFILIATE_TAG ?? '';
    const marketplace = (cfg.amazon?.marketplace ?? process.env.AMAZON_MARKETPLACE ?? 'IT').toLowerCase();

    if (!accessKey || !secretKey || !partnerTag) {
      res.status(400).json({ error: 'Credenziali Amazon PA-API non configurate. Vai in Impostazioni e inserisci Access Key, Secret Key e Affiliate Tag.' });
      return;
    }

    const data = await paApiGetItem(resolvedAsin, accessKey, secretKey, partnerTag, marketplace) as any;
    const item = data.ItemsResult?.Items?.[0];
    if (!item) { res.status(404).json({ error: 'Prodotto non trovato nella risposta PA-API' }); return; }

    const title = item.ItemInfo?.Title?.DisplayValue ?? '';
    const image = item.Images?.Primary?.Large?.URL ?? '';
    const discountedPrice: number = item.Offers?.Listings?.[0]?.Price?.Amount ?? 0;
    const savingBasis: number = item.Offers?.Listings?.[0]?.SavingBasis?.Amount ?? discountedPrice;
    const originalPrice = savingBasis > discountedPrice ? savingBasis : discountedPrice;
    const discountPercent = originalPrice > discountedPrice
      ? Math.round((1 - discountedPrice / originalPrice) * 100) : 0;
    const mkDomain = MK[marketplace]?.domain ?? 'www.amazon.it';

    res.json({ asin: resolvedAsin, title, image, originalPrice, discountedPrice, discountPercent, affiliateUrl: `https://${mkDomain}/dp/${resolvedAsin}?tag=${partnerTag}` });

  } else if (platform === 'aliexpress') {
    const productId = extractAliId(url);
    if (!productId) { res.status(400).json({ error: 'Could not extract product ID' }); return; }

    const trackingId = cfg.aliexpress?.trackingId ?? process.env.ALIEXPRESS_TRACKING_ID ?? '';

    // AliExpress Open API richiede OAuth — non ancora implementato.
    // L'utente può inserire manualmente titolo e prezzo nel form.
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
    res.status(400).json({ error: 'platform must be amazon or aliexpress' });
  }
});
