import { AppSettings, Tag, TextLayout, Template, CreatedPost, QueueItem } from '../types';

const BASE = '';

function getTgInitData(): string {
  if (typeof window === 'undefined') return '';
  return (window as any).Telegram?.WebApp?.initData ?? '';
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  const initData = getTgInitData();
  if (initData) headers['x-tg-init-data'] = initData;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Settings ──────────────────────────────────────────────────────────────────
export const settingsApi = {
  get: () => req<AppSettings>('GET', '/api/settings'),
  save: (data: AppSettings) => req<{ ok: boolean }>('POST', '/api/settings', data),
};

// ── Tags ──────────────────────────────────────────────────────────────────────
export const tagsApi = {
  list: () => req<Tag[]>('GET', '/api/tags'),
  create: (tag: Tag) => req<Tag>('POST', '/api/tags', tag),
  update: (id: string, tag: Partial<Tag>) => req<Tag>('PUT', `/api/tags/${id}`, tag),
  delete: (id: string) => req<{ ok: boolean }>('DELETE', `/api/tags/${id}`),
};

// ── Layouts ───────────────────────────────────────────────────────────────────
export const layoutsApi = {
  list: () => req<TextLayout[]>('GET', '/api/layouts'),
  create: (layout: TextLayout) => req<TextLayout>('POST', '/api/layouts', layout),
  update: (id: string, layout: Partial<TextLayout>) => req<TextLayout>('PUT', `/api/layouts/${id}`, layout),
  delete: (id: string) => req<{ ok: boolean }>('DELETE', `/api/layouts/${id}`),
};

// ── Templates ─────────────────────────────────────────────────────────────────
export const templatesApi = {
  list: () => req<Template[]>('GET', '/api/templates'),
  create: (t: Template) => req<Template>('POST', '/api/templates', t),
  update: (id: string, t: Partial<Template>) => req<Template>('PUT', `/api/templates/${id}`, t),
  delete: (id: string) => req<{ ok: boolean }>('DELETE', `/api/templates/${id}`),
};

// ── Posts ─────────────────────────────────────────────────────────────────────
export const postsApi = {
  list: () => req<CreatedPost[]>('GET', '/api/posts'),
  create: (post: CreatedPost) => req<CreatedPost>('POST', '/api/posts', post),
  update: (id: string, post: Partial<CreatedPost>) => req<CreatedPost>('PUT', `/api/posts/${id}`, post),
  delete: (id: string) => req<{ ok: boolean }>('DELETE', `/api/posts/${id}`),
  publish: (id: string, payload: { post: CreatedPost; layoutContenuto?: string }) =>
    req<{ ok: boolean }>('POST', `/api/posts/${id}`, payload),
};

// ── Autopost Queue ────────────────────────────────────────────────────────────
export const autopostApi = {
  list: () => req<QueueItem[]>('GET', '/api/autopost'),
  create: (item: QueueItem) => req<QueueItem>('POST', '/api/autopost', item),
  update: (id: string, item: Partial<QueueItem>) => req<QueueItem>('PUT', `/api/autopost/${id}`, item),
  delete: (id: string) => req<{ ok: boolean }>('DELETE', `/api/autopost/${id}`),
  deleteAll: () => req<{ ok: boolean }>('DELETE', '/api/autopost'),
};

// ── Product fetch (via server — keeps API secrets safe) ───────────────────────
export interface AmazonProductResult {
  asin: string;
  title: string;
  image: string;
  originalPrice: number;
  discountedPrice: number;
  discountPercent: number;
  affiliateUrl: string;
}
export interface AliExpressProductResult {
  productId: string;
  title: string;
  image: string;
  originalPrice: number;
  discountedPrice: number;
  discountPercent: number;
  affiliateUrl: string;
}

export const productApi = {
  fetchAmazon: (payload: { asin?: string; url: string }) =>
    req<AmazonProductResult>('POST', '/api/product', { platform: 'amazon', ...payload }),
  fetchAliExpress: (payload: { url: string }) =>
    req<AliExpressProductResult>('POST', '/api/product', { platform: 'aliexpress', ...payload }),
};
