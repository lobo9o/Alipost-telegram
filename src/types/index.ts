export type PostSource = 'az' | 'ali';
export type PostType = 'single' | 'multi';
export type PostStatus = 'draft' | 'scheduled' | 'published' | 'error';
export type LayoutType = 'normale' | 'minimo_storico' | 'multiplo';
export type NavPage = 'dash' | 'search' | 'newpost' | 'queue' | 'published' | 'layout' | 'settings';

export interface Product {
  id: string;
  titolo: string;
  prezzo_orig: string;
  prezzo_sc: string;
  sconto: number;
  emoji: string;
  src: PostSource;
  custom: string;
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

export interface AppSettings {
  oraI: string;
  oraF: string;
  interv: number;
  attivo: boolean;
  azApi: string;
  aliApi: string;
  trackAz: string;
  trackAli: string;
  channels: string[];
}

export interface AppState {
  queue: QueueItem[];
  published: PublishedPost[];
  tags: string[];
  layouts: TextLayout[];
  settings: AppSettings;
  telElems: TemplateElement[];
}

export interface AppContextType extends AppState {
  setQueue: React.Dispatch<React.SetStateAction<QueueItem[]>>;
  setPublished: React.Dispatch<React.SetStateAction<PublishedPost[]>>;
  setTags: React.Dispatch<React.SetStateAction<string[]>>;
  setLayouts: React.Dispatch<React.SetStateAction<TextLayout[]>>;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setTelElems: React.Dispatch<React.SetStateAction<TemplateElement[]>>;
  stats: { inCoda: number; sched: number; pub: number };
}
