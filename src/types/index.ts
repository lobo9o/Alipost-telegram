export type Platform = 'amazon' | 'aliexpress';
export type PostType = 'single' | 'multi';
export type PostStatus = 'draft' | 'scheduled' | 'published' | 'error';
export type LayoutType = 'normal' | 'historical_low' | 'multi' | 'aliexpress' | 'aliexpress_historical_low' | 'amazon';
export type NavPage = 'dash' | 'search' | 'newpost' | 'queue' | 'published' | 'layout' | 'settings' | 'monitor';

export interface LinkItem { id: string; url: string; platform: Platform; }

export type NewPostItem =
  | { id: string; type: 'single'; link: LinkItem }
  | { id: string; type: 'multi'; links: LinkItem[] }

export interface Tag {
  id: string;
  name: string;
  value: string;
}

export interface KeyboardLayout {
  id: string;
  nome: string;
  contenuto: string;
}

export interface CreatedPost {
  id: string;
  platform: Platform;
  sourceUrl: string;
  productId: string;
  title: string;
  image: string;
  originalPrice: number;
  discountedPrice: number;
  discountPercent: number;
  customText: string;
  isHistoricalLow: boolean;
  templateId: string;
  layoutId: string;
  keyboardId: string;
  emoji: string;
  // Dati extra da API (opzionali)
  stelle?: string;
  recensioni?: string;
  cat?: string;
  author?: string;
  coupon?: string;
  boxcoupon?: string;
  checkout?: string;
  tagOverrides?: Record<string, string>; // override per-post dei tag personalizzati
  generatedImage?: string; // base64 immagine con overlay, generata client-side per autopost
  shipFromCountry?: string; // codice ISO paese di spedizione (es. 'FR', 'CN')
}

export interface CatalogProduct {
  id: string;
  platform: Platform;
  emoji: string;
  title: string;
  originalPrice: number;
  discountedPrice: number;
  discountPercent: number;
}

export interface TextLayout {
  id: string;
  nome: string;
  tipo: LayoutType;
  contenuto: string;
  keyboardId?: string;
}

// ── Template elements ─────────────────────────────────────────

export interface ElementLayout {
  x: number;
  y: number;
  size: number;
}

export interface TextEl {
  enabled: boolean;
  x: number;
  y: number;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  color: string;
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidth: number;
  strikethrough: boolean;
  strikethroughColor: string;
  textAnchor: 'left' | 'right' | 'center';
  letterSpacing?: number;
  text: string;
  currencyPos?: 'before' | 'after';
  decimalFontScale?: number;
  decimalSep?: '.' | ',';
  hidePercent?: boolean;
  hideMinus?: boolean;
}

export interface ImgEl {
  enabled: boolean;
  x: number;
  y: number;
  size: number;
  src: string | null;
}

export interface Template {
  id: string;
  name?: string;
  canvasW: number;
  canvasH: number;
  bgColor: string;
  product: ElementLayout;
  overlay: ImgEl;
  badge: ImgEl;
  prezzo: TextEl;
  prezzoPrecedente: TextEl;
  sconto: TextEl;
  testoCustom: TextEl;
  storeAmazon: ImgEl;
  storeAliexpress: ImgEl;
}

// Helpers
const defText = (o: Partial<TextEl> = {}): TextEl => ({
  enabled: false, x: 5, y: 70, fontSize: 36,
  fontFamily: 'Impact', bold: false,
  color: '#ffffff', strokeEnabled: true, strokeColor: '#000000', strokeWidth: 3,
  strikethrough: false, strikethroughColor: '#ffffff',
  textAnchor: 'left', text: '',
  ...o,
});
const defImg = (o: Partial<ImgEl> = {}): ImgEl => ({
  enabled: false, x: 0, y: 0, size: 30, src: null, ...o,
});

export function makeDefaultTemplate(id = 'tpl1'): Template {
  return {
    id,
    canvasW: 1024,
    canvasH: 1024,
    bgColor: '#ffffff',
    product: { x: 5, y: 5, size: 90 },
    overlay: defImg({ size: 100 }),
    badge: defImg({ x: 3, y: 3, size: 22 }),
    prezzo: defText({ enabled: true, x: 5, y: 73, fontSize: 40, color: '#22c55e' }),
    prezzoPrecedente: defText({ enabled: true, x: 5, y: 82, fontSize: 26, color: '#9ca3af', strikethrough: true }),
    sconto: defText({ enabled: true, x: 60, y: 73, fontSize: 36, color: '#ef4444' }),
    testoCustom: defText({ enabled: false, x: 5, y: 90, fontSize: 22 }),
    storeAmazon:     defImg({ enabled: true, x: 3, y: 3, size: 20 }),
    storeAliexpress: defImg({ enabled: true, x: 3, y: 3, size: 20 }),
  };
}

// ── Other interfaces ──────────────────────────────────────────

export interface QueueItem {
  id: string;
  tipo: PostType;
  posts: CreatedPost[];
  sched: string;
  status: PostStatus;
  sel: boolean;
  silenzioso?: boolean; // undefined=usa soglia impostazioni, true=forza silenzioso, false=forza notifica
}

