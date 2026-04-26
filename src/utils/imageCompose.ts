import { Template, ElementLayout, DEFAULT_PRODUCT_POS, DEFAULT_OVERLAY_POS, DEFAULT_BADGE_POS } from '../types';

const CANVAS_SIZE = 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawContained(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  pos: ElementLayout,
) {
  const x = (pos.x / 100) * CANVAS_SIZE;
  const y = (pos.y / 100) * CANVAS_SIZE;
  const box = (pos.size / 100) * CANVAS_SIZE;
  const ratio = Math.min(box / img.naturalWidth, box / img.naturalHeight);
  const dw = img.naturalWidth * ratio;
  const dh = img.naturalHeight * ratio;
  ctx.drawImage(img, x + (box - dw) / 2, y + (box - dh) / 2, dw, dh);
}

export async function generatePostImage(
  template: Template,
  productImageUrl: string,
  isHistoricalLow: boolean,
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d')!;

  // Layer 1 — background
  ctx.fillStyle = template.bgColor || '#ffffff';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // Layer 2 — product image (via CORS proxy to avoid canvas taint)
  if (productImageUrl && productImageUrl.startsWith('http')) {
    try {
      const proxied = `/api/posts?img=${encodeURIComponent(productImageUrl)}`;
      const img = await loadImage(proxied);
      drawContained(ctx, img, template.productPos || DEFAULT_PRODUCT_POS);
    } catch { /* skip if image fails */ }
  }

  // Layer 3 — overlay PNG
  if (template.overlay) {
    try {
      const img = await loadImage(template.overlay);
      const pos = template.overlayPos || DEFAULT_OVERLAY_POS;
      const x = (pos.x / 100) * CANVAS_SIZE;
      const y = (pos.y / 100) * CANVAS_SIZE;
      const s = (pos.size / 100) * CANVAS_SIZE;
      ctx.drawImage(img, x, y, s, s);
    } catch { /* skip */ }
  }

  // Layer 4 — badge icon (only when isHistoricalLow and badgeEnabled)
  if (template.badgeEnabled && template.badgeIcon && isHistoricalLow) {
    try {
      const img = await loadImage(template.badgeIcon);
      const pos = template.badgePos || DEFAULT_BADGE_POS;
      const x = (pos.x / 100) * CANVAS_SIZE;
      const y = (pos.y / 100) * CANVAS_SIZE;
      const w = (pos.size / 100) * CANVAS_SIZE;
      const h = (img.naturalHeight / img.naturalWidth) * w;
      ctx.drawImage(img, x, y, w, h);
    } catch { /* skip */ }
  }

  return canvas.toDataURL('image/jpeg', 0.88);
}
