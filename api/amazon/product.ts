import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withErrorHandler, allowMethods } from '../_utils';

// Placeholder for Amazon PA-API 5.0 integration.
// All credential access happens here — never in the frontend.
// Replace the mock block with real PA-API calls once credentials are configured.

interface AmazonProductResult {
  asin: string;
  title: string;
  image: string;
  originalPrice: number;
  discountedPrice: number;
  discountPercent: number;
  affiliateUrl: string;
}

const MOCK_CATALOG: Record<string, Omit<AmazonProductResult, 'asin' | 'affiliateUrl'>> = {
  'B0CHX3QBCH': {
    title: 'Amazfit GTR 4 Smartwatch',
    image: 'https://m.media-amazon.com/images/I/71qKQZiGhRL._AC_SX466_.jpg',
    originalPrice: 199.90, discountedPrice: 89.90, discountPercent: 55,
  },
  'B09G9HD6PD': {
    title: 'Echo Dot (5ª gen.) Altoparlante smart con Alexa',
    image: 'https://m.media-amazon.com/images/I/71xoR4A6q9L._AC_SX466_.jpg',
    originalPrice: 64.99, discountedPrice: 24.99, discountPercent: 62,
  },
  'B0BVZM41G3': {
    title: 'Philips Hue Starter Kit 3 lampadine E27',
    image: 'https://m.media-amazon.com/images/I/61fxBxF6tXL._AC_SX466_.jpg',
    originalPrice: 119.95, discountedPrice: 69.95, discountPercent: 42,
  },
};

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['POST'], req, res)) return;

  const { asin, url } = req.body ?? {};
  if (!asin && !url) { res.status(400).json({ error: 'asin or url required' }); return; }

  const affiliateTag = process.env.AMAZON_AFFILIATE_TAG ?? '';
  const marketplace = process.env.AMAZON_MARKETPLACE ?? 'it';

  // Determine ASIN from url if not directly provided
  const resolvedAsin: string = asin ?? extractAsin(url ?? '') ?? '';

  if (!resolvedAsin) { res.status(400).json({ error: 'Could not extract ASIN from url' }); return; }

  // ── Real PA-API 5.0 call goes here ───────────────────────────────────────
  // const accessKey = process.env.AMAZON_ACCESS_KEY;
  // const secretKey = process.env.AMAZON_SECRET_KEY;
  // const result = await callPaApi({ asin: resolvedAsin, accessKey, secretKey, affiliateTag, marketplace });
  // ─────────────────────────────────────────────────────────────────────────

  // Mock fallback
  const mock = MOCK_CATALOG[resolvedAsin] ?? {
    title: `Prodotto Amazon (ASIN: ${resolvedAsin})`,
    image: '',
    originalPrice: 49.99,
    discountedPrice: 29.99,
    discountPercent: 40,
  };

  const result: AmazonProductResult = {
    ...mock,
    asin: resolvedAsin,
    affiliateUrl: `https://www.amazon.${marketplace}/dp/${resolvedAsin}?tag=${affiliateTag}`,
  };

  res.json(result);
});

function extractAsin(url: string): string | null {
  const patterns = [
    /\/dp\/([A-Z0-9]{10})/,
    /\/gp\/product\/([A-Z0-9]{10})/,
    /\/ASIN\/([A-Z0-9]{10})/,
    /[?&]asin=([A-Z0-9]{10})/i,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}
