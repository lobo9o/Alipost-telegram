import { AppSettings, Tag, TextLayout, Template, makeDefaultTemplate } from '../types';

export function genId(): string {
  return Math.random().toString(36).slice(2, 8);
}

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
    showPrezzo: true,
    showPrezzoPrecedente: false,
    showSconto: false,
    layoutId: '',
    templateId: '',
  },
};
