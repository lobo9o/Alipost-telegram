export interface AliExpressProduct {
  productId: string;
  title: string;
  image: string;
  originalPrice: number;
  discountedPrice: number;
  discountPercent: number;
}

function extractProductId(url: string): string | null {
  const patterns = [
    /\/item\/(\d{8,})/,
    /productId=(\d{8,})/,
    /\/(\d{12,})\.html/,
  ];
  for (const pat of patterns) {
    const m = url.match(pat);
    if (m) return m[1];
  }
  return null;
}

const MOCK_CATALOG: Record<string, AliExpressProduct> = {
  '1005004999001': { productId: '1005004999001', title: 'Xiaomi Band 8 Pro Smart Fitness Tracker GPS NFC', image: '', originalPrice: 89.99, discountedPrice: 34.99, discountPercent: 61 },
  '1005003123456': { productId: '1005003123456', title: 'LED Strip RGB 10m WiFi Smart Alexa Google Home', image: '', originalPrice: 24.99, discountedPrice: 9.80, discountPercent: 61 },
  '1005002654321': { productId: '1005002654321', title: 'Zaino da Viaggio Impermeabile 40L con Porta USB', image: '', originalPrice: 59.99, discountedPrice: 19.90, discountPercent: 67 },
  '1005001987654': { productId: '1005001987654', title: 'Cuffie Bluetooth 5.0 Noise Cancelling 30h', image: '', originalPrice: 49.99, discountedPrice: 15.99, discountPercent: 68 },
};

// Never calls AliExpress API directly from the frontend.
// In production: POST /api/aliexpress/product { productId }
export async function fetchAliExpressProduct(url: string): Promise<AliExpressProduct> {
  const productId = extractProductId(url) ?? 'unknown';
  await new Promise(r => setTimeout(r, 400));

  if (MOCK_CATALOG[productId]) return MOCK_CATALOG[productId];

  const disc = Math.round(Math.random() * 50 + 20);
  const origPrice = Math.round((Math.random() * 60 + 10) * 100) / 100;
  const discPrice = Math.round(origPrice * (1 - disc / 100) * 100) / 100;

  return {
    productId,
    title: `Prodotto AliExpress`,
    image: '',
    originalPrice: origPrice,
    discountedPrice: discPrice,
    discountPercent: disc,
  };
}
