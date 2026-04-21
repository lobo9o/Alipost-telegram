export interface AmazonProduct {
  asin: string;
  title: string;
  price: number;
  originalPrice: number;
  image: string;
}

const MOCK_CATALOG: Record<string, AmazonProduct> = {
  B08N5WRWNW: { asin: 'B08N5WRWNW', title: 'Sony WH-1000XM5 Wireless Noise Cancelling', price: 189.00, originalPrice: 299.00, image: 'placeholder.jpg' },
  B09G9HD6PD: { asin: 'B09G9HD6PD', title: 'Anker MagSafe Wireless Charger 15W Fast', price: 24.99, originalPrice: 39.99, image: 'placeholder.jpg' },
  B07CZNHLFJ: { asin: 'B07CZNHLFJ', title: 'Logitech MX Master 3S Wireless Mouse', price: 69.99, originalPrice: 99.99, image: 'placeholder.jpg' },
  B09B8YWXDF: { asin: 'B09B8YWXDF', title: 'Samsung Galaxy Buds2 Pro True Wireless', price: 149.00, originalPrice: 229.00, image: 'placeholder.jpg' },
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
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

// Simulates a backend call — never use Amazon PA-API directly in the frontend.
// In production: POST /api/amazon/product { asin }
export async function fetchAmazonProduct(asin: string): Promise<AmazonProduct> {
  await new Promise(r => setTimeout(r, 400));

  if (MOCK_CATALOG[asin]) return MOCK_CATALOG[asin];

  return {
    asin,
    title: `Prodotto Amazon (ASIN: ${asin})`,
    price: 29.99,
    originalPrice: 49.99,
    image: 'placeholder.jpg',
  };
}
