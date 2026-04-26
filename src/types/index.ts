export type Platform = 'amazon' | 'aliexpress';
export type PostType = 'single' | 'multi';
export type PostStatus = 'draft' | 'scheduled' | 'published' | 'error';
export type LayoutType = 'normal' | 'historical_low' | 'multi';
export type TemplateType = 'normal' | 'historical_low';
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

export interface ElementLayout {
  x: number;    // % from left (0–100)
  y: number;    // % from top  (0–100)
  size: number; // % of canvas width (1–100)
}

export const DEFAULT_PRODUCT_POS: ElementLayout = { x: 5, y: 5, size: 90 };
export const DEFAULT_OVERLAY_POS: ElementLayout = { x: 0, y: 0, size: 100 };
export const DEFAULT_BADGE_POS:   ElementLayout = { x: 3, y: 3, size: 25 };

export interface Template {
  id: string;
  nome: string;
  tipo: TemplateType;
  overlay: string | null;      // base64 data URL
  badgeIcon: string | null;    // base64 data URL (icona minimo storico)
  badgeEnabled: boolean;
  bgColor: string;             // default '#ffffff'
  productPos: ElementLayout;
  overlayPos: ElementLayout;
  badgePos: ElementLayout;
}

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
