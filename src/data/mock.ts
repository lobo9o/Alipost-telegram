import { AppSettings, Tag, TextLayout, Template, KeyboardLayout, makeDefaultTemplate } from '../types';

export function genId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export const INITIAL_TAGS: Tag[] = [
  // ── Titolo
  { id: 'tag_titolo',      name: '{titolo}',          value: 'Titolo del prodotto' },
  { id: 'tag_titoloup',    name: '{titoloup}',         value: 'TITOLO IN MAIUSCOLO' },
  { id: 'tag_titoloshort', name: '{titoloshort}',      value: 'Titolo breve (60 car.)' },
  // ── Prezzi
  { id: 'tag_prezzo',      name: '{prezzo}',           value: 'Prezzo attuale (scontato)' },
  { id: 'tag_oldprezzo',   name: '{oldprezzo}',        value: 'Prezzo pieno (originale)' },
  { id: 'tag_prezzosc',    name: '{prezzo_scontato}',  value: 'Prezzo scontato (alias)' },
  { id: 'tag_sconto',      name: '{sconto}',           value: 'Sconto numerico (es: 50)' },
  { id: 'tag_perc',        name: '{perc}',             value: 'Sconto con % (es: -50%)' },
  { id: 'tag_valuta',      name: '{valuta}',           value: '€ / $' },
  // ── Link
  { id: 'tag_link',        name: '{link_affiliato}',   value: 'Link affiliato completo' },
  { id: 'tag_linkalias',   name: '{link}',             value: 'Link affiliato (alias)' },
  // ── Badge
  { id: 'tag_minstor',     name: '{minimo_storico}',   value: '🏆 Minimo Storico!' },
  { id: 'tag_terminata',   name: '{terminata}',        value: '❌ Offerta terminata' },
  // ── Testo libero
  { id: 'tag_custom',      name: '{custom}',           value: 'Testo personalizzato' },
  // ── Store
  { id: 'tag_store',       name: '{store}',            value: 'Amazon / AliExpress' },
  { id: 'tag_storeup',     name: '{storeup}',          value: 'AMAZON / ALIEXPRESS' },
  { id: 'tag_flag',        name: '{countryflag}',      value: '🇮🇹 / 🇨🇳' },
  // ── Data e ora
  { id: 'tag_giorno',      name: '{giorno}',           value: 'Lunedì / Martedì...' },
  { id: 'tag_ora',         name: '{ora}',              value: 'HH:mm' },
  { id: 'tag_data',        name: '{data}',             value: 'dd/MM/yyyy' },
  // ── Dati API extra
  { id: 'tag_stelle',      name: '{stelle}',           value: '⭐ valutazione (es: 4.5)' },
  { id: 'tag_rec',         name: '{recensioni}',       value: 'N. recensioni' },
  { id: 'tag_cat',         name: '{cat}',              value: '#categoria prodotto' },
  { id: 'tag_author',      name: '{author}',           value: 'Autore / Brand' },
  // ── Coupon e checkout
  { id: 'tag_coupon',      name: '{coupon}',            value: 'Coupon extra (es: -10€)' },
  { id: 'tag_boxcoupon',   name: '{boxcoupon}',         value: 'Abilita il coupon prima di acquistare' },
  // ── Custom liberi utente
  { id: 'tag_custom2',     name: '{custom2}',           value: '' },
  { id: 'tag_custom3',     name: '{custom3}',           value: '' },
];

export const INITIAL_LAYOUTS: TextLayout[] = [
  {
    id: 'l1', nome: 'Standard', tipo: 'normal',
    contenuto: '{_<b>{minimo_storico}</b>\n_}\n{_<b>{custom}</b>\n_}\n<b>{titoloshort}</b>\n\n🔶#Amazon \n💶 Lo paghi <b>{prezzo}{valuta}</b> Invece di <s>{oldprezzo}{valuta}</s>\n{_\n🎟 <b>Coupon:</b> {coupon}_}{_\n<i>✂️ {boxcoupon}</i>_}{_\n<i>🛒 {checkout}</i>_}\n\n👉 <a href="{link}">APRI SU AMAZON</a>',
  },
  {
    id: 'l3', nome: 'Post Multiplo', tipo: 'multi',
    contenuto: '{_<b>{custom}</b>_}\n<b>{titoloshort}</b>\n🟥#{store}\n💶 A soli: <b>{prezzo}{valuta}</b> invece di: <s>{oldprezzo}€</s>\n{_🎟 <b>Coupon:</b> {coupon}_}\n👉 <a href="{link}">ACQUISTA ORA</a>\n➿➿➿➿➿➿➿➿➿➿➿➿',
  },
];

export const INITIAL_KEYBOARDS: KeyboardLayout[] = [
  { id: 'kb1', nome: 'Default', contenuto: '💥 Link Articolo - {link}' },
];

export const INITIAL_TEMPLATES: Template[] = [makeDefaultTemplate('tpl1')];

export const INITIAL_SETTINGS: AppSettings = {
  oraI: '08:00', oraF: '22:00', interv: 60, attivo: false,
  channels: [], notifThreshold: undefined,
  amazon: { enabled: false, affiliateTag: '', credentialId: '', credentialSecret: '', version: '2.2', marketplace: 'IT' },
  aliexpress: { enabled: false, appKey: '', appSecret: '', trackingId: '', targetCountry: 'IT' },
  dealSearch: {
    autoPublishAliexpress: false,
    autoPublishAmazon: false,
    publishPattern: '1:1',
    ali: { keywords: '', minDiscount: 0, minPrice: 0, maxPrice: 0, sort: 'DEFAULT_SORT', deliveryDays: 0, categoryIds: '' },
  },
  terminata: {
    grayscale: true,
    overlayText: '❌ OFFERTA TERMINATA',
    overlayTextColor: '#ff0000',
    overlayTextSize: 7,
    overlayTextX: 50,
    overlayTextY: 50,
    overlayTextFont: 'Impact',
    showPrezzo: true,
    showPrezzoPrecedente: false,
    showSconto: false,
    layoutId: '',
    telegramMode: 'keep' as const,
    telegramText: '❌ Offerta terminata',
  },
};
