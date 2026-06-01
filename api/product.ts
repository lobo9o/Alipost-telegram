import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withErrorHandler, allowMethods, requireUserId } from './_utils.js';
import sql from '../lib/db.js';
import crypto from 'crypto';
import { getProductEmoji, shortenTitle } from './_titleFormat.js';

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
    // LWA (v3.x) — OAuth2 standard: application/x-www-form-urlencoded
    res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: credentialId,
        client_secret: credentialSecret,
        scope: 'creatorsapi::default',
      }).toString(),
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

  const requestBody = {
    itemIds: [asin],
    partnerTag: partnerTag,
    partnerType: 'associates',
    resources: [
      'itemInfo.title',
      'images.primary.large',
      'offersV2.listings.price',
      'itemInfo.byLineInfo',
      'browseNodeInfo.browseNodes',
      'offersV2.listings.dealDetails',
      'offersV2.listings.type',
    ],
  };

  const apiUrl = 'https://creatorsapi.amazon/catalog/v1/getItems';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'x-marketplace': marketplaceDomain,
    'User-Agent': 'creatorsapi-nodejs-sdk/1.2.0',
  };

  // Retry con backoff su 429 (rate limit)
  const delays = [2000, 5000, 10000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const res = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(requestBody) });
    const responseText = await res.text();

    console.log('[product] SUMMARY', JSON.stringify({
      asin, attempt, status: res.status, resp: responseText.slice(0, 200),
    }));

    if (res.status === 429 && attempt < delays.length) {
      const wait = delays[attempt];
      console.log(`[product] rate limit 429, retry in ${wait}ms (tentativo ${attempt + 1}/${delays.length})`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }

    if (!res.ok) throw new Error(`Creators API (${res.status}): ${responseText}`);
    return JSON.parse(responseText);
  }
}

function parsePriceStr(s: string): number {
  // Rimuove simboli valuta, spazi, &nbsp; poi normalizza separatore decimale
  const clean = s.replace(/[€£$ \s]/g, '').trim();
  // Formato europeo "29,99" → "29.99", formato USA "29.99" già ok
  // Se ci sono sia punto che virgola (1.234,56) rimuove il punto migliaia
  const normalized = /\d\.\d{3},\d{2}/.test(clean)
    ? clean.replace('.', '').replace(',', '.')
    : clean.replace(',', '.');
  return parseFloat(normalized) || 0;
}

