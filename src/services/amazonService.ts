export interface AmazonProduct {
  asin: string;
  title: string;
  image: string;
  originalPrice: number;
  discountedPrice: number;
  discountPercent: number;
}

const MOCK_CATALOG: Record<string, AmazonProduct> = {
  B08N5WRWNW: { asin: 'B08N5WRWNW', title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones', image: '', originalPrice: 299.00, discountedPrice: 189.00, discountPercent: 37 },
  B09G9HD6PD: { asin: 'B09G9HD6PD', title: 'Anker MagSafe Wireless Charger 15W Fast Charge', image: '', originalPrice: 39.99, discountedPrice: 24.99, discountPercent: 37 },
  B07CZNHLFJ: { asin: 'B07CZNHLFJ', title: 'Logitech MX Master 3S Wireless Performance Mouse', image: '', originalPrice: 99.99, discountedPrice: 69.99, discountPercent: 30 },
  B09B8YWXDF: { asin: 'B09B8YWXDF', title: 'Samsung Galaxy Buds2 Pro True Wireless Earbuds', image: '', originalPrice: 229.00, discountedPrice: 149.00, discountPercent: 35 },
  B0C1234567: { asin: 'B0C1234567', title: 'Fire TV Stick 4K Max con Alexa', image: '', originalPrice: 74.99, discountedPrice: 34.99, discountPercent: 53 },
};

export function detectAmazonLink(url: string): boolean {
  return /amazon\.(it|com|de|fr|es|co\.uk|co\.jp)/i.test(url);
}

export function extractASIN(url: string): string | null {
  const patterns = [
    /\/dp\/([A-Z0-9]{10})/i,
    /\/gp\/product\/([A-Z0-9]{10})/i,
    /\/ASIN\/([A-Z0-9]{10})/i,
    /[?&]asin=([A-Z0-9]{10})/i,
  ];
  for (const pat of patterns) {
    const m = url.match(pat);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

// Never calls Amazon PA-API directly from the frontend.
// In production: POST /api/amazon/product { asin } → backend handles credentials.
export async function fetchAmazonProduct(input: string): Promise<AmazonProduct> {
  const asin = (extractASIN(input) ?? input).toUpperCase();
  await new Promise(r => setTimeout(r, 500));

  if (MOCK_CATALOG[asin]) return MOCK_CATALOG[asin];

  const disc = Math.round(Math.random() * 40 + 15);
  const origPrice = Math.round((Math.random() * 120 + 20) * 100) / 100;
  const discPrice = Math.round(origPrice * (1 - disc / 100) * 100) / 100;

  return {
    asin,
    title: `Prodotto Amazon (${asin})`,
    image: '',
    originalPrice: origPrice,
    discountedPrice: discPrice,
    discountPercent: disc,
  };
}
