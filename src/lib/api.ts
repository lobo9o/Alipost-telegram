import { AppSettings, Tag, TextLayout, KeyboardLayout, Template, CreatedPost, QueueItem, PublishedPost } from '../types';

const BASE = '';

function getTgInitData(): string {
  if (typeof window === 'undefined') return '';
  return (window as any).Telegram?.WebApp?.initData ?? '';
}

let _activeProfileId: string | null = null;
export function setApiProfileId(id: string | null) { _activeProfileId = id; }

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  const initData = getTgInitData();
  if (initData) headers['x-tg-init-data'] = initData;
  if (_activeProfileId) headers['x-profile-id'] = _activeProfileId;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = `HTTP ${res.status}`;
    try {
      const json = JSON.parse(text);
      msg = json.error || json.message || msg;
    } catch {
      if (text) msg = text.slice(0, 120);
    }
    throw new Error(msg);
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

// ── Keyboard Layouts ──────────────────────────────────────────────────────────
export const keyboardsApi = {
  list: () => req<KeyboardLayout[]>('GET', '/api/keyboards'),
  create: (kb: KeyboardLayout) => req<KeyboardLayout>('POST', '/api/keyboards', kb),
  update: (id: string, kb: Partial<KeyboardLayout>) => req<KeyboardLayout>('PUT', `/api/keyboards/${id}`, kb),
  delete: (id: string) => req<{ ok: boolean }>('DELETE', `/api/keyboards/${id}`),
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
  publish: (id: string, payload: { post: CreatedPost; layoutContenuto?: string; keyboardContenuto?: string; generatedImage?: string; multiImageUrls?: string[]; multiPosts?: CreatedPost[]; disableNotification?: boolean; channelOverride?: string }) =>
    req<{ ok: boolean; messageId?: number; chatId?: string }>('POST', `/api/posts/${id}`, payload),
};

// ── Autopost Queue ────────────────────────────────────────────────────────────
export const autopostApi = {
  list: () => req<QueueItem[]>('GET', '/api/autopost'),
  create: (item: QueueItem) => req<QueueItem>('POST', '/api/autopost', item),
  update: (id: string, item: Partial<QueueItem>) => req<QueueItem>('PUT', `/api/autopost/${id}`, item),
  delete: (id: string) => req<{ ok: boolean }>('DELETE', `/api/autopost/${id}`),
  deleteAll: () => req<{ ok: boolean }>('DELETE', '/api/autopost'),
};

// ── Published Posts ───────────────────────────────────────────────────────────
export const publishedApi = {
  listToday: () => req<PublishedPost[]>('GET', '/api/posts?view=published'),
  save: (p: PublishedPost) => req<PublishedPost>('POST', '/api/posts?view=published', p),
  editTelegram: (id: string, payload: { customText?: string; layoutContenuto?: string; terminata?: boolean }) =>
    req<{ ok: boolean }>('PATCH', `/api/posts/${id}`, payload),
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
  stelle?: string;
  recensioni?: string;
  author?: string;
  cat?: string;
  coupon?: string;
  couponBox?: boolean;
  checkout?: string;
  priceWarning?: string;
  isHistoricalLow?: boolean;
  emoji?: string;
}
export interface AliExpressProductResult {
  productId: string;
  title: string;
  image: string;
  originalPrice: number;
  discountedPrice: number;
  discountPercent: number;
  affiliateUrl: string;
  isHistoricalLow?: boolean;
  shipFromCountry?: string;
  emoji?: string;
}

export const productApi = {
  fetchAmazon: (payload: { asin?: string; url: string }) =>
    req<AmazonProductResult>('POST', '/api/product', { platform: 'amazon', ...payload }),
  fetchAliExpress: (payload: { url: string }) =>
    req<AliExpressProductResult>('POST', '/api/product', { platform: 'aliexpress', ...payload }),
};

export const utilsApi = {
  resolveUrl: (url: string) => req<{ resolved: string }>('POST', '/api/resolve-url', { url }),
};

// ── Deal Search ───────────────────────────────────────────────────────────────
export interface DealProduct {
  productId: string;
  title: string;
  image: string;
  originalPrice: number;
  discountedPrice: number;
  discountPercent: number;
  currency: string;
  category: string;
  rating: string;
  url: string;
  affiliateUrl: string;
  shipFromCountry?: string;
  reviewRating?: number;
  reviewCount?: number;
  brandKeyword?: string;
}

export interface DealsResult {
  products: DealProduct[];
  total: number;
  page: number;
}

