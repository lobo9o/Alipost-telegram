export type PostSource = 'az' | 'ali';
export type PostType = 'single' | 'multi';
export type PostStatus = 'draft' | 'scheduled' | 'published' | 'error';
export type LayoutType = 'normale' | 'minimo_storico' | 'multiplo';
export type NavPage = 'dash' | 'search' | 'newpost' | 'queue' | 'published' | 'layout' | 'settings';

export interface Tag {
  id: string;
  name: string;  // e.g. "{titolo}"
  value: string; // e.g. "Titolo del prodotto"
}

export interface Product {
  id: string;
  titolo: string;
  prezzo_orig: string;
  prezzo_sc: string;
  sconto: number;
  emoji: string;
  src: PostSource;
  custom: string;
  asin?: string;
}

export interface QueueItem {
  id: string;
  tipo: PostType;
  src: PostSource;
  products: Partial<Product>[];
  sched: string;
  status: PostStatus;
  sel: boolean;
}

export interface PublishedPost {
  id: string;
  emoji: string;
  titolo: string;
  prezzo: string;
  src: PostSource;
  ts: string;
}

export interface TextLayout {
  id: string;
  nome: string;
  tipo: LayoutType;
  contenuto: string;
}

export interface TemplateElement {
  id: string;
  nome: string;
  color: string;
  vis: boolean;
  x: number;
  y: number;
  w: number;
}

export interface AmazonSettings {
  enabled: boolean;
  affiliateTag: string;
  accessKey: string;
  secretKey: string;
  marketplace: string;
}

export interface AliExpressSettings {
  enabled: boolean;
  affiliateId: string;
  trackingId: string;
}

export interface TemplateSettings {
  overlay: string | null;
  logo: string | null;
  badgeEnabled: boolean;
  positions: {
    productImage: { x: number; y: number; w: number };
    price: { x: number; y: number; w: number };
    discount: { x: number; y: number; w: number };
  };
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
  queue: QueueItem[];
  published: PublishedPost[];
  tags: Tag[];
  layouts: TextLayout[];
  settings: AppSettings;
  telElems: TemplateElement[];
  templateSettings: TemplateSettings;
}

export interface AppContextType extends AppState {
  setQueue: React.Dispatch<React.SetStateAction<QueueItem[]>>;
  setPublished: React.Dispatch<React.SetStateAction<PublishedPost[]>>;
  setTags: React.Dispatch<React.SetStateAction<Tag[]>>;
  setLayouts: React.Dispatch<React.SetStateAction<TextLayout[]>>;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setTelElems: React.Dispatch<React.SetStateAction<TemplateElement[]>>;
  setTemplateSettings: React.Dispatch<React.SetStateAction<TemplateSettings>>;
  stats: { inCoda: number; sched: number; pub: number };
}
