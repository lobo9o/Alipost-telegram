import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withErrorHandler, allowMethods } from '../_utils';

// Placeholder for AliExpress Affiliate API integration.
// All credential access happens here — never in the frontend.

interface AliExpressProductResult {
  productId: string;
  title: string;
  image: string;
  originalPrice: number;
  discountedPrice: number;
  discountPercent: number;
  affiliateUrl: string;
}

const MOCK_CATALOG: Record<string, Omit<AliExpressProductResult, 'productId' | 'affiliateUrl'>> = {
  '1005006033': {
    title: 'Xiaomi Redmi Buds 5 TWS Auricolari Wireless',
    image: 'https://ae01.alicdn.com/kf/S1234567890.jpg',
    originalPrice: 39.99, discountedPrice: 18.50, discountPercent: 54,
  },
  '1005005801': {
    title: 'Anker PowerBank 20000mAh USB-C PD 65W',
    image: 'https://ae01.alicdn.com/kf/S0987654321.jpg',
    originalPrice: 59.99, discountedPrice: 28.99, discountPercent: 52,
  },
  '1005004212': {
    title: 'Baseus Caricatore GaN 65W 4 porte',
    image: 'https://ae01.alicdn.com/kf/S1122334455.jpg',
    originalPrice: 45.00, discountedPrice: 19.99, discountPercent: 56,
  },
};

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['POST'], req, res)) return;

  const { url } = req.body ?? {};
  if (!url) { res.status(400).json({ error: 'url required' }); return; }

  const trackingId = process.env.ALIEXPRESS_TRACKING_ID ?? '';
  const appKey = process.env.ALIEXPRESS_APP_KEY ?? '';

  const productId = extractProductId(url);
  if (!productId) { res.status(400).json({ error: 'Could not extract product ID from url' }); return; }

  // ── Real AliExpress Affiliate API call goes here ──────────────────────────
  // const appSecret = process.env.ALIEXPRESS_APP_SECRET;
  // const result = await callAliexpressApi({ productId, appKey, appSecret, trackingId });
  // ─────────────────────────────────────────────────────────────────────────

  // Mock fallback
  const mock = MOCK_CATALOG[productId] ?? {
    title: `Prodotto AliExpress (ID: ${productId})`,
    image: '',
    originalPrice: 29.99,
    discountedPrice: 14.99,
    discountPercent: 50,
  };

  const result: AliExpressProductResult = {
    ...mock,
    productId,
    affiliateUrl: `https://s.click.aliexpress.com/e/_link?productId=${productId}&trackingId=${trackingId}`,
  };

  res.json(result);
});

function extractProductId(url: string): string | null {
  const m = url.match(/\/item\/(\d+)\.html/) ?? url.match(/[?&]productId=(\d+)/);
  return m ? m[1] : null;
}
