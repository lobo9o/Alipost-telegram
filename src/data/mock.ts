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
  // ── Custom liberi utente
  { id: 'tag_custom2',     name: '{custom2}',          value: '' },
  { id: 'tag_custom3',     name: '{custom3}',          value: '' },
];

export const INITIAL_LAYOUTS: TextLayout[] = [
  {
    id: 'l1', nome: 'Standard', tipo: 'normal',
    contenuto: '🔥 {titolo}\n\n💰 {prezzo} <s>{oldprezzo}</s>\n🏷️ {perc} di sconto\n{_ ⭐ {stelle}/5 ({recensioni} rec.) _}\n\n{custom}\n\n👇 Link nel pulsante',
  },
  {
    id: 'l2', nome: 'Minimo Storico', tipo: 'historical_low',
    contenuto: '🏆 MINIMO STORICO!\n\n📌 {titolo}\n\n💰 {prezzo}\n📉 Minimo di sempre!\n{_ ⭐ {stelle}/5 _}\n\n{custom}',
  },
  {
    id: 'l3', nome: 'Post Multiplo', tipo: 'multi',
    contenuto: '🔥 OFFERTE DEL GIORNO 🔥\n\n{lista_prodotti}\n\n👇 Link nei pulsanti sotto',
  },
];

export const INITIAL_KEYBOARDS: KeyboardLayout[] = [
  { id: 'kb1', nome: 'Default', contenuto: '💥 Link Articolo - {link}' },
];

export const INITIAL_TEMPLATES: Template[] = [makeDefaultTemplate('tpl1')];

export const INITIAL_SETTINGS: AppSettings = {
  oraI: '08:00', oraF: '22:00', interv: 60, attivo: false,
  channels: [],
  amazon: { enabled: false, affiliateTag: '', credentialId: '', credentialSecret: '', version: '2.2', marketplace: 'IT' },
  aliexpress: { enabled: false, affiliateId: '', trackingId: '' },
  terminata: {
    grayscale: true,
    overlayText: '❌ OFFERTA TERMINATA',
    overlayTextColor: '#ff0000',
    overlayTextSize: 7,
    overlayTextX: 50,
    overlayTextY: 50,
    showPrezzo: true,
    showPrezzoPrecedente: false,
    showSconto: false,
    layoutId: '',
  },
};
