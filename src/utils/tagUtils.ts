import { Tag, CreatedPost } from '../types';

// Tag di sistema — non modificabili/eliminabili dall'utente
export const SYSTEM_TAGS = new Set([
  '{titolo}', '{titoloup}', '{titoloshort}',
  '{prezzo}', '{prezzo_scontato}', '{oldprezzo}',
  '{sconto}', '{perc}', '{valuta}',
  '{link_affiliato}', '{link}',
  '{minimo_storico}',
  '{custom}',
  '{store}', '{storeup}', '{countryflag}',
  '{giorno}', '{ora}', '{data}',
  '{stelle}', '{recensioni}', '{cat}', '{author}',
  '{coupon}', '{boxcoupon}', '{checkout}',
]);

function pad(n: number): string { return n < 10 ? `0${n}` : String(n); }

function computedTags(post: CreatedPost): Record<string, string> {
  const now = new Date();
  const giorni = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
  const valuta = post.platform === 'aliexpress' ? '$' : '€';
  const flag = post.platform === 'aliexpress' ? '🇨🇳' : '🇮🇹';
  const titleShort = post.title.length > 60 ? post.title.slice(0, 57) + '...' : post.title;

  return {
    '{titolo}':          post.title,
    '{titoloup}':        post.title.toUpperCase(),
    '{titoloshort}':     titleShort,
    // {prezzo} = solo numero, {valuta} = simbolo — si usano insieme: {prezzo}{valuta}
    '{prezzo}':          post.discountedPrice.toFixed(2),
    '{prezzo_scontato}': post.discountedPrice.toFixed(2),
    '{oldprezzo}':       post.originalPrice.toFixed(2),
    '{sconto}':          `${post.discountPercent}`,
    '{perc}':            `-${post.discountPercent}%`,
    '{valuta}':          valuta,
    '{link_affiliato}':  post.sourceUrl || '[link]',
    '{link}':            post.sourceUrl || '[link]',
    '{minimo_storico}':  post.isHistoricalLow ? '🏆 Minimo Storico!' : '',
    '{custom}':          post.customText || '',
    '{store}':           post.platform === 'amazon' ? 'Amazon' : 'AliExpress',
    '{storeup}':         post.platform === 'amazon' ? 'AMAZON' : 'ALIEXPRESS',
    '{countryflag}':     flag,
    '{giorno}':          giorni[now.getDay()],
    '{ora}':             `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    '{data}':            `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`,
    '{stelle}':          post.stelle || '',
    '{recensioni}':      post.recensioni || '',
    '{cat}':             post.cat || '',
    '{author}':          post.author || '',
    '{coupon}':          post.coupon || '',
    '{boxcoupon}':       post.coupon || '',
    '{checkout}':        '',
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

export function resolvePostTags(template: string, post: CreatedPost, tags: Tag[]): string {
  const builtIn = computedTags(post);

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
      for (const tag of tags) {
        if (!builtIn[tag.name] && inner.includes(tag.name) && (!tag.value || tag.value.trim() === '')) {
          hasEmpty = true;
        }
      }
      // Tag sconosciuti (non built-in né custom) = vuoti → nascondi il blocco
      const knownTags = new Set([...Object.keys(builtIn), ...tags.map(t => t.name)]);
      const found = inner.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) ?? [];
      for (const t of found) {
        if (!knownTags.has(t)) { hasEmpty = true; break; }
      }
      return hasEmpty ? '' : applyTags(inner, builtIn, tags);
    });
  }

  return applyTags(result, builtIn, tags);
}
