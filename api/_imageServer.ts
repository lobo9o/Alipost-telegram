export async function generateTerminataImageServer(
  imageSource: string | Buffer,
  config: Record<string, any>,
): Promise<Buffer> {
  const sharpMod = await import('sharp').catch(() => null) as any;
  if (!sharpMod) throw new Error('sharp non installato — esegui: npm install sharp');
  const sharp = (sharpMod.default ?? sharpMod) as any;

  let imgBuf: Buffer;
  if (Buffer.isBuffer(imageSource)) {
    imgBuf = imageSource;
  } else {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const r = await fetch(imageSource, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
      clearTimeout(timer);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      imgBuf = Buffer.from(await r.arrayBuffer());
    } catch (e) { clearTimeout(timer); throw e; }
  }

  const { width: imgW = 1024, height: imgH = 1024 } = await sharp(imgBuf).metadata();

  let pipeline = sharp(imgBuf);
  if (config.grayscale !== false) pipeline = pipeline.grayscale();
  const step1 = await pipeline.jpeg({ quality: 95 }).toBuffer();

  if (!config.overlayText) return step1;

  // Usa la larghezza come riferimento, uguale all'anteprima (containerW = larghezza immagine)
  const refSize = imgW;
  const fs  = Math.round(((Number(config.overlayTextSize) || 7) / 100) * refSize);
  const tx  = Math.round(((Number(config.overlayTextX)    || 50) / 100) * imgW);
  const ty  = Math.round(((Number(config.overlayTextY)    || 50) / 100) * imgH);
  const sw  = Math.round(fs * 0.08);
  const col = String(config.overlayTextColor ?? '#ff0000');
  const rawTxt = String(config.overlayText);

  const canvasMod = await import('canvas').catch(() => null) as any;
  if (canvasMod) {
    const { createCanvas, loadImage } = canvasMod.default ?? canvasMod;
    const canvas = createCanvas(imgW, imgH);
    const ctx = canvas.getContext('2d');
    const baseImg = await loadImage(step1);
    ctx.drawImage(baseImg, 0, 0, imgW, imgH);
    ctx.save();
    ctx.font = `bold ${fs}px Impact, "Noto Color Emoji", "Segoe UI Emoji", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = sw;
    ctx.lineJoin = 'round';
    ctx.strokeText(rawTxt, tx, ty);
    ctx.fillStyle = col;
    ctx.fillText(rawTxt, tx, ty);
    ctx.restore();
    return canvas.toBuffer('image/jpeg', { quality: 0.88 });
  }

  // Fallback SVG: mantieni il testo originale (incluse emoji), escape solo caratteri XML speciali
  const txt = rawTxt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
  if (!txt) return step1;
  const svg = Buffer.from(
    `<svg width="${imgW}" height="${imgH}" xmlns="http://www.w3.org/2000/svg">` +
    `<text x="${tx}" y="${ty}" font-family="Impact,'Noto Color Emoji','Noto Emoji','Segoe UI Emoji',Arial Black,sans-serif"` +
    ` font-size="${fs}" font-weight="bold" fill="${col}"` +
    ` stroke="#000" stroke-width="${sw}" stroke-linejoin="round" paint-order="stroke fill"` +
    ` text-anchor="middle" dominant-baseline="middle">${txt}</text>` +
    `</svg>`,
  );
  return sharp(step1).composite([{ input: svg, blend: 'over' }]).jpeg({ quality: 88 }).toBuffer();
}