async function scrapeAmazonPage(asin: string, domain: string): Promise<{
  stelle: string;
  recensioni: string;
  scrapedPrice: number;
  scrapedOrigPrice: number;
  clipCoupon: string;
  clipCouponPct: boolean;
  hasCheckoutDiscount: boolean;
  checkoutDiscountAmount: number;
}> {
  const empty = { stelle: '', recensioni: '', scrapedPrice: 0, scrapedOrigPrice: 0, clipCoupon: '', clipCouponPct: false, hasCheckoutDiscount: false, checkoutDiscountAmount: 0 };
  try {
    const url = `https://${domain}/dp/${asin}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
    });
    clearTimeout(timer);
    if (!r.ok) return empty;
    const html = await r.text();

    // stelle — target elemento a-icon-alt: "4,5 su 5 stelle" / "4.5 out of 5 stars"
    let stelle = '';
    const starM = html.match(/class="a-icon-alt">\s*([\d,\.]+)\s*(?:su|out of)/i)
      ?? html.match(/"ratingValue"\s*:\s*"([\d,\.]+)"/)
      ?? html.match(/(\d[,\.]\d)\s*(?:su|out of)\s*5\s*stel/i);
    if (starM) stelle = starM[1].replace(',', '.');

    // recensioni — target id="acrCustomerReviewText" o data-hook="total-review-count"
    let recensioni = '';
    const revSpanM = html.match(/id="acrCustomerReviewText"[^>]*>([^<]+)/i)
      ?? html.match(/data-hook="total-review-count"[^>]*>([^<]+)/i);
    if (revSpanM) {
      const numM = revSpanM[1].match(/[\d\.,]+/);
      if (numM) recensioni = numM[0];
    }

    // prezzi — strategia multi-livello
    let scrapedPrice = 0;
    let scrapedOrigPrice = 0;

    // 1. JSON-LD offers (più affidabile)
    const ldM = html.match(/"@type"\s*:\s*"Offer"[^}]*?"price"\s*:\s*"?([\d]+(?:[.,][\d]+)?)"?/);
    if (ldM) scrapedPrice = parsePriceStr(ldM[1]);

    // 2. .a-offscreen — span accessibili dentro .a-price (primo=scontato, secondo=originale)
    if (scrapedPrice === 0) {
      const offscreenAll = [...html.matchAll(/class="a-offscreen">([^<]+)</g)];
      if (offscreenAll[0]) scrapedPrice = parsePriceStr(offscreenAll[0][1]);
      if (offscreenAll[1]) scrapedOrigPrice = parsePriceStr(offscreenAll[1][1]);
    }

    // 3. priceblock legacy (id="priceblock_ourprice" o priceblock_dealprice)
    if (scrapedPrice === 0) {
      const pbM = html.match(/id="priceblock_(?:ourprice|dealprice|saleprice)"[^>]*>([^<]+)</i);
      if (pbM) scrapedPrice = parsePriceStr(pbM[1]);
    }

    // 4. "corePrice" dal JSON inline di Amazon
    if (scrapedPrice === 0) {
      const cpM = html.match(/"priceAmount"\s*:\s*([\d]+(?:\.\d+)?)/);
      if (cpM) scrapedPrice = parseFloat(cpM[1]) || 0;
    }

    // Prezzo di riferimento barrato (basisPrice / Prezzo di listino) — due strategie:
    // 1. a-text-strike nel blocco basisPrice (layout con strikethrough esplicito)
    const basisStrikeM = html.match(/basisPrice.{0,100}Prezzo\s+di\s+listino.{0,200}a-text-strike[^>]*>\s*([\d]+[,.][\d]{1,2})/si)
      ?? html.match(/Prezzo\s+di\s+listino.{0,200}a-text-strike[^>]*>\s*([\d]+[,.][\d]{1,2})/si);
    if (basisStrikeM) {
      const basisPrice = parsePriceStr(basisStrikeM[1]);
      if (basisPrice > scrapedPrice) {
        console.log(`[product] basisPrice strikethrough trovato: ${basisPrice}`);
        scrapedOrigPrice = basisPrice;
      }
    }
    // 2. data-a-color="secondary" — il prezzo di riferimento/confronto mostrato in grigio
    //    (usato sia per "Prezzo di listino" che per "Prezzo più basso ultimi 30gg")
    if (scrapedOrigPrice <= scrapedPrice) {
      const secondaryM = html.match(/data-a-color="secondary"[^>]*>.*?class="a-offscreen">([\d,]+€)/si);
      if (secondaryM) {
        const secPrice = parsePriceStr(secondaryM[1]);
        if (secPrice > scrapedPrice) {
          console.log(`[product] prezzo secondario (riferimento): ${secPrice}`);
          scrapedOrigPrice = secPrice;
        }
      }
    }

    // Prezzo alternativo dal buybox: apex-pricetopay-value size="l" con ≥2 opzioni
    // (es. prezzo con coupon S&S vs senza, prezzo con promozione vs senza)
    // Quando esistono due opzioni, la più alta è il prezzo "senza sconto extra" da mostrare nel post.
    // Gira SEMPRE, non solo se snsSection — la pagina può non avere keyword S&S ma avere due opzioni prezzo.
    const apexLPrices = [...html.matchAll(/apex-pricetopay-value[^>]*data-a-size="l"[^>]*><span class="a-offscreen">([\d,]+€)/gi)]
      .map(m => parsePriceStr(m[1])).filter(p => p > 0);
    if (apexLPrices.length >= 2) {
      const maxApex = Math.max(...apexLPrices);
      if (maxApex > scrapedPrice) {
        console.log(`[product] apex max opzione prezzo: ${maxApex} (era ${scrapedPrice}) | opzioni: ${apexLPrices.join(',')}`);
        scrapedPrice = maxApex;
      }
    }

    // Legacy S&S: sns-base-price / snsSavings (mantenuto per compatibilità layout vecchi)
    const snsSection = html.includes('subscribeAndSave_feature_div') || html.includes('sns-base-price') || html.includes('snsSavings') || html.includes('subscribe_save');
    if (snsSection) {
      const snsBaseM = html.match(/id="sns-base-price[^"]*"[^>]*>[^€]*€\s*([\d]+[,.][\d]{2})/i)
        ?? html.match(/class="[^"]*snsSavings[^"]*"[^€]*€\s*([\d]+[,.][\d]{2})/i);
      if (snsBaseM) {
        const basePrice = parsePriceStr(snsBaseM[1]);
        if (basePrice > scrapedPrice) {
          console.log(`[product] S&S legacy: prezzo base ${basePrice} (era ${scrapedPrice})`);
          scrapedPrice = basePrice;
        }
      } else {
        const snsPriceM = html.match(/Prezzo[^€<]{0,30}€\s*([\d]+[,.][\d]{2})/);
        if (snsPriceM) {
          const basePrice = parsePriceStr(snsPriceM[1]);
          if (basePrice > scrapedPrice && scrapedPrice > 0) {
            console.log(`[product] S&S legacy prezzo da testo: ${basePrice} (era ${scrapedPrice})`);
            scrapedPrice = basePrice;
          }
        }
      }
    }

    // Clip coupon (checkbox da spuntare nel buybox) — rilevato da couponLabelText.
    // Scansiona TUTTE le occorrenze e controlla il testo del coupon stesso:
    // se il testo contiene parole S&S ("abbonati", "prima consegna", ecc.) → salta.
    let clipCoupon = '';
    let clipCouponPct = false;
    const SNS_COUPON_RE = /abbonati|prima\s+consegna|consegne\s+ripetute|solo\s+all.{0,5}opzione/i;
    const couponLabelRe = /couponLabelText[^>]*>([^<]+)/gi;
    let cm: RegExpExecArray | null;
    while ((cm = couponLabelRe.exec(html)) !== null) {
      const text = cm[1].trim();
      if (!text) continue;
      if (SNS_COUPON_RE.test(text)) {
        console.log('[product] coupon ignorato (S&S):', text.slice(0, 100));
        continue;
      }
      const pctM = text.match(/Applica\s+coupon\s+([\d,\.]+)\s*%/i);
      if (pctM) { clipCoupon = pctM[1].replace(',', '.') + '%'; clipCouponPct = true; break; }
      const amtM = text.match(/Applica\s+coupon\s+(?:€|EUR\s*)?([\d,\.]+)/i);
      if (amtM) { clipCoupon = amtM[1].replace(',', '.') + '€'; break; }
    }
    if (clipCoupon) console.log('[product] clip coupon da scraping:', clipCoupon, 'pct:', clipCouponPct);

    // Checkout discount (sconto automatico al check-out, senza spuntare box)
    // Cerca "Risparmia X,XX € al check-out" nell'HTML
    let hasCheckoutDiscount = false;
    let checkoutDiscountAmount = 0;
    const checkoutM = html.match(/Risparmia\s+([\d]+[,.][\d]{1,2})\s*(?:&nbsp;)?\s*(?:€|&euro;)?\s*al\s+check-out/i);
    if (checkoutM) {
      hasCheckoutDiscount = true;
      checkoutDiscountAmount = parsePriceStr(checkoutM[1]);
      console.log('[product] checkout discount rilevato per', asin, '| importo:', checkoutDiscountAmount);
    }

    console.log('[product] scrape page', asin, '| stelle:', stelle, '| rec:', recensioni, '| price:', scrapedPrice, '| origPrice:', scrapedOrigPrice);
    return { stelle, recensioni, scrapedPrice, scrapedOrigPrice, clipCoupon, clipCouponPct, hasCheckoutDiscount, checkoutDiscountAmount };
  } catch {
    return empty;
  }
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

async function resolveShortUrl(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bot/1.0)' },
    });
    clearTimeout(timer);
    const final = r.url || url;
    console.log('[resolve] shortlink', url.slice(0, 60), '→', final.slice(0, 100));
    return final;
  } catch {
    return url;
  }
}

const AMAZON_SHORT_DOMAINS = /^https?:\/\/(amzn\.to|amzn\.eu|amzlink\.to|a\.co|amazon\.soy)\//i;
const ALI_SHORT_DOMAINS = /s\.click\.aliexpress|a\.aliexpress\.com|ali\.ski|aliexpress\.page\.link/i;

async function resolveAliUrl(url: string): Promise<string> {
  if (!ALI_SHORT_DOMAINS.test(url)) return url;
  return resolveShortUrl(url);
}

async function scrapeAliPrice(productId: string): Promise<{ price: number; origPrice: number }> {
  try {
    const url = `https://www.aliexpress.com/item/${productId}.html`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'it-IT,it;q=0.9',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timer);
    if (!r.ok) return { price: 0, origPrice: 0 };
    const html = await r.text();

    // JSON inline di AliExpress: "salePrice":{"minPrice":12.99,...}
    let price = 0;
    let origPrice = 0;
    const salePriceM = html.match(/"salePrice"\s*:\s*\{[^}]*"minPrice"\s*:\s*([\d.]+)/);
    if (salePriceM) price = parseFloat(salePriceM[1]) || 0;
    const origPriceM = html.match(/"originalPrice"\s*:\s*\{[^}]*"minPrice"\s*:\s*([\d.]+)/)
      ?? html.match(/"originalPrice"\s*:\s*([\d.]+)/);
    if (origPriceM) origPrice = parseFloat(origPriceM[1]) || 0;

    // Fallback: cerca "US $12.99" o "€12,99" nel testo
    if (price === 0) {
      const priceM = html.match(/(?:US \$|€|EUR\s*)([\d]+[.,][\d]{2})/i);
      if (priceM) price = parsePriceStr(priceM[1]);
    }

    console.log('[ali] scrape price', productId, '→', price, origPrice);
    return { price, origPrice };
  } catch {
    return { price: 0, origPrice: 0 };
  }
}