export const dealsApi = {
  searchAli: (params: {
    keywords?: string;
    minDiscount?: number;
    minPrice?: number;
    maxPrice?: number;
    sort?: string;
    deliveryDays?: number;
    categoryIds?: string;
    page?: number;
    minRating?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params.keywords)                qs.set('keywords',     params.keywords);
    if (params.minDiscount)             qs.set('minDiscount',  String(params.minDiscount));
    if (params.minPrice)                qs.set('minPrice',     String(params.minPrice));
    if (params.maxPrice)                qs.set('maxPrice',     String(params.maxPrice));
    if (params.sort)                    qs.set('sort',         params.sort);
    if (params.deliveryDays)            qs.set('deliveryDays', String(params.deliveryDays));
    if (params.categoryIds)             qs.set('categoryIds',  params.categoryIds);
    if (params.page && params.page > 1) qs.set('page',         String(params.page));
    if (params.minRating)               qs.set('minRating',    String(params.minRating));
    return req<DealsResult>('GET', `/api/deals?${qs.toString()}`);
  },

  searchAmazon: (params: {
    keywords?: string;
    minDiscount?: number;
    maxDiscount?: number;
    minPrice?: number;
    maxPrice?: number;
    sort?: string;
    searchIndexes?: string;
    page?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params.keywords)                qs.set('keywords',      params.keywords);
    if (params.minDiscount)             qs.set('minDiscount',   String(params.minDiscount));
    if (params.maxDiscount)             qs.set('maxDiscount',   String(params.maxDiscount));
    if (params.minPrice)                qs.set('minPrice',      String(params.minPrice));
    if (params.maxPrice)                qs.set('maxPrice',      String(params.maxPrice));
    if (params.sort)                    qs.set('sort',          params.sort);
    if (params.searchIndexes)           qs.set('searchIndexes', params.searchIndexes);
    if (params.page && params.page > 1) qs.set('page',          String(params.page));
    return req<DealsResult>('GET', `/api/amazon-deals?${qs.toString()}`);
  },
};

export interface DealsCache {
  products: DealProduct[];
  total: number;
  refreshedAt: string | null;
}

export const dealsCacheApi = {
  listAmazon: (params?: {
    minDiscount?: number; maxDiscount?: number; searchIndexes?: string;
    minRating?: number; minReviews?: number; merchantFilter?: string;
  }) => {
    const qs = new URLSearchParams({ platform: 'amazon' });
    if (params?.minDiscount)    qs.set('minDiscount',    String(params.minDiscount));
    if (params?.maxDiscount)    qs.set('maxDiscount',    String(params.maxDiscount));
    if (params?.searchIndexes)  qs.set('searchIndexes',  params.searchIndexes);
    if (params?.minRating)      qs.set('minRating',      String(params.minRating));
    if (params?.minReviews)     qs.set('minReviews',     String(params.minReviews));
    if (params?.merchantFilter && params.merchantFilter !== 'all') qs.set('merchantFilter', params.merchantFilter);
    return req<DealsCache>('GET', `/api/deals-cache?${qs.toString()}`);
  },
  refresh: () => req<{ ok: boolean; message: string }>('POST', '/api/deals-cache'),
  clearAmazon: () => req<{ ok: boolean }>('DELETE', '/api/deals-cache?platform=amazon'),
};


export interface EmojiEntry { emoji_char: string; custom_emoji_id: string; }
export const emojiIdsApi = {
  list: () => req<{ emoji: EmojiEntry[] }>('GET', '/api/emoji-ids'),
  discover: () => req<{ discovered: number; emoji: EmojiEntry[] }>('POST', '/api/emoji-ids', { action: 'discover' }),
  fromPack: (pack_name: string) => req<{ imported: number; total_in_pack: number; pack_title: string; emoji: EmojiEntry[] }>('POST', '/api/emoji-ids', { action: 'from_pack', pack_name }),
  add: (emoji_char: string, custom_emoji_id: string) => req<{ ok: boolean }>('POST', '/api/emoji-ids', { emoji_char, custom_emoji_id }),
  remove: (emoji_char: string) => req<{ ok: boolean }>('DELETE', '/api/emoji-ids', { emoji_char }),
};

// ── Channel Info (foto + nome canale) ────────────────────────────────────────
export interface ChannelInfo { title: string; photoUrl: string | null; username?: string; }
export const channelInfoApi = {
  get: (channelId: string) => req<ChannelInfo>('GET', `/api/channel-info?channelId=${encodeURIComponent(channelId)}`),
};

// ── Telegram Monitor ─────────────────────────────────────────────────────────
export interface TgMonitorChannel { id: string; channel: string; active: boolean; auto_publish: boolean; dest_channel?: string | null; }
export const tgMonitorApi = {
  status: () => req<{ status: string; phone: string | null }>('GET', '/api/tg-monitor/auth'),
  sendCode: (phone: string) => req<{ codeSent: boolean }>('POST', '/api/tg-monitor/auth', { action: 'sendCode', phone }),
  signIn: (code: string) => req<{ ok?: boolean; need2FA?: boolean }>('POST', '/api/tg-monitor/auth', { action: 'signIn', code }),
  confirm2FA: (password: string) => req<{ ok: boolean }>('POST', '/api/tg-monitor/auth', { action: 'confirm2FA', password }),
  signOut: () => req<{ ok: boolean }>('POST', '/api/tg-monitor/auth', { action: 'signOut' }),
  listChannels: () => req<TgMonitorChannel[]>('GET', '/api/tg-monitor/channels'),
  addChannel: (channel: string) => req<{ ok: boolean; id: string }>('POST', '/api/tg-monitor/channels', { channel }),
  removeChannel: (id: string) => req<{ ok: boolean }>('DELETE', `/api/tg-monitor/channels/${id}`),
  updateChannel: (id: string, data: Partial<Pick<TgMonitorChannel, 'auto_publish' | 'active'>> & { dest_channel?: string | null }) => req<{ ok: boolean }>('PATCH', `/api/tg-monitor/channels/${id}`, data),
};

