import { CatalogProduct, QueueItem, PublishedPost, TextLayout, Template, AppSettings, Tag, CreatedPost } from '../types';

export function genId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export const MOCK_CATALOG: CatalogProduct[] = [
  { id: 'm1', platform: 'aliexpress', emoji: '⌚', title: 'Xiaomi Band 8 Pro Smart Fitness GPS', originalPrice: 89.99, discountedPrice: 34.99, discountPercent: 61 },
  { id: 'm2', platform: 'amazon', emoji: '🎧', title: 'Sony WH-1000XM5 Wireless Noise Cancelling', originalPrice: 299.00, discountedPrice: 189.00, discountPercent: 37 },
  { id: 'm3', platform: 'aliexpress', emoji: '💡', title: 'LED Strip RGB 10m WiFi Smart Alexa Google', originalPrice: 24.99, discountedPrice: 9.80, discountPercent: 61 },
  { id: 'm4', platform: 'amazon', emoji: '📱', title: 'Anker MagSafe Wireless Charger 15W Fast', originalPrice: 39.99, discountedPrice: 24.99, discountPercent: 37 },
  { id: 'm5', platform: 'aliexpress', emoji: '🎒', title: 'Zaino da viaggio impermeabile 40L USB', originalPrice: 59.99, discountedPrice: 19.90, discountPercent: 67 },
  { id: 'm6', platform: 'amazon', emoji: '🖱️', title: 'Logitech MX Master 3S Wireless Mouse', originalPrice: 99.99, discountedPrice: 69.99, discountPercent: 30 },
];

const CP1: CreatedPost = {
  id: 'cp1', platform: 'amazon', sourceUrl: 'https://amazon.it/dp/B08N5WRWNW',
  productId: 'B08N5WRWNW', title: 'Sony WH-1000XM5 Wireless Noise Cancelling',
  image: '', originalPrice: 299.00, discountedPrice: 189.00, discountPercent: 37,
  customText: '', isHistoricalLow: false, templateId: 'tpl1', layoutId: 'l1', emoji: '🎧',
};
const CP2: CreatedPost = {
  id: 'cp2', platform: 'aliexpress', sourceUrl: 'https://aliexpress.com/item/1005004999001.html',
  productId: '1005004999001', title: 'Xiaomi Band 8 Pro Smart Fitness GPS',
  image: '', originalPrice: 89.99, discountedPrice: 34.99, discountPercent: 61,
  customText: '', isHistoricalLow: false, templateId: 'tpl1', layoutId: 'l1', emoji: '⌚',
};

export const INITIAL_QUEUE: QueueItem[] = [
  { id: 'q1', tipo: 'single', posts: [CP1], sched: '15 Giu · 10:00', status: 'scheduled', sel: false },
  { id: 'q2', tipo: 'multi', posts: [CP2, { ...CP1, id: 'cp1b' }], sched: '15 Giu · 12:00', status: 'draft', sel: false },
];

export const INITIAL_PUBLISHED: PublishedPost[] = [
  { id: 'pub1', emoji: '🎧', title: 'Sony WH-1000XM5 Wireless', price: '189.00', platform: 'amazon', ts: 'oggi · 10:05' },
  { id: 'pub2', emoji: '⌚', title: 'Xiaomi Band 8 Pro', price: '34.99', platform: 'aliexpress', ts: 'oggi · 08:30' },
  { id: 'pub3', emoji: '💡', title: 'LED Strip RGB 10m WiFi', price: '9.80', platform: 'aliexpress', ts: 'ieri · 20:00' },
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
    id: 'l1', nome: 'Standard', tipo: 'normal',
    contenuto: '🔥 {titolo}\n\n💰 {prezzo_scontato} ~~{prezzo}~~\n🏷️ -{sconto} di sconto\n\n{custom}\n\n👇 Link nel pulsante',
  },
  {
    id: 'l2', nome: 'Minimo Storico', tipo: 'historical_low',
    contenuto: '🏆 MINIMO STORICO!\n\n📌 {titolo}\n\n💰 {prezzo_scontato}\n📉 Minimo di sempre!\n\n{custom}',
  },
  {
    id: 'l3', nome: 'Post Multiplo', tipo: 'multi',
    contenuto: '🔥 OFFERTE DEL GIORNO 🔥\n\n{lista_prodotti}\n\n👇 Link nei pulsanti sotto',
  },
];

export const INITIAL_TEMPLATES: Template[] = [
  { id: 'tpl1', nome: 'Standard', tipo: 'normal', overlay: null, logo: null, badgeEnabled: false },
  { id: 'tpl2', nome: 'Minimo Storico', tipo: 'historical_low', overlay: null, logo: null, badgeEnabled: true },
];

export const INITIAL_SETTINGS: AppSettings = {
  oraI: '08:00', oraF: '22:00', interv: 60, attivo: true,
  channels: ['@miocanaleTelegram'],
  amazon: { enabled: true, affiliateTag: '', accessKey: '', secretKey: '', marketplace: 'IT' },
  aliexpress: { enabled: true, affiliateId: '', trackingId: '' },
};
