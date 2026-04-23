import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withErrorHandler, allowMethods } from './_utils.js';

// Unified product fetch endpoint — keeps all API secrets server-side.
// Body: { platform: 'amazon' | 'aliexpress', url: string, asin?: string }

const AMAZON_MOCK: Record<string, { title: string; image: string; originalPrice: number; discountedPrice: number; discountPercent: number }> = {
  'B0CHX3QBCH': { title: 'Amazfit GTR 4 Smartwatch', image: 'https://m.media-amazon.com/images/I/71qKQZiGhRL._AC_SX466_.jpg', originalPrice: 199.90, discountedPrice: 89.90, discountPercent: 55 },
  'B09G9HD6PD': { title: 'Echo Dot (5ª gen.) Altoparlante smart con Alexa', image: 'https://m.media-amazon.com/images/I/71xoR4A6q9L._AC_SX466_.jpg', originalPrice: 64.99, discountedPrice: 24.99, discountPercent: 62 },
  'B0BVZM41G3': { title: 'Philips Hue Starter Kit 3 lampadine E27', image: 'https://m.media-amazon.com/images/I/61fxBxF6tXL._AC_SX466_.jpg', originalPrice: 119.95, discountedPrice: 69.95, discountPercent: 42 },
};

const ALI_MOCK: Record<string, { title: string; image: string; originalPrice: number; discountedPrice: number; discountPercent: number }> = {
  '1005006033': { title: 'Xiaomi Redmi Buds 5 TWS Auricolari Wireless', image: '', originalPrice: 39.99, discountedPrice: 18.50, discountPercent: 54 },
  '1005005801': { title: 'Anker PowerBank 20000mAh USB-C PD 65W', image: '', originalPrice: 59.99, discountedPrice: 28.99, discountPercent: 52 },
  '1005004212': { title: 'Baseus Caricatore GaN 65W 4 porte', image: '', originalPrice: 45.00, discountedPrice: 19.99, discountPercent: 56 },
};

function extractAsin(url: string): string | null {
  for (const p of [/\/dp\/([A-Z0-9]{10})/, /\/gp\/product\/([A-Z0-9]{10})/, /\/ASIN\/([A-Z0-9]{10})/, /[?&]asin=([A-Z0-9]{10})/i]) {
    const m = url.match(p); if (m) return m[1];
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

  if (platform === 'amazon') {
    const affiliateTag = process.env.AMAZON_AFFILIATE_TAG ?? '';
    const marketplace = process.env.AMAZON_MARKETPLACE ?? 'it';
    const resolvedAsin = asin ?? extractAsin(url) ?? '';
    if (!resolvedAsin) { res.status(400).json({ error: 'Could not extract ASIN' }); return; }

    // ── Real PA-API 5.0 call goes here ──────────────────────────
    // const result = await callPaApi({ asin: resolvedAsin, ... });
    // ────────────────────────────────────────────────────────────

    const mock = AMAZON_MOCK[resolvedAsin] ?? { title: `Prodotto Amazon (${resolvedAsin})`, image: '', originalPrice: 49.99, discountedPrice: 29.99, discountPercent: 40 };
    res.json({ ...mock, asin: resolvedAsin, affiliateUrl: `https://www.amazon.${marketplace}/dp/${resolvedAsin}?tag=${affiliateTag}` });

  } else if (platform === 'aliexpress') {
    const trackingId = process.env.ALIEXPRESS_TRACKING_ID ?? '';
    const productId = extractAliId(url);
    if (!productId) { res.status(400).json({ error: 'Could not extract product ID' }); return; }

    // ── Real AliExpress API call goes here ───────────────────────
    // const result = await callAliexpressApi({ productId, ... });
    // ────────────────────────────────────────────────────────────

    const mock = ALI_MOCK[productId] ?? { title: `Prodotto AliExpress (${productId})`, image: '', originalPrice: 29.99, discountedPrice: 14.99, discountPercent: 50 };
    res.json({ ...mock, productId, affiliateUrl: `https://s.click.aliexpress.com/e/_link?productId=${productId}&trackingId=${trackingId}` });

  } else {
    res.status(400).json({ error: 'platform must be amazon or aliexpress' });
  }
});
