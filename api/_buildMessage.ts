import { getProductEmoji } from './_titleFormat.js';

export function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const COUNTRY_IT: Record<string, string> = {
  CN: 'Cina', FR: 'Francia', DE: 'Germania', IT: 'Italia', US: 'USA',
  GB: 'UK', ES: 'Spagna', JP: 'Giappone', KR: 'Corea del Sud',
  NL: 'Paesi Bassi', PL: 'Polonia', RU: 'Russia', BR: 'Brasile',
  TR: 'Turchia', AU: 'Australia', CA: 'Canada', IN: 'India',
  TH: 'Thailandia', VN: 'Vietnam', MY: 'Malaysia', SG: 'Singapore',
  ID: 'Indonesia', PH: 'Filippine', MX: 'Messico', UA: 'Ucraina',
  CZ: 'Rep. Ceca', HU: 'Ungheria', RO: 'Romania', SE: 'Svezia',
  NO: 'Norvegia', DK: 'Danimarca', FI: 'Finlandia', BE: 'Belgio',
  AT: 'Austria', CH: 'Svizzera', PT: 'Portogallo', GR: 'Grecia',
  SA: 'Arabia Saudita', AE: 'Emirati Arabi', IL: 'Israele', EG: 'Egitto',
};

export function codeToFlag(code?: string): string | null {
  if (!code || code.length !== 2) return null;
  return [...code.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');
}

export function codeToCountryName(code?: string): string | null {
  if (!code) return null;
  return COUNTRY_IT[code.toUpperCase()] ?? code.toUpperCase();
}

export function buildMessage(
  contenuto: string,
  post: Record<string, any>,
  affiliateUrl: string,
  currency?: string,
  customTags: Record<string, string> = {},
  terminataValue?: string,
  maxTitleLen = 60,
): string {
  const now = new Date();
  const giorni = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
  const pad = (n: number) => n < 10 ? `0${n}` : String(n);
  const valuta = currency ?? (post.platform === 'aliexpress' ? '$' : '€');
  const discPrice = Number(post.discountedPrice).toFixed(2).replace('.', ',');
  const origPrice = Number(post.originalPrice).toFixed(2).replace('.', ',');
  const disc = Number(post.discountPercent);
  const titleShort = (post.title || '').length > maxTitleLen ? (post.title || '').slice(0, maxTitleLen - 3) + '...' : (post.title || '');

  const tags: Record<string, string> = {
    ...customTags,
    '{titolo}':          esc(post.title),
    '{titoloup}':        esc((post.title || '').toUpperCase()),
    '{titoloshort}':     esc(titleShort),
    '{prezzo}':          discPrice,
    '{prezzo_scontato}': discPrice,
    '{oldprezzo}':       origPrice,
    '{sconto}':          String(disc),
    '{perc}':            `-${disc}%`,
    '{valuta}':          valuta,
    '{link_affiliato}':  affiliateUrl,
    '{link}':            affiliateUrl,
    '{minimo_storico}':  post.isHistoricalLow ? (customTags['{minimo_storico}'] || '🏆 MINIMO STORICO!') : '',
    '{terminata}':       terminataValue ?? '',
    '{custom}':          esc(post.customText || ''),
    '{store}':           post.platform === 'amazon' ? 'Amazon' : 'AliExpress',
    '{storeup}':         post.platform === 'amazon' ? 'AMAZON' : 'ALIEXPRESS',
    '{countryflag}':     codeToFlag(post.shipFromCountry) ?? (post.platform === 'aliexpress' ? '' : '🇮🇹'),
    '{country}':         codeToCountryName(post.shipFromCountry) ?? (post.platform === 'aliexpress' ? '' : 'Italia'),
    '{countryup}':       (codeToCountryName(post.shipFromCountry) ?? (post.platform === 'aliexpress' ? '' : 'Italia')).toUpperCase(),
    '{giorno}':          giorni[now.getDay()],
    '{ora}':             `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    '{data}':            `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`,
    '{stelle}':          post.stelle || '',
    '{recensioni}':      post.recensioni || '',
    '{cat}':             post.cat || '',
    '{author}':          esc(post.author || ''),
    '{coupon}':          post.boxcoupon ? '' : (post.coupon || ''),
    '{boxcoupon}':       post.boxcoupon ? (customTags['{boxcoupon}'] || 'Abilita il coupon prima di acquistare') : '',
    '{checkout}':        post.checkout || '',
    '{emojicat}':        getProductEmoji(post.title || '', post.cat || ''),
  };

  const tagOverrides = (post.tagOverrides ?? {}) as Record<string, string>;
  for (const [tagName, val] of Object.entries(tagOverrides)) {
    if (!(tagName in tags)) tags[tagName] = val || '';
  }

  const SENTINEL = '\x01';
  const knownTagNames = new Set(Object.keys(tags));

  let t = contenuto;
  let prev = '';
  while (prev !== t) {
    prev = t;
    t = t.replace(/\{_((?:(?!\{_)[\s\S])*?)_\}/g, (_, inner) => {
      let hasEmpty = false;
      let resolved = inner;
      for (const [tag, val] of Object.entries(tags)) {
        if (inner.includes(tag)) {
          const valStr = typeof val === 'string' ? val : String(val ?? '');
          if (!valStr || valStr.trim() === '') hasEmpty = true;
          resolved = resolved.split(tag).join(val);
        }
      }
      const found = inner.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) ?? [];
      for (const tn of found) {
        if (!knownTagNames.has(tn)) { hasEmpty = true; break; }
      }
      return hasEmpty ? SENTINEL : resolved;
    });
  }

  for (const [tag, val] of Object.entries(tags)) {
    t = t.split(tag).join(val);
  }
  t = t.replace(/\{emoji_[a-zA-Z0-9_]+\}/g, '');
  t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  t = t.split('\n').filter(line => {
    if (!line.includes(SENTINEL)) return true;
    return line.replace(/\x01/g, '').trim() !== '';
  }).map(line => line.replace(/\x01/g, '')).join('\n');

  return t;
}
