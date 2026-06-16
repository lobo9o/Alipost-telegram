import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from './_utils.js';

const ALI_CURRENCY_SYM: Record<string, string> = {
  IT: '€', DE: '€', FR: '€', ES: '€', NL: '€', PL: 'zł',
  US: '$', UK: '£', RU: '₽', BR: 'R$',
};

async function generateComposite(
  imageUrls: string[],
  opts: {
    barEnabled?: boolean; barSrc?: string | null; barHeight?: number;
    priceEnabled?: boolean; prices?: string[]; priceBgColor?: string; priceTextColor?: string; priceHeight?: number; fontFamily?: string;
  } = {}
): Promise<string | null> {
  const validUrls = imageUrls.filter(u => u && String(u).startsWith('http'));
  const n = validUrls.length;
  if (n === 0) return null;
  try {
    const sharpMod = await import('sharp').catch(() => null) as any;
    if (!sharpMod) return null;
    const sharp = (sharpMod.default ?? sharpMod) as any;
    const cols = n <= 3 ? n : n <= 4 ? 2 : 3;
    const rows = Math.ceil(n / cols);
    const cellSize = Math.round(1024 / cols);
    const barH   = opts.barEnabled   ? Math.max(30, Math.min(120, Number(opts.barHeight   ?? 60))) : 0;
    const priceH = opts.priceEnabled ? Math.max(24, Math.min(64,  Number(opts.priceHeight ?? 36))) : 0;
    const canvasW = cellSize * cols;
    const canvasH = barH + (cellSize + priceH) * rows;
    const PAD = 4;
    const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const base = await sharp({ create: { width: canvasW, height: canvasH, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
    const composites: any[] = [];

    if (barH > 0 && opts.barSrc) {
      try {
        const b64 = opts.barSrc.includes(',') ? opts.barSrc.split(',')[1] : opts.barSrc;
        const barBuf = Buffer.from(b64, 'base64');
        const resizedBar = await sharp(barBuf).resize(canvasW, barH, { fit: 'fill' }).toBuffer();
        composites.push({ input: resizedBar, left: 0, top: 0 });
      } catch { /* skip */ }
    }

    for (let i = 0; i < validUrls.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const itemsInRow = Math.min(cols, validUrls.length - row * cols);
      const rowOffsetX = Math.floor(((cols - itemsInRow) * cellSize) / 2);
      const cellX = rowOffsetX + col * cellSize;
      const cellY = barH + row * (cellSize + priceH);
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(validUrls[i], { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
        clearTimeout(t);
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        const availW = cellSize - PAD * 2;
        const availH = cellSize - PAD * 2;
        const { data, info } = await sharp(buf).resize(availW, availH, { fit: 'inside' }).toBuffer({ resolveWithObject: true });
        composites.push({ input: data, left: cellX + PAD + Math.round((availW - info.width) / 2), top: cellY + PAD + Math.round((availH - info.height) / 2) });

        if (priceH > 0) {
          const priceText = opts.prices?.[i] ?? '';
          const priceBg  = opts.priceBgColor  ?? '#1a1a1a';
          const priceTxt = opts.priceTextColor ?? '#ffffff';
          const pfs = Math.round(Math.min(priceH * 0.9, cellSize * 0.10));
          const pFont = escXml(opts.fontFamily ?? 'Arial');
          const cellW = cellSize;
          const svgPrice = `<svg xmlns="http://www.w3.org/2000/svg" width="${cellW}" height="${priceH}">
            <rect width="${cellW}" height="${priceH}" fill="${escXml(priceBg)}"/>
            ${priceText ? `<text x="${cellW / 2}" y="${Math.round(priceH * 0.75)}" font-family="${pFont}" font-size="${pfs}px" font-weight="bold" fill="${escXml(priceTxt)}" text-anchor="middle">${escXml(priceText)}</text>` : ''}
          </svg>`;
          composites.push({ input: Buffer.from(svgPrice), left: cellX, top: cellY + cellSize });
        }
      } catch { /* skip */ }
    }

    const result = await sharp(base).composite(composites).jpeg({ quality: 88 }).toBuffer();
    return `data:image/jpeg;base64,${result.toString('base64')}`;
  } catch { return null; }
}

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['POST'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;
  const baseUserId = userId.includes(':') ? userId.split(':')[0] : userId;

  const { imageUrls, multiPosts, templateId } = req.body ?? {};
  if (!Array.isArray(imageUrls) || imageUrls.length < 2) {
    res.status(400).json({ error: 'imageUrls required (min 2)' }); return;
  }

  // Carica template dal DB
  const [tplRow] = templateId && templateId !== 'tpl1'
    ? await sql`SELECT config FROM templates WHERE id = ${templateId} AND (user_id = ${baseUserId} OR user_id = ${userId}) LIMIT 1`.catch(() => [null])
    : await sql`SELECT config FROM templates WHERE (user_id = ${baseUserId} OR user_id = ${userId}) ORDER BY (user_id = ${userId}) DESC, updated_at DESC NULLS LAST LIMIT 1`.catch(() => [null]);
  const tplCfg = tplRow ? (typeof tplRow.config === 'string' ? JSON.parse(tplRow.config) : (tplRow.config ?? {})) : null;
  const mb  = (tplCfg?.multiBar   ?? {}) as Record<string, any>;
  const mpr = (tplCfg?.multiPrice ?? {}) as Record<string, any>;

  // Carica settings per valuta AliExpress
  const [settingsRow] = await sql`SELECT data FROM settings WHERE user_id = ${userId}`.catch(() => [null]);
  const cfg = settingsRow ? (typeof settingsRow.data === 'string' ? JSON.parse(settingsRow.data) : (settingsRow.data ?? {})) : {};

  const multiPostsArr: any[] = Array.isArray(multiPosts) ? multiPosts : [];
  const prices = multiPostsArr.map((mp: any) => {
    const price = Number(mp.discountedPrice ?? 0);
    if (price <= 0) return '';
    const sym = mp.platform === 'aliexpress'
      ? (ALI_CURRENCY_SYM[(cfg.aliexpress?.targetCountry ?? '').toUpperCase()] ?? '€') : '€';
    return `${sym}${price.toFixed(2).replace('.', ',')}`;
  });

  const image = await generateComposite(imageUrls, {
    barEnabled:    !!mb.enabled,
    barSrc:        mb.src ?? null,
    barHeight:     Number(mb.height   ?? 60),
    priceEnabled:  !!mpr.enabled,
    prices,
    priceBgColor:  String(mpr.bgColor   ?? '#1a1a1a'),
    priceTextColor: String(mpr.textColor ?? '#ffffff'),
    priceHeight:   Number(mpr.height    ?? 36),
    fontFamily:    String(mpr.fontFamily ?? 'Arial'),
  });

  if (!image) { res.status(500).json({ error: 'generazione fallita' }); return; }
  res.json({ image });
});
