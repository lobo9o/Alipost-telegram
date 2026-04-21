import { Tag, CreatedPost } from '../types';

export function resolvePostTags(template: string, post: CreatedPost, tags: Tag[]): string {
  let result = template;

  const builtIn: Record<string, string> = {
    '{titolo}': post.title,
    '{prezzo}': `€${post.originalPrice.toFixed(2)}`,
    '{prezzo_scontato}': `€${post.discountedPrice.toFixed(2)}`,
    '{sconto}': `${post.discountPercent}%`,
    '{custom}': post.customText,
    '{link_affiliato}': post.sourceUrl || '[link]',
    '{minimo_storico}': post.isHistoricalLow ? '🏆 Minimo Storico!' : '',
  };

  for (const [tag, val] of Object.entries(builtIn)) {
    result = result.split(tag).join(val);
  }

  for (const tag of tags) {
    if (!builtIn[tag.name]) {
      result = result.split(tag.name).join(tag.value || '');
    }
  }

  return result;
}
