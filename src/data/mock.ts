import { Product, QueueItem, PublishedPost, TextLayout, TemplateElement, AppSettings, Tag, TemplateSettings } from '../types';

export function genId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export const MOCK_PRODUCTS: Product[] = [
  { id: 'm1', src: 'ali', emoji: '⌚', titolo: 'Xiaomi Band 8 Pro Smart Fitness GPS', prezzo_orig: '89.99', prezzo_sc: '34.99', sconto: 61, custom: '' },
  { id: 'm2', src: 'az', emoji: '🎧', titolo: 'Sony WH-1000XM5 Wireless Noise Cancelling', prezzo_orig: '299.00', prezzo_sc: '189.00', sconto: 37, custom: '' },
  { id: 'm3', src: 'ali', emoji: '💡', titolo: 'LED Strip RGB 10m WiFi Smart Alexa Google', prezzo_orig: '24.99', prezzo_sc: '9.80', sconto: 61, custom: '' },
  { id: 'm4', src: 'az', emoji: '📱', titolo: 'Anker MagSafe Wireless Charger 15W Fast', prezzo_orig: '39.99', prezzo_sc: '24.99', sconto: 37, custom: '' },
  { id: 'm5', src: 'ali', emoji: '🎒', titolo: 'Zaino da viaggio impermeabile 40L USB', prezzo_orig: '59.99', prezzo_sc: '19.90', sconto: 67, custom: '' },
  { id: 'm6', src: 'az', emoji: '🖱️', titolo: 'Logitech MX Master 3S Wireless Mouse', prezzo_orig: '99.99', prezzo_sc: '69.99', sconto: 30, custom: '' },
];

export const INITIAL_QUEUE: QueueItem[] = [
  {
    id: 'q1', tipo: 'single', src: 'az',
    products: [{ titolo: 'Sony WH-1000XM5', prezzo_sc: '189.00', prezzo_orig: '299.00', emoji: '🎧', sconto: 37 }],
    sched: '15 Giu · 10:00', status: 'scheduled', sel: false,
  },
  {
    id: 'q2', tipo: 'multi', src: 'ali',
    products: [
      { titolo: 'Xiaomi Band 8 Pro', prezzo_sc: '34.99', emoji: '⌚', sconto: 61 },
      { titolo: 'LED Strip RGB 10m', prezzo_sc: '9.80', emoji: '💡', sconto: 61 },
    ],
    sched: '15 Giu · 12:00', status: 'draft', sel: false,
  },
  {
    id: 'q3', tipo: 'single', src: 'az',
    products: [{ titolo: 'Anker MagSafe 15W', prezzo_sc: '24.99', prezzo_orig: '39.99', emoji: '📱', sconto: 37 }],
    sched: '14 Giu · 08:00', status: 'published', sel: false,
  },
];

export const INITIAL_PUBLISHED: PublishedPost[] = [
  { id: 'pub1', emoji: '🎧', titolo: 'Sony WH-1000XM5 Wireless', prezzo: '189.00', src: 'az', ts: 'oggi · 10:05' },
  { id: 'pub2', emoji: '⌚', titolo: 'Xiaomi Band 8 Pro', prezzo: '34.99', src: 'ali', ts: 'oggi · 08:30' },
  { id: 'pub3', emoji: '💡', titolo: 'LED Strip RGB 10m WiFi', prezzo: '9.80', src: 'ali', ts: 'ieri · 20:00' },
];

export const INITIAL_TAGS: Tag[] = [
  { id: 'tag1', name: '{titolo}', value: 'Titolo del prodotto' },
  { id: 'tag2', name: '{prezzo}', value: 'Prezzo originale' },
  { id: 'tag3', name: '{prezzo_scontato}', value: 'Prezzo scontato' },
  { id: 'tag4', name: '{custom}', value: 'Testo personalizzato' },
  { id: 'tag5', name: '{link_affiliato}', value: 'Link affiliato prodotto' },
  { id: 'tag6', name: '{sconto}', value: 'Percentuale di sconto' },
  { id: 'tag7', name: '{minimo_storico}', value: 'Badge minimo storico' },
];

export const INITIAL_LAYOUTS: TextLayout[] = [
  {
    id: 'l1', nome: 'Standard AliExpress', tipo: 'normale',
    contenuto: '🔥 {titolo}\n\n💰 {prezzo_scontato} ~~{prezzo}~~\n🏷️ -{sconto}% di sconto\n\n{custom}\n\n👇 Link nel pulsante',
  },
  {
    id: 'l2', nome: 'Minimo Storico', tipo: 'minimo_storico',
    contenuto: '🏆 MINIMO STORICO!\n\n📌 {titolo}\n\n💰 {prezzo_scontato}\n📉 Minimo di sempre!\n\n{custom}',
  },
  {
    id: 'l3', nome: 'Post Multiplo', tipo: 'multiplo',
    contenuto: '🔥 OFFERTE DEL GIORNO 🔥\n\n{lista_prodotti}\n\n👇 Link nei pulsanti sotto',
  },
];

export const INITIAL_TEMELEMS: TemplateElement[] = [
  { id: 'e1', nome: 'Immagine prodotto', color: '#6c63ff', vis: true, x: 50, y: 50, w: 200 },
  { id: 'e2', nome: 'Logo brand', color: '#10b981', vis: true, x: 10, y: 10, w: 60 },
  { id: 'e3', nome: 'Prezzo', color: '#f59e0b', vis: true, x: 30, y: 75, w: 100 },
  { id: 'e4', nome: 'Badge sconto', color: '#ef4444', vis: true, x: 70, y: 15, w: 60 },
  { id: 'e5', nome: 'Cornice overlay', color: '#8b5cf6', vis: false, x: 0, y: 0, w: 300 },
];

export const INITIAL_TEMPLATE_SETTINGS: TemplateSettings = {
  overlay: null,
  logo: null,
  badgeEnabled: false,
  positions: {
    productImage: { x: 50, y: 50, w: 200 },
    price: { x: 30, y: 75, w: 100 },
    discount: { x: 70, y: 15, w: 60 },
  },
};

export const INITIAL_SETTINGS: AppSettings = {
  oraI: '08:00', oraF: '22:00', interv: 60, attivo: true,
  channels: ['@miocanaleTelegram'],
  amazon: {
    enabled: true,
    affiliateTag: '',
    accessKey: '',
    secretKey: '',
    marketplace: 'IT',
  },
  aliexpress: {
    enabled: true,
    affiliateId: '',
    trackingId: '',
  },
};

export function detectSource(url: string): 'az' | 'ali' {
  return url.includes('amazon') ? 'az' : 'ali';
}

export async function fetchProductMock(url: string, index: number): Promise<Product> {
  const p = MOCK_PRODUCTS[index % MOCK_PRODUCTS.length];
  return { ...p, id: genId(), src: detectSource(url), custom: '' };
}
