import { Tag, CreatedPost } from '../types';

// Tag di sistema — non modificabili/eliminabili dall'utente
export const SYSTEM_TAGS = new Set([
  '{titolo}', '{titoloup}', '{titoloshort}',
  '{prezzo}', '{prezzo_scontato}', '{oldprezzo}',
  '{sconto}', '{perc}', '{valuta}',
  '{link_affiliato}', '{link}',
  '{minimo_storico}',
  '{custom}',
  '{store}', '{storeup}', '{countryflag}', '{country}', '{countryup}',
  '{giorno}', '{ora}', '{data}',
  '{stelle}', '{recensioni}', '{cat}', '{author}',
  '{coupon}', '{boxcoupon}',
]);

// Sentinel usato internamente: riga che conteneva solo un blocco {_ _} vuoto → verrà rimossa
const SENTINEL = '\x01';

function pad(n: number): string { return n < 10 ? `0${n}` : String(n); }

const ALI_CURRENCY_SYM: Record<string, string> = {
  IT: '€', DE: '€', FR: '€', ES: '€', NL: '€',
  US: '$', BR: 'R$', UK: '£', RU: '₽', PL: 'zł',
};

export function aliCurrencySym(country: string): string {
  return ALI_CURRENCY_SYM[country.toUpperCase()] ?? '€';
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
  ZA: 'Sudafrica', NG: 'Nigeria', PK: 'Pakistan', BD: 'Bangladesh',
};

export function codeToFlag(code: string): string {
  if (!code || code.length !== 2) return '🌍';
  return [...code.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');
}

export function codeToCountry(code: string): string {
  if (!code) return '';
  const flag = codeToFlag(code);
  const name = COUNTRY_IT[code.toUpperCase()];
  return name ? `${flag} ${name}` : flag;
}

function computedTags(post: CreatedPost, currency?: string, minimoStoricoText?: string): Record<string, string> {
  const now = new Date();
  const giorni = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
  const valuta = currency ?? (post.platform === 'aliexpress' ? '$' : '€');
  const shipCode = post.shipFromCountry?.toUpperCase();
  const flag = shipCode ? codeToFlag(shipCode) : (post.platform === 'aliexpress' ? '' : '🇮🇹');
  const countryName = shipCode
    ? (COUNTRY_IT[shipCode] ?? shipCode)
    : (post.platform === 'aliexpress' ? '' : 'Italia');
  const titleShort = post.title.length > 60 ? post.title.slice(0, 57) + '...' : post.title;

  return {
    '{titolo}':          post.title,
    '{titoloup}':        post.title.toUpperCase(),
    '{titoloshort}':     titleShort,
    '{prezzo}':          post.discountedPrice.toFixed(2),
    '{prezzo_scontato}': post.discountedPrice.toFixed(2),
    '{oldprezzo}':       post.originalPrice.toFixed(2),
    '{sconto}':          `${post.discountPercent}`,
    '{perc}':            `-${post.discountPercent}%`,
    '{valuta}':          valuta,
    '{link_affiliato}':  post.sourceUrl || '[link]',
    '{link}':            post.sourceUrl || '[link]',
    '{minimo_storico}':  post.isHistoricalLow ? (minimoStoricoText || '🏆 Minimo Storico!') : '',
    '{custom}':          post.customText || '',
    '{store}':           post.platform === 'amazon' ? 'Amazon' : 'AliExpress',
    '{storeup}':         post.platform === 'amazon' ? 'AMAZON' : 'ALIEXPRESS',
    '{countryflag}':     flag,
    '{country}':         countryName,
    '{countryup}':       countryName.toUpperCase(),
    '{giorno}':          giorni[now.getDay()],
    '{ora}':             `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    '{data}':            `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`,
    '{stelle}':          post.stelle || '',
    '{recensioni}':      post.recensioni || '',
    '{cat}':             post.cat || '',
    '{author}':          post.author || '',
    '{coupon}':          post.coupon || '',
    '{boxcoupon}':       post.boxcoupon || '',

  };
}

function applyTags(text: string, builtIn: Record<string, string>, customTags: Tag[]): string {
  let t = text;
  for (const [tag, val] of Object.entries(builtIn)) {
    t = t.split(tag).join(val);
  }
  for (const tag of customTags) {
    if (!builtIn[tag.name]) {
      t = t.split(tag.name).join(tag.value || '');
    }
  }
  return t;
}

// Rimuove le righe che contengono solo sentinel (blocco condizionale vuoto su riga propria).
// I sentinel inline (su riga con altro contenuto) vengono semplicemente eliminati.
function cleanupSentinels(text: string): string {
  return text
    .split('\n')
    .filter(line => {
      if (!line.includes(SENTINEL)) return true;
      // Linea con sentinel: la rimuoviamo solo se, tolto il sentinel, la riga è vuota
      return line.replace(/\x01/g, '').trim() !== '';
    })
    .map(line => line.replace(/\x01/g, ''))
    .join('\n');
}

export function resolvePostTags(template: string, post: CreatedPost, tags: Tag[], currency?: string): string {
  const minimoCustom = tags.find(t => t.name === '{minimo_storico}')?.value || undefined;
  const builtIn = computedTags(post, currency, minimoCustom);
  // Override per-post: i tagOverrides del post hanno priorità sui valori globali dei tag custom
  const effectiveTags = tags.map(t =>
    post.tagOverrides?.[t.name] !== undefined
      ? { ...t, value: post.tagOverrides![t.name] }
      : t
  );
  // Aggiungi in effectiveTags anche i tagOverrides per tag non presenti nell'array globale
  if (post.tagOverrides) {
    for (const [tagName, val] of Object.entries(post.tagOverrides)) {
      if (!builtIn[tagName] && !effectiveTags.some(t => t.name === tagName)) {
        effectiveTags.push({ id: tagName, name: tagName, value: val });
      }
    }
  }
  const knownTags = new Set([...Object.keys(builtIn), ...effectiveTags.map(t => t.name)]);

  // Blocchi condizionali annidati {_ ... _}: elabora dall'interno verso l'esterno
  let result = template;
  let prev = '';
  while (prev !== result) {
    prev = result;
    result = result.replace(/\{_((?:(?!\{_)[\s\S])*?)_\}/g, (_, inner) => {
      let hasEmpty = false;
      for (const [tag, val] of Object.entries(builtIn)) {
        if (inner.includes(tag) && (!val || val.trim() === '')) hasEmpty = true;
      }
      for (const tag of effectiveTags) {
        if (!builtIn[tag.name] && inner.includes(tag.name) && (!tag.value || tag.value.trim() === '')) {
          hasEmpty = true;
        }
      }
      // Tag sconosciuti (non built-in né custom) = vuoti → nascondi il blocco
      const found = inner.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) ?? [];
      for (const t of found) {
        if (!knownTags.has(t)) { hasEmpty = true; break; }
      }
      // Usa sentinel invece di '': permette di rilevare e rimuovere la riga intera
      return hasEmpty ? SENTINEL : applyTags(inner, builtIn, effectiveTags);
    });
  }

  result = applyTags(result, builtIn, effectiveTags);
  // Stessa conversione del server: ~~testo~~ → <s>testo</s>
  result = result.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  return cleanupSentinels(result);
}
