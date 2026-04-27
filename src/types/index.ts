export type Platform = 'amazon' | 'aliexpress';
export type PostType = 'single' | 'multi';
export type PostStatus = 'draft' | 'scheduled' | 'published' | 'error';
export type LayoutType = 'normal' | 'historical_low' | 'multi';
export type NavPage = 'dash' | 'search' | 'newpost' | 'queue' | 'published' | 'layout' | 'settings';

export interface Tag {
  id: string;
  name: string;
  value: string;
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
  emoji: string;
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
  textAnchor: 'left' | 'right';
  text: string;
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
  bgColor: string;
  product: ElementLayout;
  overlay: ImgEl;
  badge: ImgEl;
  prezzo: TextEl;
  prezzoPrecedente: TextEl;
  sconto: TextEl;
  testoCustom: TextEl;
  store: ImgEl;
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
    bgColor: '#ffffff',
    product: { x: 5, y: 5, size: 90 },
    overlay: defImg({ size: 100 }),
    badge: defImg({ x: 3, y: 3, size: 22 }),
    prezzo: defText({ enabled: true, x: 5, y: 73, fontSize: 40, color: '#22c55e' }),
    prezzoPrecedente: defText({ enabled: true, x: 5, y: 82, fontSize: 26, color: '#9ca3af', strikethrough: true }),
    sconto: defText({ enabled: true, x: 60, y: 73, fontSize: 36, color: '#ef4444' }),
    testoCustom: defText({ enabled: false, x: 5, y: 90, fontSize: 22 }),
    store: defImg({ enabled: true, x: 3, y: 3, size: 20 }),
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
}

export interface PublishedPost {
  id: string;
  emoji: string;
  title: string;
  price: string;
  platform: Platform;
  ts: string;
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
  affiliateId: string;
  trackingId: string;
}

export interface AppSettings {
  oraI: string;
  oraF: string;
  interv: number;
  attivo: boolean;
  channels: string[];
  amazon: AmazonSettings;
  aliexpress: AliExpressSettings;
}

export interface AppState {
  createdPosts: CreatedPost[];
  queue: QueueItem[];
  published: PublishedPost[];
  tags: Tag[];
  layouts: TextLayout[];
  templates: Template[];
  settings: AppSettings;
}

export interface AppContextType extends AppState {
  setCreatedPosts: React.Dispatch<React.SetStateAction<CreatedPost[]>>;
  setQueue: React.Dispatch<React.SetStateAction<QueueItem[]>>;
  setPublished: React.Dispatch<React.SetStateAction<PublishedPost[]>>;
  setTags: React.Dispatch<React.SetStateAction<Tag[]>>;
  setLayouts: React.Dispatch<React.SetStateAction<TextLayout[]>>;
  setTemplates: React.Dispatch<React.SetStateAction<Template[]>>;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  stats: { inCoda: number; sched: number; pub: number };
}