export interface PublishedMultiItem {
  id: string;
  title: string;
  emoji: string;
  image: string;
  price: string;
  originalPrice: number;
  discountPercent: number;
  platform: Platform;
  sourceUrl: string;
  productId: string;
  customText: string;
  layoutId: string;
  isHistoricalLow: boolean;
  coupon?: string;
  terminata?: boolean;
  resolvedText?: string;
}

export interface PublishedPost {
  id: string;
  emoji: string;
  title: string;
  price: string;
  originalPrice: number;
  discountPercent: number;
  platform: Platform;
  image: string;
  sourceUrl: string;
  productId: string;
  customText: string;
  layoutId: string;
  isHistoricalLow: boolean;
  chatId: string;
  messageId: number;
  publishedAt: string;
  ts: string;
  terminata?: boolean;
  isMulti?: boolean;
  multiItems?: PublishedMultiItem[];
  tagOverrides?: Record<string, string>;
}

export interface TerminataConfig {
  grayscale: boolean;
  overlayText: string;
  overlayTextColor: string;
  overlayTextSize: number;
  overlayTextX: number;
  overlayTextY: number;
  overlayTextFont: string;
  showPrezzo: boolean;
  showPrezzoPrecedente: boolean;
  showSconto: boolean;
  layoutId: string;
  telegramMode: 'keep' | 'append' | 'only';
  telegramText: string;
}

export interface AmazonSettings {
  enabled: boolean;
  affiliateTag: string;
  credentialId: string;
  credentialSecret: string;
  version: string;
  marketplace: string;
}

export interface AliExpressSettings {
  enabled: boolean;
  appKey: string;
  appSecret: string;
  trackingId: string;
  targetCountry: string;
}

export interface DealSearchAliSettings {
  keywords: string;
  minDiscount: number;
  minPrice: number;
  maxPrice: number;
  sort: string;
  deliveryDays: number; // 0 = tutti, 7 ≈ UE warehouse, 15 = veloce
  categoryIds: string;  // es. "44,509" — separati da virgola
}

export interface DealSearchAmazonSettings {
  keywords: string;
  minDiscount: number;
  maxDiscount: number;
  minPrice: number;
  maxPrice: number;
  sort: string;
  searchIndexes: string;
  brandKeywords?: string;   // comma-separated brand/keyword list for cache refresh
  minRating?: number;       // 0 = no filter, 1-5
  minReviews?: number;      // 0 = no filter
  merchantFilter?: string;  // 'all' | 'amazon'
}

export interface DealSearchSettings {
  autoPublishAliexpress: boolean;
  autoPublishAmazon: boolean;
  publishPattern: string;
  ali: DealSearchAliSettings;
  amazon?: DealSearchAmazonSettings;
  autoPublishSort?: 'discount' | 'score';
  scoreWeightDiscount?: number;  // 0-100
  scoreWeightRating?: number;    // 0-100
  scoreWeightReviews?: number;   // 0-100
  noDupeCategory?: boolean;
  autoMultiEvery?: number;
}

export interface AppSettings {
  oraI: string;
  oraF: string;
  interv: number;
  attivo: boolean;
  channels: string[];
  channelTemplates?: Record<string, string>;
  notifThreshold?: number; // sconto minimo % per pubblicare con notifica; undefined=sempre silenzioso
  amazon: AmazonSettings;
  aliexpress: AliExpressSettings;
  terminata: TerminataConfig;
  dealSearch: DealSearchSettings;
}

export interface AppState {
  createdPosts: CreatedPost[];
  queue: QueueItem[];
  published: PublishedPost[];
  tags: Tag[];
  layouts: TextLayout[];
  keyboards: KeyboardLayout[];
  templates: Template[];
  settings: AppSettings;
}

export interface AppContextType extends AppState {
  setCreatedPosts: React.Dispatch<React.SetStateAction<CreatedPost[]>>;
  setQueue: React.Dispatch<React.SetStateAction<QueueItem[]>>;
  setPublished: React.Dispatch<React.SetStateAction<PublishedPost[]>>;
  setTags: React.Dispatch<React.SetStateAction<Tag[]>>;
  setLayouts: React.Dispatch<React.SetStateAction<TextLayout[]>>;
  setKeyboards: React.Dispatch<React.SetStateAction<KeyboardLayout[]>>;
  setTemplates: React.Dispatch<React.SetStateAction<Template[]>>;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  stats: { inCoda: number; sched: number; pub: number };
  publishedCount: number;
  templateFromDB: React.MutableRefObject<boolean>;
  // stato persistente "Nuovo Post"
  newPostMode: 'single' | 'multi';
  setNewPostMode: React.Dispatch<React.SetStateAction<'single' | 'multi'>>;
  newPostItems: NewPostItem[];
  setNewPostItems: React.Dispatch<React.SetStateAction<NewPostItem[]>>;
  newPostEditingMultiId: string | null;
  setNewPostEditingMultiId: React.Dispatch<React.SetStateAction<string | null>>;
}