async function scrapeAliShipFrom(productId: string): Promise<string | null> {
  const NAME_TO_CODE: Record<string, string> = {
    France: 'FR', Germany: 'DE', Spain: 'ES', Italy: 'IT', China: 'CN',
    'United States': 'US', Japan: 'JP', 'United Kingdom': 'GB',
    Netherlands: 'NL', Poland: 'PL', Russia: 'RU', Brazil: 'BR',
    Turkey: 'TR', Australia: 'AU', Canada: 'CA', India: 'IN',
    Korea: 'KR', Belgium: 'BE', Portugal: 'PT', Sweden: 'SE',
    Austria: 'AT', Switzerland: 'CH', Ukraine: 'UA',
  };

  async function fetchPage(url: string): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const r = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
      });
      clearTimeout(timer);
      if (!r.ok) return null;
      return r.text();
    } catch { return null; }
  }

  function extractFrom(html: string, label: string): string | null {
    const pick = (vals: string[]) => vals.find(v => v !== 'CN') ?? vals[0] ?? null;

    // Pattern JSON — tutte le chiavi note per warehouse/spedizione
    for (const key of [
      'sendCountry', 'shipFromCountry', 'fromCountry', 'sendGoodsCountry',
      'storeCountry', 'warehouseCountry', 'senderCountry', 'originPlace',
      'fromCountryCode', 'originCountryCode', 'shipFromCode',
    ]) {
      const all = [...html.matchAll(new RegExp(`"${key}"\\s*:\\s*"([A-Z]{2})"`, 'g'))].map(m => m[1]);
      const v = pick(all);
      if (v) { console.log(`[ali] shipFrom [${label}] ${key}:`, v); return v; }
    }

    // shipFrom:"France" o shipFrom:"FR"
    const allShipFrom = [...html.matchAll(/"shipFrom"\s*:\s*"([^"]{2,30})"/g)].map(m => m[1].trim());
    const sfName = allShipFrom.find(v => NAME_TO_CODE[v] && NAME_TO_CODE[v] !== 'CN')
      ?? allShipFrom.find(v => v.length === 2 && v !== 'CN')
      ?? allShipFrom[0] ?? null;
    if (sfName) {
      const code = sfName.length === 2 ? sfName.toUpperCase() : (NAME_TO_CODE[sfName] ?? null);
      if (code) { console.log(`[ali] shipFrom [${label}] shipFrom name:`, sfName, '→', code); return code; }
    }

    // Testo visibile "Ship from France" / "Shipped from France" / "Ships from France"
    const textMatch = html.match(/[Ss]hip(?:ped|s)?\s+from\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
    if (textMatch) {
      const name = textMatch[1];
      const code = NAME_TO_CODE[name];
      if (code) { console.log(`[ali] shipFrom [${label}] text "Ship from":`, name, '→', code); return code; }
    }

    // "country":"FR" dentro blocco freight/logistics
    const m = html.match(/"(?:freight|freightInfo|logistics|delivery|overseaDelivery)[^}]{0,400}"country"\s*:\s*"([A-Z]{2})"/s);
    if (m?.[1]) { console.log(`[ali] shipFrom [${label}] freight.country:`, m[1]); return m[1]; }

    // countryCode in blocco shipment/warehouse/store/send
    const mc = html.match(/"(?:shipment|warehouse|store|send|delivery)[^}]{0,300}"countryCode"\s*:\s*"([A-Z]{2})"/s);
    if (mc?.[1] && mc[1] !== 'CN') { console.log(`[ali] shipFrom [${label}] countryCode:`, mc[1]); return mc[1]; }

    return null;
  }

  try {
    // Prima prova URL internazionale
    const html1 = await fetchPage(`https://www.aliexpress.com/item/${productId}.html`);
    if (html1) {
      const r1 = extractFrom(html1, 'www');
      if (r1) return r1;
    }

    // Fallback: URL italiano (può avere dati warehouse EU in chiaro)
    const html2 = await fetchPage(`https://it.aliexpress.com/item/${productId}.html`);
    if (html2) {
      const r2 = extractFrom(html2, 'it');
      if (r2) return r2;
    }

    // Debug: mostra chiavi trovate per diagnostica
    const html = html1 ?? html2 ?? '';
    const snipSend = html.match(/"(?:send|ship|from|ware|origin|country)[^"]{0,25}"/gi)?.slice(0, 8);
    console.log('[ali] shipFrom: nessun pattern per', productId, '| keys:', snipSend?.join(', ') ?? 'nessuna');
    return null;
  } catch (e: any) {
    console.warn('[ali] scrapeShipFrom error:', e.message);
    return null;
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

async function aliCall(method: string, appKey: string, appSecret: string, extra: Record<string, string>, attempt = 1): Promise<unknown> {
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
  console.log(`[ali] ${method} attempt=${attempt} ${res.status}:`, text.slice(0, 300));
  if (!res.ok) throw new Error(`AliExpress API HTTP ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  if (json.error_response) {
    const e = json.error_response;
    // Rate limit: riprova dopo una pausa (max 3 tentativi)
    if (e.code === 'ApiCallLimit' && attempt < 3) {
      const wait = attempt * 1500;
      console.log(`[ali] rate limit, retry in ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
      return aliCall(method, appKey, appSecret, extra, attempt + 1);
    }
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
    country: country.toUpperCase(),   // restituisce target_sale_price con IVA locale inclusa
    fields: 'product_id,product_title,product_main_image_url,target_sale_price,target_original_price,target_sale_price_currency,discount,shop_id,product_country,sku_id,first_level_category_name,second_level_category_name',
  }) as any;

  const resp = data?.aliexpress_affiliate_productdetail_get_response?.resp_result;
  if (!resp || resp.resp_code !== 200) {
    throw new Error(`AliExpress prodotto [${resp?.resp_code ?? '?'}]: ${resp?.resp_msg ?? JSON.stringify(data).slice(0, 200)}`);
  }
  const product = resp?.result?.products?.product?.[0];
  if (!product) throw new Error('Prodotto non trovato su AliExpress (ID: ' + productId + ')');
  const cat = String(product.second_level_category_name || product.first_level_category_name || '');
  return {
    title: String(product.product_title ?? ''),
    image: String(product.product_main_image_url ?? ''),
    salePrice: parseFloat(String(product.target_sale_price ?? 0)) || 0,
    origPrice: parseFloat(String(product.target_original_price ?? 0)) || 0,
    discountRate: parseInt(String(product.discount ?? '0').replace('%', '')) || 0,
    shipFromCountry: String(product.product_country || '').toUpperCase() || null,
    skuId: String(product.sku_id || ''),
    cat,
  };
}

async function aliGetShipFrom(
  productId: string, skuId: string, country: string, currency: string,
  salePrice: string, language: string, appKey: string, appSecret: string,
): Promise<string | null> {
  try {
    const data = await aliCall('aliexpress.affiliate.product.shipping.get', appKey, appSecret, {
      product_id: productId,
      sku_id: skuId,
      ship_to_country: country,
      target_currency: currency,
      target_sale_price: salePrice,
      target_language: language,
      tax_rate: '0',
    }) as any;
    // API può rispondere con chiave specifica o con resp_result diretto (streamlined)
    const resp = data?.aliexpress_affiliate_product_shipping_get_response?.resp_result ?? data?.resp_result;
    const code = String(resp?.resp_code ?? '');
    const shipFrom = String(resp?.result?.ship_from_country ?? '').toUpperCase();
    console.log('[ali] shipping API resp_code:', code, '| ship_from_country:', shipFrom || '(vuoto)');
    return shipFrom || null;
  } catch (e: any) {
    console.warn('[ali] getShipFrom error:', e.message);
    return null;
  }
}

async function aliGetAffiliateLink(productUrl: string, appKey: string, appSecret: string, trackingId: string, country?: string): Promise<string> {
  const data = await aliCall('aliexpress.affiliate.link.generate', appKey, appSecret, {
    promotion_link_type: '0',
    source_values: productUrl,
    tracking_id: trackingId,
    ...(country ? { ship_to_country: country.toUpperCase() } : {}),
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

  let { platform, url, asin } = req.body ?? {};
  if (!platform || !url) { res.status(400).json({ error: 'platform e url sono richiesti' }); return; }

  // Auto-correzione: se il frontend manda platform=aliexpress ma l'URL è un link corto Amazon, correggi qui
  if (platform === 'aliexpress' && AMAZON_SHORT_DOMAINS.test(url)) {
    console.log('[product] auto-fix platform: aliexpress→amazon per URL', url.slice(0, 60));
    platform = 'amazon';
  }

  const [settingsRow] = await sql`SELECT data FROM settings WHERE user_id = ${userId}`;
  const rawData = settingsRow?.data ?? {};
  const cfg = (typeof rawData === 'string' ? JSON.parse(rawData) : rawData) as Record<string, any>;
  console.log('[product] cfg.amazon version:', cfg.amazon?.version, 'marketplace:', cfg.amazon?.marketplace);

  if (platform === 'amazon') {
    // Risolvi link corti Amazon (amzlink.to, amzn.to, ecc.) prima di estrarre l'ASIN
    const resolvedUrl = AMAZON_SHORT_DOMAINS.test(url) ? await resolveShortUrl(url) : url;
    const resolvedAsin = (asin ?? extractAsin(resolvedUrl) ?? extractAsin(url) ?? '').toUpperCase();
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
    const offersV2        = pick(item, 'offersV2', 'OffersV2') as any;
    const allListings     = (pick(offersV2, 'listings', 'Listings') as any[]) ?? [];
    // Escludi listing Subscribe & Save (prezzo artificialmente basso, non acquistabile senza abbonamento)
    const listingType = (l: any) => String(pick(l, 'type', 'Type') ?? '').toLowerCase();
    const isSnS = (l: any) => listingType(l).includes('subscribe');
    const regularListings = allListings.filter(l => !isSnS(l));
    const listings        = regularListings[0] ?? allListings[0];
    if (regularListings.length < allListings.length) {
      console.log(`[product] ${resolvedAsin}: esclusi ${allListings.length - regularListings.length} listing S&S (types: ${allListings.map(listingType).join(',')})`);
    } else {
      console.log(`[product] ${resolvedAsin}: listing types: ${allListings.map(listingType).join(',')}`);
    }
    const priceObj        = pick(listings, 'price', 'Price') as any;
    const discountedPrice = (pick(pick(priceObj, 'money', 'Money'), 'amount', 'Amount') as number) ?? 0;
    const savingBasisAmt  = (pick(pick(pick(priceObj, 'savingBasis', 'SavingBasis'), 'money', 'Money'), 'amount', 'Amount') as number) ?? 0;
    const savingsPct      = (pick(pick(priceObj, 'savings', 'Savings'), 'percentage', 'Percentage') as number) ?? 0;
    const originalPrice   = savingBasisAmt > 0 ? savingBasisAmt : discountedPrice;
    const discountPercent = savingsPct > 0
      ? Math.round(savingsPct)
      : originalPrice > discountedPrice
        ? Math.round((1 - discountedPrice / originalPrice) * 100) : 0;

    // customerReviews non è supportato dall'API Creators — scraping pagina prodotto
    // Se il prezzo dall'API è 0, lo scraping prova a recuperarlo dalla pagina HTML
    // Rileva anche clip coupon (checkbox) dalla classe couponLabelText nella pagina
    const { stelle, recensioni, scrapedPrice, scrapedOrigPrice, clipCoupon, clipCouponPct, hasCheckoutDiscount, checkoutDiscountAmount } = await scrapeAmazonPage(resolvedAsin, marketplaceDomain);

    let finalDiscountedPrice = discountedPrice;
    let finalOriginalPrice   = originalPrice;
    let priceWarning: string | undefined;

    // Se lo scraping ha rilevato S&S e il prezzo scraped è > prezzo API,
    // l'API sta restituendo il prezzo abbonamento — usiamo il prezzo reale dalla pagina
    if (discountedPrice > 0 && scrapedPrice > discountedPrice * 1.03) {
      console.log(`[product] ${resolvedAsin}: prezzo API (${discountedPrice}) < scraping (${scrapedPrice}) — probabile S&S, uso prezzo pagina`);
      finalDiscountedPrice = scrapedPrice;
      finalOriginalPrice   = scrapedOrigPrice > scrapedPrice ? scrapedOrigPrice : scrapedPrice;
    }
    // Se lo scraping ha trovato un prezzo barrato (basisPrice) significativamente maggiore
    // del prezzo API, l'API non include il savingBasis — usiamo i prezzi della pagina
    if (scrapedOrigPrice > discountedPrice * 1.05 && scrapedOrigPrice > finalOriginalPrice) {
      console.log(`[product] ${resolvedAsin}: scrapedOrigPrice (${scrapedOrigPrice}) > discountedPrice (${discountedPrice}) — uso prezzi pagina`);
      finalOriginalPrice   = scrapedOrigPrice;
      if (scrapedPrice > 0 && scrapedPrice !== discountedPrice * 1) {
        // Usa il prezzo singolo acquisto solo se diverso dal prezzo API
        if (Math.abs(scrapedPrice - discountedPrice) > 0.5) {
          finalDiscountedPrice = scrapedPrice;
        }
      }
    }

    if (discountedPrice === 0) {
      console.warn('[product] prezzo zero da API per ASIN', resolvedAsin, '| listings count:', allListings.length);
      if (scrapedPrice > 0) {
        finalDiscountedPrice = scrapedPrice;
        finalOriginalPrice   = scrapedOrigPrice > scrapedPrice ? scrapedOrigPrice : scrapedPrice;
        console.log('[product] prezzo da scraping:', finalDiscountedPrice, '| orig:', finalOriginalPrice);
      } else {
        priceWarning = 'Prezzo non trovato (prodotto non disponibile o offerta scaduta). Inseriscilo manualmente.';
      }
    }

    const byLine = pick(pick(item, 'itemInfo', 'ItemInfo'), 'byLineInfo', 'ByLineInfo') as any;
    const contributors = pick(byLine, 'contributors', 'Contributors') as any[] ?? [];
    const author = contributors?.[0] ? String(pick(contributors[0], 'name', 'Name') ?? '') : '';

    const browseNodes = (pick(pick(item, 'browseNodeInfo', 'BrowseNodeInfo'), 'browseNodes', 'BrowseNodes') as any[]) ?? [];
    const cat = browseNodes?.[0] ? String(pick(browseNodes[0], 'displayName', 'DisplayName') ?? '') : '';

    const dealDetails = pick(listings, 'dealDetails', 'DealDetails') as any;
    let coupon = '';
    let couponBox = false;
    let couponIsPercent = false;
    if (dealDetails) {
      const rawDealType = String(pick(dealDetails, 'dealType', 'DealType') ?? '');
      const dealType = rawDealType.toLowerCase();
      const displayAmount = String(pick(dealDetails, 'displayAmount', 'DisplayAmount', 'amount', 'Amount') ?? '');
      const displayPerc = String(pick(dealDetails, 'displayPercentage', 'DisplayPercentage', 'percentage', 'Percentage') ?? '');
      if (dealType.includes('coupon') || dealType.includes('clip')) {
        coupon = displayAmount || displayPerc || 'coupon';
        couponIsPercent = !displayAmount && !!displayPerc;
        couponBox = true;
      } else if (displayAmount || displayPerc) {
        coupon = displayAmount || displayPerc;
      }
    }

    // Fallback: se l'API non ha dato coupon, usa quello rilevato dallo scraping (couponLabelText)
    if (!couponBox && clipCoupon) {
      coupon = clipCoupon;
      couponIsPercent = clipCouponPct;
      couponBox = true;
    }

    // Applica il coupon da spuntare al prezzo finale (il prezzo reale che l'utente paga)
    if (couponBox) {
      const couponNum = parsePriceStr(coupon.replace('%', ''));
      if (couponNum > 0) {
        if (couponIsPercent) {
          finalDiscountedPrice = Math.round(finalDiscountedPrice * (1 - couponNum / 100) * 100) / 100;
        } else {
          finalDiscountedPrice = Math.max(0, Math.round((finalDiscountedPrice - couponNum) * 100) / 100);
        }
        console.log('[product] prezzo post-coupon:', finalDiscountedPrice, '| coupon:', coupon, '| pct:', couponIsPercent);
      }
    }

    // Applica sconto checkout (automatico al pagamento): sottrai l'importo se l'API non lo ha già incluso
    if (hasCheckoutDiscount && checkoutDiscountAmount > 0) {
      const expectedAfterDiscount = Math.round((finalDiscountedPrice - checkoutDiscountAmount) * 100) / 100;
      if (expectedAfterDiscount > 0 && expectedAfterDiscount < finalDiscountedPrice) {
        console.log('[product] applico checkout discount:', checkoutDiscountAmount, '| prezzo:', finalDiscountedPrice, '→', expectedAfterDiscount);
        finalDiscountedPrice = expectedAfterDiscount;
      }
    }

    const finalDiscountPercent = savingsPct > 0 && !couponBox
      ? Math.round(savingsPct)
      : finalOriginalPrice > finalDiscountedPrice
        ? Math.round((1 - finalDiscountedPrice / finalOriginalPrice) * 100) : 0;

    // Controlla minimo storico e registra prezzo
    let isHistoricalLowAmazon = false;
    if (resolvedAsin && finalDiscountedPrice > 0) {
      const [histRow] = await sql`
        SELECT MIN(price)::float AS min_price, COUNT(*)::int AS cnt
        FROM price_history WHERE product_id = ${resolvedAsin} AND platform = 'amazon'
      `.catch(() => [null]);
      if (histRow && Number(histRow.cnt) > 0 && finalDiscountedPrice <= Number(histRow.min_price)) {
        isHistoricalLowAmazon = true;
      }
      sql`INSERT INTO price_history (product_id, platform, price)
          VALUES (${resolvedAsin}, 'amazon', ${finalDiscountedPrice})`.catch(() => {});
    }

    const amazonTitle = titleObj ?? '';
    res.json({
      asin: resolvedAsin,
      title: shortenTitle(amazonTitle),
      image: imageUrl ?? '',
      originalPrice: finalOriginalPrice,
      discountedPrice: finalDiscountedPrice,
      discountPercent: finalDiscountPercent,
      affiliateUrl: `https://${marketplaceDomain}/dp/${resolvedAsin}?tag=${affiliateTag}`,
      stelle: stelle || undefined,
      recensioni: recensioni || undefined,
      author: author || undefined,
      cat: cat || undefined,
      coupon: coupon || undefined,
      couponBox: couponBox || undefined,
      checkout: hasCheckoutDiscount ? 'Sconto automatico al check-out' : undefined,
      priceWarning,
      isHistoricalLow: isHistoricalLowAmazon || undefined,
      emoji: getProductEmoji(amazonTitle, cat || undefined),
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

    // productdetail.get con country= restituisce target_sale_price con IVA locale inclusa
    const pd = await aliGetProductDetail(productId, appKey, appSecret, trackingId, country);
    const detail = pd;

    const { currency, language } = ALI_COUNTRY_MAP[country.toUpperCase()] ?? { currency: 'EUR', language: 'IT' };
    const [affiliateUrl, apiShipFrom] = await Promise.all([
      aliGetAffiliateLink(productUrl, appKey, appSecret, trackingId, country),
      // Shipping API per warehouse reale — sempre se c'è skuId, scraping altrimenti
      pd.skuId
        ? aliGetShipFrom(productId, pd.skuId, country, currency, String(pd.salePrice || '0'), language, appKey, appSecret)
        : scrapeAliShipFrom(productId),
    ]);

    let salePrice = pd.salePrice;
    let origPrice = pd.origPrice;

    // Fallback scraping se il prezzo non arriva dall'API
    if (salePrice === 0) {
      console.warn('[ali] prezzo zero da API per', productId, '— provo scraping');
      const scraped = await scrapeAliPrice(productId);
      if (scraped.price > 0) {
        salePrice = scraped.price;
        origPrice = scraped.origPrice > scraped.price ? scraped.origPrice : origPrice;
        console.log('[ali] prezzo da scraping:', salePrice, '| orig:', origPrice);
      }
    }

    const discountPercent = pd.discountRate || (origPrice > salePrice ? Math.round((1 - salePrice / origPrice) * 100) : 0);

    // ship_from_country: shipping API → scraping → product_country (spesso CN anche per EU)
    let shipFromCountry: string | null = apiShipFrom;
    if (!shipFromCountry) shipFromCountry = await scrapeAliShipFrom(productId);
    if (!shipFromCountry) shipFromCountry = pd.shipFromCountry; // ultimo resort

    // Controlla minimo storico e registra prezzo
    let isHistoricalLowAli = false;
    if (productId && salePrice > 0) {
      const [histRow] = await sql`
        SELECT MIN(price)::float AS min_price, COUNT(*)::int AS cnt
        FROM price_history WHERE product_id = ${productId} AND platform = 'aliexpress'
      `.catch(() => [null]);
      if (histRow && Number(histRow.cnt) > 0 && salePrice <= Number(histRow.min_price)) {
        isHistoricalLowAli = true;
      }
      sql`INSERT INTO price_history (product_id, platform, price)
          VALUES (${productId}, 'aliexpress', ${salePrice})`.catch(() => {});
    }

    const aliTitle = detail.title ?? '';
    const aliCat = detail.cat ?? '';
    res.json({
      productId,
      title: shortenTitle(aliTitle),
      image: detail.image,
      originalPrice: origPrice || salePrice,
      discountedPrice: salePrice,
      discountPercent,
      affiliateUrl,
      priceWarning: salePrice === 0 ? 'Prezzo non trovato. Inseriscilo manualmente.' : undefined,
      isHistoricalLow: isHistoricalLowAli || undefined,
      shipFromCountry: shipFromCountry || undefined,
      cat: aliCat || undefined,
      emoji: getProductEmoji(aliTitle, aliCat || undefined),
    });

  } else {
    res.status(400).json({ error: 'platform deve essere amazon o aliexpress' });
  }
});
