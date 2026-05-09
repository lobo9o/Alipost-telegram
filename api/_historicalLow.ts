import sql from '../lib/db.js';

// Controlla price_history per ogni post e imposta isHistoricalLow + layoutId automaticamente.
// Modifica i post in-place. Usato da index.ts e [id].ts prima di salvare in DB.
export async function checkAndMarkHistoricalLow(userId: string, posts: any[]): Promise<void> {
  const [hlLayout] = await sql`
    SELECT id FROM layouts WHERE user_id = ${userId} AND tipo = 'historical_low'
    ORDER BY created_at ASC LIMIT 1
  `.catch(() => [null]);

  for (const post of posts) {
    if (!post.productId || !(Number(post.discountedPrice) > 0)) continue;
    const platform = post.platform ?? 'amazon';
    const [histRow] = await sql`
      SELECT MIN(price)::float AS min_price, COUNT(*)::int AS cnt
      FROM price_history WHERE product_id = ${post.productId} AND platform = ${platform}
    `.catch(() => [null]);
    if (histRow && Number(histRow.cnt) > 0 && Number(post.discountedPrice) <= Number(histRow.min_price)) {
      post.isHistoricalLow = true;
      if (hlLayout?.id) post.layoutId = String(hlLayout.id);
    } else {
      post.isHistoricalLow = false;
    }
  }
}
