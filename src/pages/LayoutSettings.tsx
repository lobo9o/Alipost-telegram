import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useApp } from '../context/AppContext';
import { NavPage, TextLayout, KeyboardLayout, LayoutType, Tag, Template, TextEl, ImgEl, makeDefaultTemplate, TerminataConfig, MultiBarConfig, MultiPriceConfig } from '../types';
import { PageHeader, SwitchTabs, InfoBanner, ErrorBanner, ToggleRow } from '../components/Shared';
import { genId, INITIAL_LAYOUTS, INITIAL_KEYBOARDS } from '../data/mock';
import { tagsApi, layoutsApi, keyboardsApi, templatesApi, settingsApi, tgMonitorApi, TgMonitorChannel } from '../lib/api';
import { SYSTEM_TAGS } from '../utils/tagUtils';

// ============================================================
// LAYOUT PAGE (Tags / Text / Template)
// ============================================================
export function LayoutPage({ nav }: { nav: (p: NavPage) => void }) {
  const [tab, setTab] = useState('tags');
  return (
    <div className="pg">
      <PageHeader title="Layout" onBack={() => nav('dash')} />
      <SwitchTabs
        options={[['tags', '🏷️ Tag'], ['testo', '📝 Testo'], ['tastiera', '⌨️ Tastiera'], ['template', '🖼️ Template']]}
        value={tab} onChange={setTab}
      />
      {tab === 'tags' && <TagsSection />}
      {tab === 'testo' && <TextLayoutSection />}
      {tab === 'tastiera' && <KeyboardSection />}
      {tab === 'template' && <TemplateSection />}
    </div>
  );
}


// Tag di sistema non-modificabili (compilati automaticamente dal bot), in ordine fisso
const READONLY_SYSTEM_TAG_ORDER = [
  '{titolo}', '{titoloup}', '{titoloshort}',
  '{prezzo}', '{oldprezzo}', '{prezzo_scontato}',
  '{sconto}', '{perc}', '{valuta}',
  '{link_affiliato}', '{link}', '{addtocart}', '{buynow}',
  '{coupon}', '{boxcoupon}', '{checkout}', '{custom}',
  '{store}', '{storeup}',
  '{countryflag}', '{country}', '{countryup}',
  '{giorno}', '{ora}', '{data}',
  '{stelle}', '{recensioni}', '{cat}', '{author}',
  '{emojicat}',
];
const READONLY_SYSTEM_TAG_SET = new Set(READONLY_SYSTEM_TAG_ORDER);

const TAG_DESCRIPTIONS: Record<string, string> = {
  '{titolo}':          'Titolo completo del prodotto',
  '{titoloup}':        'Titolo in MAIUSCOLO',
  '{titoloshort}':     'Titolo troncato a 60 caratteri con "..."',
  '{prezzo}':          'Prezzo scontato attuale — es. 29.99',
  '{oldprezzo}':       'Prezzo originale prima dello sconto',
  '{prezzo_scontato}': 'Uguale a {prezzo}',
  '{sconto}':          'Percentuale di sconto come numero — es. 35',
  '{perc}':            'Sconto con segno e simbolo % — es. -35%',
  '{valuta}':          'Simbolo della valuta — es. € oppure $',
  '{link_affiliato}':  'Link affiliato del prodotto',
  '{link}':            'Uguale a {link_affiliato}',
  '{addtocart}':       'Link "Aggiungi al carrello" Amazon — aggiunge il prodotto al carrello tramite link affiliato. Solo Tastiera.',
  '{buynow}':          'Link "Acquista ora" Amazon — apre direttamente la pagina prodotto dove l\'utente può cliccare "Acquista ora". Solo Tastiera.',
  '{coupon}':          'Codice coupon se presente nel post',
  '{boxcoupon}':       'Mostra testo "Abilita il coupon prima di acquistare" per link con coupon da abilitare nella pagina Amazon',
  '{checkout}':        'Testo "Sconto automatico al check-out" per prodotti con sconto applicato automaticamente al pagamento (senza box da spuntare)',
  '{custom}':          'Testo personalizzato inserito nel post',
  '{store}':           'Nome del negozio — Amazon oppure AliExpress',
  '{storeup}':         'Nome del negozio in MAIUSCOLO — AMAZON oppure ALIEXPRESS',
  '{countryflag}':     'Bandiera emoji del paese di spedizione — es. 🇨🇳',
  '{country}':         'Nome del paese di spedizione — es. Cina',
  '{countryup}':       'Nome del paese in MAIUSCOLO — es. CINA',
  '{giorno}':          'Giorno della settimana — es. Lunedì',
  '{ora}':             'Ora di pubblicazione — es. 14:30',
  '{data}':            'Data di pubblicazione — es. 18/05/2026',
  '{stelle}':          'Valutazione/stelle del prodotto',
  '{recensioni}':      'Numero di recensioni del prodotto',
  '{cat}':             'Categoria del prodotto',
  '{author}':          'Autore o fonte del post',
  '{emojicat}':        'Emoji automatica basata sulla categoria e le parole chiave del titolo — es. 📱 per smartphone, ☕ per caffè, 🧴 per igiene',
};

// ── Tags ─────────────────────────────────────────────────────
function TagsSection() {
  const { tags, setTags } = useApp();
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editValue, setEditValue] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  const fmt = (n: string) => n.trim().startsWith('{') ? n.trim() : `{${n.trim()}}`;

  const addTag = () => {
    if (!newName.trim()) return;
    const tag: Tag = { id: genId(), name: fmt(newName), value: newValue.trim() };
    setTags(t => [...t, tag]);
    setNewName(''); setNewValue('');
    tagsApi.create(tag).catch(() => {});
  };

  const startEdit = (t: Tag) => { setEditId(t.id); setEditName(t.name); setEditValue(t.value); };

  const saveEdit = () => {
    if (!editId) return;
    const updated = { name: fmt(editName), value: editValue };
    setTags(ts => ts.map(t => t.id === editId ? { ...t, ...updated } : t));
    tagsApi.update(editId, updated).catch(() => {});
    setEditId(null);
  };

  // Tag di sistema modificabili (in SYSTEM_TAGS ma NON nella lista readonly)
  const editableSystemTags = tags.filter(t => SYSTEM_TAGS.has(t.name) && !READONLY_SYSTEM_TAG_SET.has(t.name));
  const customTags = tags.filter(t => !SYSTEM_TAGS.has(t.name));

  const renderEditableTag = (t: Tag, isCustom: boolean) => (
    <div key={t.id} className="card" style={{ margin: '0 16px 6px', padding: '9px 12px' }}>
      {editId === t.id ? (
        <>
          {isCustom
            ? <input className="inp" value={editName} onChange={e => setEditName(e.target.value)}
                placeholder="{nome_tag}" style={{ marginBottom: 7 }} />
            : <div style={{ padding: '2px 0 7px', fontSize: 13, fontWeight: 600, color: 'var(--a1)' }}>{t.name}</div>
          }
          <textarea className="inp" value={editValue} onChange={e => setEditValue(e.target.value)}
            placeholder="Valore / descrizione (Enter = a capo)"
            rows={Math.max(2, (editValue.match(/\n/g) ?? []).length + 1)}
            style={{ resize: 'vertical', fontFamily: 'inherit', marginBottom: 6 }} />
          <div className="irow">
            <button className="btn bp bsm" onClick={saveEdit} style={{ flex: 1 }}>✓ Salva</button>
            <button className="btn bs bsm" onClick={() => setEditId(null)} style={{ flex: 1 }}>× Annulla</button>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="tag-pill" style={{ flexShrink: 0 }}>{t.name}</span>
          <span style={{ fontSize: 12, color: 'var(--t2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t.value
              ? (t.value.includes('\n') ? t.value.split('\n')[0] + ' …' : t.value)
              : <span style={{ fontStyle: 'italic', color: 'var(--t3)' }}>vuoto</span>}
          </span>
          <button className="btn bgh bsm" style={{ padding: '3px 8px' }} onClick={() => startEdit(t)}>✏️</button>
          {isCustom && (
            <button className="btn bgh bsm" style={{ color: 'var(--re)', padding: '3px 8px' }}
              onClick={() => { setTags(ts => ts.filter(x => x.id !== t.id)); tagsApi.delete(t.id).catch(() => {}); }}>×</button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="stit">TAG DI SISTEMA</div>
      <div style={{ margin: '0 16px 8px', padding: '7px 12px', background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.15)', borderRadius: 10, fontSize: 11, color: 'var(--t2)' }}>
        Compilati automaticamente dal bot. Clicca un tag per vedere cosa contiene.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 16px 6px' }}>
        {READONLY_SYSTEM_TAG_ORDER.map(name => (
          <span
            key={name}
            className="tag-pill"
            style={{ cursor: 'pointer', opacity: selectedTag && selectedTag !== name ? 0.5 : 1, outline: selectedTag === name ? '2px solid var(--a1)' : 'none', outlineOffset: 2 }}
            onClick={() => setSelectedTag(prev => prev === name ? null : name)}
          >{name}</span>
        ))}
      </div>
      {selectedTag && TAG_DESCRIPTIONS[selectedTag] && (
        <div style={{ margin: '0 16px 10px', padding: '8px 12px', background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)', borderRadius: 8, fontSize: 12, color: 'var(--t1)' }}>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--a1)', marginRight: 6 }}>{selectedTag}</span>
          {TAG_DESCRIPTIONS[selectedTag]}
        </div>
      )}

      <div className="stit" style={{ marginTop: 4 }}>TAG MODIFICABILI ({editableSystemTags.length})</div>
      <div style={{ margin: '0 16px 8px', padding: '7px 12px', background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.15)', borderRadius: 10, fontSize: 11, color: 'var(--t2)' }}>
        Tag di sistema con valore personalizzabile. Premi ✏️ per cambiare il testo.
      </div>
      {editableSystemTags.length === 0 && (
        <div style={{ padding: '4px 16px 8px', fontSize: 12, color: 'var(--t3)' }}>Nessuno.</div>
      )}
      {editableSystemTags.map(t => renderEditableTag(t, false))}

      <div className="stit" style={{ marginTop: 8 }}>TAG PERSONALIZZATI ({customTags.length})</div>
      {customTags.length === 0 && (
        <div style={{ padding: '4px 16px 8px', fontSize: 12, color: 'var(--t3)' }}>Nessun tag personalizzato.</div>
      )}
      {customTags.map(t => renderEditableTag(t, true))}

      <div className="stit">AGGIUNGI TAG</div>
      <div style={{ padding: '0 16px 8px' }}>
        <input className="inp" value={newName} onChange={e => setNewName(e.target.value)}
          placeholder="{nome_tag}" style={{ marginBottom: 7 }}
          onKeyDown={e => e.key === 'Enter' && addTag()} />
        <div className="irow">
          <input className="inp" value={newValue} onChange={e => setNewValue(e.target.value)}
            placeholder="Valore"
            onKeyDown={e => e.key === 'Enter' && addTag()} />
          <button className="btn bp" onClick={addTag} style={{ padding: '0 16px', flexShrink: 0 }}>+ Aggiungi</button>
        </div>
      </div>
      <InfoBanner>Usa <b>{'{_ testo {tag} _}'}</b> per nascondere automaticamente un blocco se il tag al suo interno è vuoto.</InfoBanner>
    </>
  );
}

// ── Text Layouts ──────────────────────────────────────────────
const TIPO_STYLE: Record<LayoutType, string> = {
  normal: 'ltype norm',
  historical_low: 'ltype hist',
  multi: 'ltype mult',
  aliexpress: 'ltype ali',
  aliexpress_historical_low: 'ltype ali',
  amazon: 'ltype norm',
};
const TIPO_LABEL: Record<LayoutType, string> = {
  normal: 'Normale',
  historical_low: 'Min. Storico',
  multi: 'Multiplo',
  aliexpress: 'AliExpress',
  aliexpress_historical_low: 'Min. Storico Ali',
  amazon: 'Amazon',
};

function TextLayoutSection() {
  const { layouts, setLayouts, keyboards } = useApp();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<TextLayout, 'id'>>({ nome: '', tipo: 'normal', contenuto: '', keyboardId: undefined });
  const taRef = useRef<HTMLTextAreaElement>(null);

  const startNew = () => { setForm({ nome: '', tipo: 'normal', contenuto: '', keyboardId: undefined }); setEditing('new'); };
  const startEdit = (l: TextLayout) => { setForm({ nome: l.nome, tipo: l.tipo, contenuto: l.contenuto, keyboardId: l.keyboardId }); setEditing(l.id); };

  const save = () => {
    if (editing === 'new') {
      const layout: TextLayout = { id: genId(), ...form };
      setLayouts(ls => [...ls, layout]);
      layoutsApi.create(layout).catch(() => {});
    } else {
      setLayouts(ls => ls.map(x => x.id === editing ? { ...x, ...form } : x));
      if (editing) layoutsApi.update(editing, form).catch(() => {});
    }
    setEditing(null);
  };

  const insertTag = (tag: string) => {
    const ta = taRef.current;
    const start = ta?.selectionStart ?? form.contenuto.length;
    const end = ta?.selectionEnd ?? start;
    const newContenuto = form.contenuto.slice(0, start) + tag + form.contenuto.slice(end);
    setForm(f => ({ ...f, contenuto: newContenuto }));
    setTimeout(() => { ta?.focus(); ta?.setSelectionRange(start + tag.length, start + tag.length); }, 0);
  };

  if (editing) {
    return (
      <>
        <div className="stit">{editing === 'new' ? 'NUOVO LAYOUT' : 'MODIFICA LAYOUT'}</div>
        <div className="fld">
          <label className="lbl">Nome layout</label>
          <input className="inp" value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="Nome..." />
        </div>
        <div className="fld">
          <label className="lbl">Tipo</label>
          <select className="sel" value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value as LayoutType })}>
            <option value="normal">Normale</option>
            <option value="multi">Multiplo</option>
            <option value="aliexpress">AliExpress</option>
          </select>
        </div>
        <div className="fld">
          <label className="lbl">Contenuto — usa tag come {'{titolo}'}, {'{prezzo_scontato}'}, {'{countryflag}'}, {'{country}'}, {'{custom}'}</label>
          <textarea ref={taRef} className="txta" value={form.contenuto} onChange={e => setForm({ ...form, contenuto: e.target.value })} rows={8} />
        </div>
        <div className="fld">
          <label className="lbl">Tastiera associata</label>
          <select className="sel" value={form.keyboardId ?? ''} onChange={e => setForm({ ...form, keyboardId: e.target.value || undefined })}>
            <option value="">— Nessuna (usa quella del post) —</option>
            {keyboards.map(kb => <option key={kb.id} value={kb.id}>{kb.nome}</option>)}
          </select>
        </div>
        <div style={{ padding: '0 16px 16px', display: 'flex', gap: 8 }}>
          <button className="btn bs" style={{ flex: 1 }} onClick={() => setEditing(null)}>Annulla</button>
          <button className="btn bp" style={{ flex: 1 }} onClick={save}>💾 Salva layout</button>
        </div>
      </>
    );
  }

  const defaultLayoutIds = new Set(INITIAL_LAYOUTS.map(d => d.id));

  return (
    <>
      <div style={{ padding: '10px 16px 0', display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn bp bsm" onClick={startNew}>+ Nuovo layout</button>
      </div>
      {layouts.map(l => (
        <div key={l.id} className="lc">
          <div className="lc-top">
            <span className={TIPO_STYLE[l.tipo]}>{TIPO_LABEL[l.tipo]}</span>
            <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{l.nome}</span>
            <button className="btn bgh bsm" onClick={() => startEdit(l)}>✏️</button>
            {!defaultLayoutIds.has(l.id) && (
              <button className="btn bgh bsm" style={{ color: 'var(--re)' }} onClick={() => { setLayouts(ls => ls.filter(x => x.id !== l.id)); layoutsApi.delete(l.id).catch(() => {}); }}>×</button>
            )}
          </div>
          <div className="lpreview">{l.contenuto}</div>
        </div>
      ))}
    </>
  );
}

// ── Keyboard Layout ───────────────────────────────────────────

const KB_TAG_LABELS: Record<string, string> = {
  '{link}': 'Link offerta',
  '{addtocart}': 'Aggiungi al carrello',
  '{buynow}': 'Checkout diretto',
  '{whatsapp}': 'Condivisione WhatsApp',
  '{poll}': 'Sondaggio 👍👎',
};

const COLOR_MAP: Record<string, string> = { g: '#22c55e', r: '#ef4444', b: '#3b82f6' };

function parseKbButton(raw: string): { text: string; color?: string; url: string } {
  let s = raw.trim();
  let color: string | undefined;
  const colorMatch = s.match(/^#([grb])\s+/);
  if (colorMatch) { color = COLOR_MAP[colorMatch[1]]; s = s.slice(colorMatch[0].length); }
  // Cerca separatore: prima prova tag/URL senza spazi obbligatori, poi " - " classico
  const sepMatch = s.match(/^(.*)\s*-\s*(\{[a-zA-Z_][a-zA-Z0-9_]*\}|https?:\/\/.+)$/)
    ?? s.match(/^(.*)\s+-\s+(.+)$/);
  if (!sepMatch) return { text: s, url: '' };
  return { text: sepMatch[1].trim(), color, url: sepMatch[2].trim() };
}

function KbPreview({ contenuto }: { contenuto: string }) {
  const rows = contenuto.split('\n').filter(r => r.trim());
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
      {rows.map((row, ri) => (
        <div key={ri} style={{ display: 'flex', gap: 5 }}>
          {row.split('&&').map((btn, bi) => {
            const { text, color, url } = parseKbButton(btn);
            const isPoll = url === '{poll}';
            return (
              <div key={bi} style={{
                flex: 1, textAlign: 'center', padding: '7px 10px',
                borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: color ? `${color}22` : 'var(--bg4)',
                color: color ?? 'var(--a1)',
                border: `1px solid ${color ?? 'var(--a1)'}44`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              }}>
                {isPoll ? '📊' : '🔗'} {text}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function KeyboardSection() {
  const { keyboards, setKeyboards } = useApp();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<KeyboardLayout, 'id'>>({ nome: '', contenuto: '' });

  const startNew = () => { setForm({ nome: '', contenuto: '' }); setEditing('new'); };
  const startEdit = (kb: KeyboardLayout) => { setForm({ nome: kb.nome, contenuto: kb.contenuto }); setEditing(kb.id); };

  const save = () => {
    if (editing === 'new') {
      const kb: KeyboardLayout = { id: genId(), ...form };
      setKeyboards(ks => [...ks, kb]);
      keyboardsApi.create(kb).catch(() => {});
    } else {
      setKeyboards(ks => ks.map(x => x.id === editing ? { ...x, ...form } : x));
      if (editing) keyboardsApi.update(editing, form).catch(() => {});
    }
    setEditing(null);
  };

  if (editing) {
    return (
      <>
        <div className="stit">{editing === 'new' ? 'NUOVA TASTIERA' : 'MODIFICA TASTIERA'}</div>
        <div style={{ padding: '0 16px' }}>
          <InfoBanner>
            <b>Formato:</b> <code>Testo - url</code> per ogni riga. Usa <code>&amp;&amp;</code> per più bottoni sulla stessa riga.<br />
            <b>Colori:</b> <code>#g</code> verde · <code>#r</code> rosso · <code>#b</code> blu<br />
            <b>Tag URL:</b> <code>{'{link}'}</code> link offerta · <code>{'{addtocart}'}</code> aggiungi al carrello · <code>{'{buynow}'}</code> acquista ora (pagina prodotto) · <code>{'{whatsapp}'}</code> condividi · <code>{'{poll}'}</code> sondaggio
          </InfoBanner>
        </div>
        <div className="fld">
          <label className="lbl">Nome tastiera</label>
          <input className="inp" value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="Es: Default, Con WhatsApp..." />
        </div>
        <div className="fld">
          <label className="lbl">Bottoni</label>
          <textarea
            className="txta"
            value={form.contenuto}
            onChange={e => setForm({ ...form, contenuto: e.target.value })}
            rows={6}
            placeholder={'💥 Link Articolo - {link}\n#g 📲 WhatsApp - {whatsapp} && #b 👍 - {poll}'}
          />
        </div>
        {form.contenuto && (
          <div style={{ padding: '0 16px' }}>
            <div className="lbl" style={{ marginBottom: 4 }}>ANTEPRIMA</div>
            <KbPreview contenuto={form.contenuto} />
          </div>
        )}
        <div style={{ padding: '16px', display: 'flex', gap: 8 }}>
          <button className="btn bs" style={{ flex: 1 }} onClick={() => setEditing(null)}>Annulla</button>
          <button className="btn bp" style={{ flex: 1 }} onClick={save}>💾 Salva tastiera</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div style={{ padding: '10px 16px 0', display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn bp bsm" onClick={startNew}>+ Nuova tastiera</button>
      </div>
      {keyboards.map(kb => (
        <div key={kb.id} className="lc">
          <div className="lc-top">
            <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{kb.nome}</span>
            <button className="btn bgh bsm" onClick={() => startEdit(kb)}>✏️</button>
            <button className="btn bgh bsm" style={{ color: 'var(--re)' }}
              onClick={() => { setKeyboards(ks => ks.filter(x => x.id !== kb.id)); keyboardsApi.delete(kb.id).catch(() => {}); }}>×</button>
          </div>
          <KbPreview contenuto={kb.contenuto} />
        </div>
      ))}
    </>
  );
}

// ── Template Image Editor ─────────────────────────────────────

function readAsBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function DragHint({ x, y, onCenter }: { x: number; y: number; onCenter: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span style={{ fontSize: 11, color: 'var(--t3)', flex: 1 }}>↕ Trascina sull'anteprima</span>
      <span style={{ fontSize: 10, color: 'var(--t3)' }}>X:{x}% · Y:{y}%</span>
      <button className="btn bgh bsm" onClick={onCenter} title="Centra" style={{ padding: '2px 10px' }}>⊕ Centra</button>
    </div>
  );
}

function ZoomControls({ value, onChange, min = 5, max = 100, label = 'DIMENSIONE', step = 2 }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; label?: string; step?: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
      <span className="lbl" style={{ marginBottom: 0, flex: 1 }}>{label}</span>
      <button className="btn bgh bsm" style={{ padding: '2px 12px' }}
        onClick={() => onChange(Math.max(min, value - step))}>🔍−</button>
      <span style={{ fontSize: 11, color: 'var(--t2)', width: 34, textAlign: 'center' }}>{value}%</span>
      <button className="btn bgh bsm" style={{ padding: '2px 12px' }}
        onClick={() => onChange(Math.min(max, value + step))}>🔍+</button>
    </div>
  );
}

function measureFitFontSize(text: string, boxWpx: number, maxFs: number, fontFamily: string, bold: boolean): number {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return maxFs;
    let fs = maxFs;
    ctx.font = `${bold ? 'bold ' : ''}${fs}px ${fontFamily}, Impact, sans-serif`;
    while (fs > 6 && ctx.measureText(text).width > boxWpx * 0.92) {
      fs -= 0.5;
      ctx.font = `${bold ? 'bold ' : ''}${fs}px ${fontFamily}, Impact, sans-serif`;
    }
    return Math.round(fs * 10) / 10;
  } catch { return maxFs; }
}

function FitTextBox({ el, text, containerW, containerH, isActive, showBox }: {
  el: TextEl; text: string; containerW: number; containerH: number;
  isActive?: boolean; showBox?: boolean;
}) {
  const boxWpx = ((el.boxW ?? 40) / 100) * containerW;
  const boxHpx = ((el.boxH ?? 12) / 100) * containerH;
  const maxFs  = boxHpx * 0.82;
  const [fontSize, setFontSize] = useState(maxFs);

  useLayoutEffect(() => {
    setFontSize(measureFitFontSize(text, boxWpx, maxFs, el.fontFamily, el.bold));
  }, [el.boxW, el.boxH, el.fontFamily, el.bold, text, containerW, containerH]);

  const scale = el.decimalFontScale != null && el.decimalFontScale < 1 ? el.decimalFontScale : 1;
  const decMatch = scale < 1 ? text.match(/^(.*?)([.,]\d{1,3})([\D]*)$/) : null;
  const content = decMatch
    ? (<>
        <span style={{ verticalAlign: 'bottom' }}>{decMatch[1]}</span>
        <span style={{ fontSize: `${scale}em`, verticalAlign: 'bottom' }}>{decMatch[2]}{decMatch[3]}</span>
      </>)
    : text;

  const justifyContent = el.textAnchor === 'right' ? 'flex-end' : el.textAnchor === 'left' ? 'flex-start' : 'center';
  return (
    <div style={{
      position: 'absolute',
      left: `${el.x}%`, top: `${el.y}%`,
      width: `${el.boxW ?? 40}%`, height: `${el.boxH ?? 12}%`,
      display: 'flex', alignItems: 'center', justifyContent,
      overflow: 'hidden',
      boxSizing: 'border-box',
      border: showBox
        ? isActive
          ? '2px dashed rgba(99,102,241,0.9)'
          : '1px dashed rgba(255,255,255,0.2)'
        : undefined,
      pointerEvents: 'none',
    }}>
      <span style={{
        fontSize: `${fontSize}px`,
        lineHeight: 1,
        fontFamily: el.fontFamily, fontWeight: el.bold ? 700 : 400,
        color: el.color,
        textDecoration: el.strikethrough ? `line-through ${el.strikethroughColor || el.color}` : 'none',
        WebkitTextStroke: el.strokeEnabled ? `${el.strokeWidth * containerW / 512}px ${el.strokeColor}` : undefined,
        whiteSpace: 'nowrap',
        letterSpacing: el.letterSpacing ? `${el.letterSpacing * containerW / 512}px` : undefined,
      }}>{content}</span>
    </div>
  );
}

export function TemplatePreviewer({ tpl, terminata, platform = 'amazon', onArrowMove, activeTextKey }: {
  tpl: Template; terminata?: TerminataConfig; platform?: 'amazon' | 'aliexpress';
  onArrowMove?: (dx: number, dy: number) => void;
  activeTextKey?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(340);
  useEffect(() => {
    if (containerRef.current) setContainerW(containerRef.current.clientWidth);
  }, []);

  const pp = tpl.product;
  const canvasW = tpl.canvasW ?? 1024;
  const canvasH = tpl.canvasH ?? 1024;
  // previewRef: lato del quadrato di riferimento nella preview, uguale a imageCompose canvasRef
  const containerH = containerW * canvasH / canvasW;
  const previewRef = Math.min(containerW, containerH);
  const ppBoxPx = (pp.size / 100) * previewRef; // box quadrato in pixel

  // fontScale esatto: canvas usa fontSize*2 su 1024px, quindi nella preview usiamo lo stesso rapporto
  const fontScale = (2 * containerW) / canvasW;
  // fontSize per il testo terminata: uguale al canvas (overlayTextSize% di containerW)
  const terminataFontPx = terminata ? (terminata.overlayTextSize / 100) * containerW : 0;

  const innerContent = (
    <>
      {/* Product placeholder box — quadrato come in imageCompose (usa previewRef, non %) */}
      <div style={{
        position: 'absolute', left: `${pp.x}%`, top: `${pp.y}%`,
        width: ppBoxPx, height: ppBoxPx,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px dashed rgba(128,128,128,0.3)',
        background: 'rgba(128,128,128,0.06)',
      }}>
        <span style={{ fontSize: `${pp.size * 0.4}px`, opacity: 0.45 }}>📦</span>
      </div>

      {/* Overlay */}
      {tpl.overlay.enabled && tpl.overlay.src && (
        <img src={tpl.overlay.src} alt="" style={{
          position: 'absolute', left: `${tpl.overlay.x}%`, top: `${tpl.overlay.y}%`,
          width: `${tpl.overlay.size}%`, height: `${tpl.overlay.size}%`,
          objectFit: 'contain', pointerEvents: 'none',
        }} />
      )}

      {/* Store icon — usa il campo in base alla platform passata */}
      {(() => {
        const storeEl = (platform === 'amazon' ? tpl.storeAmazon : tpl.storeAliexpress) ?? tpl.storeAmazon;
        if (!storeEl?.enabled) return null;
        const src = platform === 'amazon' ? '/store-amazon.png' : '/store-aliexpress.png';
        const scale = platform === 'amazon' ? 1 : 5 / 11;
        return (
          <img src={src} alt="store"
            style={{
              position: 'absolute', left: `${storeEl.x}%`, top: `${storeEl.y}%`,
              height: `${storeEl.size * scale}%`, width: 'auto', pointerEvents: 'none',
            }}
          />
        );
      })()}

      {/* Text elements */}
      {([
        { key: 'prezzo',           el: tpl.prezzo as TextEl,           text: (() => { const el = tpl.prezzo as TextEl; const sep = el.decimalSep ?? '.'; return el.currencyPos === 'after' ? `24${sep}99€` : `€24${sep}99`; })() },
        { key: 'prezzoPrecedente', el: tpl.prezzoPrecedente as TextEl, text: (() => { const el = tpl.prezzoPrecedente as TextEl; const sep = el.decimalSep ?? '.'; return el.currencyPos === 'after' ? `49${sep}99€` : `€49${sep}99`; })() },
        { key: 'sconto',           el: tpl.sconto as TextEl,           text: (() => { const el = tpl.sconto as TextEl; let t = '-50%'; if (el.hideMinus) t = t.replace(/^-/, ''); if (el.hidePercent) t = t.replace(/%$/, ''); return t; })() },
        { key: 'testoCustom',      el: tpl.testoCustom as TextEl,      text: tpl.testoCustom.text || 'Testo' },
      ]).map(({ key, el, text }, i) => {
        if (!el.enabled) return null;
        // Nuovo sistema: riquadro auto-fit
        if (el.boxW && el.boxH) {
          return (
            <FitTextBox key={i} el={el} text={text}
              containerW={containerW} containerH={containerH}
              isActive={activeTextKey === key}
              showBox={!!onArrowMove}
            />
          );
        }
        // Legacy: fontSize + textAnchor
        const scale = el.decimalFontScale != null && el.decimalFontScale < 1 ? el.decimalFontScale : 1;
        const decMatch = scale < 1 ? text.match(/^(.*?)([.,]\d{1,3})([\D]*)$/) : null;
        const content = decMatch
          ? (<>
              <span style={{ verticalAlign: 'bottom' }}>{decMatch[1]}</span>
              <span style={{ fontSize: `${scale}em`, verticalAlign: 'bottom' }}>{decMatch[2]}{decMatch[3]}</span>
            </>)
          : text;
        return (
          <div key={i} style={{
            position: 'absolute',
            ...(el.textAnchor === 'right'
              ? { right: `${100 - el.x}%`, top: `${el.y}%` }
              : el.textAnchor === 'center'
                ? { left: `${el.x}%`, top: `${el.y}%`, transform: 'translateX(-50%)' }
                : { left: `${el.x}%`, top: `${el.y}%` }),
            fontSize: `${el.fontSize * fontScale}px`,
            lineHeight: 1,
            fontFamily: el.fontFamily, fontWeight: el.bold ? 700 : 400,
            color: el.color,
            textDecoration: el.strikethrough ? `line-through ${el.strikethroughColor || el.color}` : 'none',
            WebkitTextStroke: el.strokeEnabled ? `${el.strokeWidth * fontScale}px ${el.strokeColor}` : undefined,
            whiteSpace: 'nowrap', pointerEvents: 'none',
          }}>{content}</div>
        );
      })}

      {/* Badge — sopra tutto, incluso il testo (z-index contenuto dentro isolation:isolate) */}
      {tpl.badge.enabled && tpl.badge.src && (
        <img src={tpl.badge.src} alt="" style={{
          position: 'absolute', left: `${tpl.badge.x}%`, top: `${tpl.badge.y}%`,
          width: `${tpl.badge.size}%`, objectFit: 'contain', pointerEvents: 'none', zIndex: 5,
        }} />
      )}
      {tpl.badge.enabled && !tpl.badge.src && (
        <div style={{
          position: 'absolute', left: `${tpl.badge.x}%`, top: `${tpl.badge.y}%`,
          background: '#fbbf24', color: '#000', fontSize: 7, padding: '2px 4px',
          borderRadius: 3, fontWeight: 700, pointerEvents: 'none', zIndex: 5,
        }}>🏆 MIN</div>
      )}
    </>
  );

  const arrowBtnStyle: React.CSSProperties = {
    position: 'absolute', width: 40, height: 40, borderRadius: '50%',
    background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 18,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: '1.5px solid rgba(255,255,255,0.25)', cursor: 'pointer', zIndex: 20,
    backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
  };

  return (
    <div ref={containerRef}
      style={{
        margin: '12px 16px', borderRadius: 10, overflow: 'hidden',
        position: 'relative', aspectRatio: `${tpl.canvasW ?? 1024}/${tpl.canvasH ?? 1024}`, background: tpl.bgColor,
        boxShadow: onArrowMove
          ? '0 0 0 3px var(--a1), 0 2px 16px rgba(0,0,0,0.4)'
          : '0 2px 16px rgba(0,0,0,0.4)',
        isolation: 'isolate',
        cursor: 'default',
        userSelect: 'none',
        transition: 'box-shadow .2s',
      }}>
      {/* Contenuto template — con eventuale grayscale terminata */}
      <div style={{
        position: 'absolute', inset: 0,
        filter: terminata?.grayscale ? 'grayscale(1)' : undefined,
      }}>
        {innerContent}
      </div>

      {/* Overlay testo TERMINATA — fuori dal grayscale, dimensione identica al canvas */}
      {terminata && terminata.overlayText && (
        <div style={{
          position: 'absolute',
          left: `${terminata.overlayTextX}%`,
          top: `${terminata.overlayTextY}%`,
          transform: 'translate(-50%, -50%)',
          fontSize: `${terminataFontPx}px`,
          fontWeight: 900, fontFamily: `"${terminata.overlayTextFont || 'Impact'}", Impact, Arial Black`,
          color: terminata.overlayTextColor,
          textShadow: `0 0 ${terminataFontPx * 0.08}px #000, 0 0 ${terminataFontPx * 0.04}px #000`,
          whiteSpace: 'nowrap', pointerEvents: 'none',
          textAlign: 'center', zIndex: 10,
          maxWidth: '95%', overflow: 'hidden',
        }}>
          {terminata.overlayText}
        </div>
      )}

      {/* Bottoni freccia sovrapposti quando elemento attivo */}
      {onArrowMove && (
        <>
          <button onClick={() => onArrowMove(0, -1)} style={{ ...arrowBtnStyle, top: 8, left: '50%', transform: 'translateX(-50%)' }}>↑</button>
          <button onClick={() => onArrowMove(0, 1)} style={{ ...arrowBtnStyle, bottom: 8, left: '50%', transform: 'translateX(-50%)' }}>↓</button>
          <button onClick={() => onArrowMove(-1, 0)} style={{ ...arrowBtnStyle, left: 8, top: '50%', transform: 'translateY(-50%)' }}>←</button>
          <button onClick={() => onArrowMove(1, 0)} style={{ ...arrowBtnStyle, right: 8, top: '50%', transform: 'translateY(-50%)' }}>→</button>
        </>
      )}
    </div>
  );
}

// ── Component panels ──────────────────────────────────────────

function ProductPanel({ el, onUpdate }: {
  el: { x: number; y: number; size: number };
  onUpdate: (ch: Partial<{ x: number; y: number; size: number }>) => void;
}) {
  return (
    <>
      <DragHint x={el.x} y={el.y} onCenter={() => onUpdate({ x: Math.round((100 - el.size) / 2), y: Math.round((100 - el.size) / 2) })} />
    </>
  );
}

function OverlayImgPanel({ el, onUpdate, onFile }: {
  el: ImgEl;
  onUpdate: (ch: Partial<ImgEl>) => void;
  onFile: (f: File | null) => void;
}) {
  return (
    <>
      <DragHint x={el.x} y={el.y} onCenter={() => onUpdate({ x: Math.round((100 - el.size) / 2), y: Math.round((100 - el.size) / 2) })} />
      <label className="btn bs" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', justifyContent: 'center', marginBottom: 6 }}>
        🖼️ {el.src ? '✓ Overlay caricato — cambia' : 'Carica overlay PNG'}
        <input type="file" accept="image/png,image/webp" style={{ display: 'none' }}
          onChange={e => onFile(e.target.files?.[0] ?? null)} />
      </label>
      {el.src && (
        <button className="btn bgh bsm" style={{ color: 'var(--re)', width: '100%' }}
          onClick={() => onUpdate({ src: null })}>× Rimuovi overlay</button>
      )}
    </>
  );
}

function BadgeImgPanel({ el, onUpdate, onFile }: {
  el: ImgEl;
  onUpdate: (ch: Partial<ImgEl>) => void;
  onFile: (f: File | null) => void;
}) {
  return (
    <>
      <DragHint x={el.x} y={el.y} onCenter={() => onUpdate({ x: Math.round((100 - el.size) / 2), y: Math.round((100 - el.size) / 2) })} />
      <label className="btn bs" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', justifyContent: 'center', marginBottom: 6 }}>
        🏆 {el.src ? '✓ Icona caricata — cambia' : 'Carica icona badge'}
        <input type="file" accept="image/*" style={{ display: 'none' }}
          onChange={e => onFile(e.target.files?.[0] ?? null)} />
      </label>
      {el.src && (
        <button className="btn bgh bsm" style={{ color: 'var(--re)', width: '100%' }}
          onClick={() => onUpdate({ src: null })}>× Rimuovi icona</button>
      )}
    </>
  );
}

function StorePanel({ tpl, onUpdate, onPreviewPlatform }: {
  tpl: Template;
  onUpdate: (key: 'storeAmazon' | 'storeAliexpress', ch: Partial<ImgEl>) => void;
  onPreviewPlatform: (p: 'amazon' | 'aliexpress') => void;
}) {
  const [tab, setTab] = useState<'amazon' | 'aliexpress'>('amazon');
  const el = tab === 'amazon' ? tpl.storeAmazon : tpl.storeAliexpress;
  const key = tab === 'amazon' ? 'storeAmazon' : 'storeAliexpress';

  const switchTab = (p: 'amazon' | 'aliexpress') => {
    setTab(p);
    onPreviewPlatform(p);
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {(['amazon', 'aliexpress'] as const).map(p => (
          <button key={p} onClick={() => switchTab(p)}
            style={{
              flex: 1, padding: '5px 0', borderRadius: 8, fontSize: 12, cursor: 'pointer',
              border: '1px solid var(--bd)',
              background: tab === p ? 'var(--a1)' : 'var(--bg2)',
              color: tab === p ? '#fff' : 'var(--t1)',
              fontWeight: tab === p ? 700 : 400,
            }}>
            {p === 'amazon' ? '🟠 Amazon' : '🔴 AliExpress'}
          </button>
        ))}
      </div>
      <DragHint x={el.x} y={el.y} onCenter={() => onUpdate(key, { x: Math.round((100 - el.size) / 2), y: Math.round((100 - el.size) / 2) })} />
    </>
  );
}

const FONTS = [
  'Aero',
  'Arial',
  'Bangers',
  'Built Titling Lt It',
  'Comix Loud',
  'Designer',
  'Digital 7',
  'Gotham Rounded',
  'Impact',
  'Lobster',
  'Montserrat',
  'Montserrat Black Italic',
  'Montserrat ExtraBold Italic',
  'Open Sans',
  'Open Sans Bold',
  'The Blacklist',
];

function TextElPanel({ el, onUpdate, showTextInput = false, canvasH = 1024, showCurrencyPos = false, showSconto = false }: {
  el: TextEl;
  onUpdate: (ch: Partial<TextEl>) => void;
  showTextInput?: boolean;
  canvasH?: number;
  showCurrencyPos?: boolean;
  showSconto?: boolean;
}) {
  return (
    <>
      {showTextInput && (
        <div style={{ marginBottom: 12 }}>
          <div className="lbl">TESTO</div>
          <input className="inp" value={el.text} onChange={e => onUpdate({ text: e.target.value })} placeholder="Testo personalizzato..." />
        </div>
      )}

      <DragHint x={el.x} y={el.y} onCenter={() => {
        const bw = el.boxW ?? 40; const bh = el.boxH ?? 12;
        onUpdate({ x: Math.round((100 - bw) / 2), y: Math.round((100 - bh) / 2) });
      }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className="lbl" style={{ marginBottom: 0, flex: 1 }}>LARGHEZZA RIQUADRO</span>
        <input type="range" min={5} max={100} step={1}
          value={el.boxW ?? 40}
          style={{ flex: 2, accentColor: 'var(--a1)' }}
          onChange={e => onUpdate({ boxW: Number(e.target.value) })} />
        <span style={{ fontSize: 11, color: 'var(--t2)', width: 32, textAlign: 'right' }}>{el.boxW ?? 40}%</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span className="lbl" style={{ marginBottom: 0, flex: 1 }}>ALTEZZA RIQUADRO</span>
        <input type="range" min={2} max={50} step={1}
          value={el.boxH ?? 12}
          style={{ flex: 2, accentColor: 'var(--a1)' }}
          onChange={e => onUpdate({ boxH: Number(e.target.value) })} />
        <span style={{ fontSize: 11, color: 'var(--t2)', width: 32, textAlign: 'right' }}>{el.boxH ?? 12}%</span>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div className="lbl">ANCORAGGIO TESTO</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['left', 'center', 'right'] as const).map(a => (
            <button key={a} className={`btn bsm ${(el.textAnchor ?? 'center') === a ? 'bp' : 'bgh'}`}
              style={{ flex: 1 }} onClick={() => onUpdate({ textAnchor: a })}>
              {a === 'left' ? '⬅ Sin.' : a === 'center' ? '⇔ Centro' : 'Des. ➡'}
            </button>
          ))}
        </div>
      </div>

      {showCurrencyPos && (
        <div style={{ marginBottom: 12 }}>
          <div className="lbl">POSIZIONE SIMBOLO €</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={`btn bsm ${(el.currencyPos ?? 'before') === 'before' ? 'bp' : 'bgh'}`}
              style={{ flex: 1 }} onClick={() => onUpdate({ currencyPos: 'before' })}>€ Sinistra</button>
            <button className={`btn bsm ${el.currencyPos === 'after' ? 'bp' : 'bgh'}`}
              style={{ flex: 1 }} onClick={() => onUpdate({ currencyPos: 'after' })}>Destra €</button>
          </div>
        </div>
      )}

      {showCurrencyPos && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span className="lbl" style={{ marginBottom: 0, flex: 1 }}>DIMENSIONE DECIMALI</span>
          <input type="range" min={40} max={100} step={5}
            value={Math.round((el.decimalFontScale ?? 1) * 100)}
            style={{ flex: 2, accentColor: 'var(--a1)' }}
            onChange={e => onUpdate({ decimalFontScale: Number(e.target.value) / 100 })} />
          <span style={{ fontSize: 11, color: 'var(--t2)', width: 32, textAlign: 'right' }}>
            {Math.round((el.decimalFontScale ?? 1) * 100)}%
          </span>
        </div>
      )}

      {showCurrencyPos && (
        <div style={{ marginBottom: 12 }}>
          <div className="lbl">SEPARATORE DECIMALE</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={`btn bsm ${(el.decimalSep ?? '.') === '.' ? 'bp' : 'bgh'}`}
              style={{ flex: 1 }} onClick={() => onUpdate({ decimalSep: '.' })}>. Punto</button>
            <button className={`btn bsm ${el.decimalSep === ',' ? 'bp' : 'bgh'}`}
              style={{ flex: 1 }} onClick={() => onUpdate({ decimalSep: ',' })}>&#44; Virgola</button>
          </div>
        </div>
      )}

      {showSconto && (
        <div style={{ marginBottom: 12 }}>
          <div className="lbl">SIMBOLI SCONTO</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={`btn bsm ${!el.hideMinus ? 'bp' : 'bgh'}`}
              style={{ flex: 1 }} onClick={() => onUpdate({ hideMinus: !el.hideMinus })}>
              {el.hideMinus ? '— Nascosto' : '— Visibile'}
            </button>
            <button className={`btn bsm ${!el.hidePercent ? 'bp' : 'bgh'}`}
              style={{ flex: 1 }} onClick={() => onUpdate({ hidePercent: !el.hidePercent })}>
              % {el.hidePercent ? 'Nascosto' : 'Visibile'}
            </button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 8 }}>
        <div className="lbl">FONT</div>
        <select className="sel" value={el.fontFamily} onChange={e => onUpdate({ fontFamily: e.target.value })}>
          {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span className="lbl" style={{ marginBottom: 0, flex: 1 }}>SPAZIATURA LETTERE (px)</span>
        <input type="number" className="inp" step="0.5" min="-10" max="100"
          style={{ width: 72, textAlign: 'right' }}
          value={el.letterSpacing ?? 0}
          onChange={e => onUpdate({ letterSpacing: parseFloat(e.target.value) || 0 })} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button className={`btn bsm ${el.bold ? 'bp' : 'bgh'}`} style={{ flex: 1, fontWeight: 700 }}
          onClick={() => onUpdate({ bold: !el.bold })}>B Grassetto</button>
        <button className={`btn bsm ${el.strikethrough ? 'bp' : 'bgh'}`} style={{ flex: 1, textDecoration: 'line-through' }}
          onClick={() => onUpdate({ strikethrough: !el.strikethrough })}>S Barrato</button>
      </div>

      {el.strikethrough && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span className="lbl" style={{ marginBottom: 0, flex: 1 }}>COLORE BARRA BARRATO</span>
          <input type="color" value={el.strikethroughColor || el.color}
            style={{ width: 40, height: 30, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
            onChange={e => onUpdate({ strikethroughColor: e.target.value })} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <span className="lbl" style={{ marginBottom: 0, flex: 1 }}>COLORE TESTO</span>
        <input type="color" value={el.color} style={{ width: 40, height: 30, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
          onChange={e => onUpdate({ color: e.target.value })} />
        <span style={{ fontSize: 11, color: 'var(--t3)', minWidth: 52 }}>{el.color}</span>
      </div>

      <div style={{ background: 'var(--bg3)', borderRadius: 8, marginBottom: 10 }}>
        <ToggleRow label="Bordo testo" value={el.strokeEnabled} onChange={v => onUpdate({ strokeEnabled: v })} />
      </div>
      {el.strokeEnabled && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span className="lbl" style={{ marginBottom: 0, flex: 1 }}>COLORE BORDO</span>
            <input type="color" value={el.strokeColor} style={{ width: 40, height: 30, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
              onChange={e => onUpdate({ strokeColor: e.target.value })} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span className="lbl" style={{ marginBottom: 0, flex: 1 }}>SPESSORE BORDO</span>
            <input type="range" min={1} max={10} value={el.strokeWidth}
              style={{ flex: 2, accentColor: 'var(--a1)' }}
              onChange={e => onUpdate({ strokeWidth: Number(e.target.value) })} />
            <span style={{ fontSize: 11, color: 'var(--t2)', width: 20, textAlign: 'right' }}>{el.strokeWidth}</span>
          </div>
        </>
      )}
    </>
  );
}

// ── Multi Previewer ───────────────────────────────────────────
function MultiPreviewer({ tpl }: { tpl: Template }) {
  const mb: MultiBarConfig   = tpl.multiBar  ?? { enabled: false, src: null, height: 60 };
  const mp: MultiPriceConfig = tpl.multiPrice ?? { enabled: false, bgColor: '#1a1a1a', textColor: '#ffffff', height: 36 };
  const N = 6; const cols = 3; const rows = 2;
  const previewW = 330;
  const cellSizePx = Math.round(previewW / cols);
  const barHpx    = mb.enabled && mb.src ? Math.round((mb.height ?? 60) * previewW / 1024) : 0;
  const priceHpx  = mp.enabled ? Math.round((mp.height ?? 36) * previewW / 1024) : 0;
  const totalH    = barHpx + rows * (cellSizePx + priceHpx);

  return (
    <div style={{ margin: '0 16px 8px', border: '1px solid var(--bd)', borderRadius: 6, overflow: 'hidden', background: '#fff', position: 'relative', width: previewW, height: totalH }}>
      {barHpx > 0 && mb.src && (
        <img src={mb.src} alt="" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: barHpx, objectFit: 'fill', display: 'block' }} />
      )}
      {Array.from({ length: N }).map((_, i) => {
        const col = i % cols; const row = Math.floor(i / cols);
        return (
          <div key={i} style={{
            position: 'absolute', left: col * cellSizePx, top: barHpx + row * (cellSizePx + priceHpx),
            width: cellSizePx, height: cellSizePx,
            background: '#e5e7eb', border: '1px solid #d1d5db',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
          }}>📦</div>
        );
      })}
      {mp.enabled && priceHpx > 0 && Array.from({ length: N }).map((_, i) => {
        const col = i % cols; const row = Math.floor(i / cols);
        return (
          <div key={`p${i}`} style={{
            position: 'absolute', left: col * cellSizePx, top: barHpx + row * (cellSizePx + priceHpx) + cellSizePx,
            width: cellSizePx, height: priceHpx,
            background: mp.bgColor ?? '#1a1a1a',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ color: mp.textColor ?? '#ffffff', fontSize: Math.max(9, Math.round(Math.min(priceHpx * 0.9, cellSizePx * 0.10))), fontWeight: 700, fontFamily: mp.fontFamily ?? 'Arial' }}>{mp.currencyPos === 'after' ? '12,99€' : '€12,99'}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Multiplo Panel ────────────────────────────────────────────
function MultipliPanel({ tpl, onUpdate }: { tpl: Template; onUpdate: (ch: Partial<Template>) => void }) {
  const mb: MultiBarConfig   = tpl.multiBar  ?? { enabled: false, src: null, height: 60 };
  const mp: MultiPriceConfig = tpl.multiPrice ?? { enabled: false, bgColor: '#1a1a1a', textColor: '#ffffff', height: 36 };
  const barH = mb.height ?? 60;

  const handleBarFile = async (file: File | null) => {
    if (!file) return;
    const b64 = await readAsBase64(file);
    onUpdate({ multiBar: { ...mb, src: b64 as string } });
  };

  return (
    <>
      <div className="stit">BARRA IN ALTO</div>
      <ToggleRow label="Barra superiore" sub="Aggiunge un'immagine in cima alla griglia (es. logo o banner)"
        value={mb.enabled} onChange={v => onUpdate({ multiBar: { ...mb, enabled: v } })} />
      {mb.enabled && (
        <>
          <div className="fld">
            <label className="lbl">Altezza ({barH}px) — immagine consigliata: 1024 × {barH}px</label>
            <input type="range" min={30} max={150} value={barH}
              onChange={e => onUpdate({ multiBar: { ...mb, height: Number(e.target.value) } })}
              style={{ width: '100%', marginTop: 10 }} />
          </div>
          <button className="btn bgh" style={{ width: '100%', marginBottom: 8, position: 'relative', overflow: 'hidden' }}>
            {mb.src ? '✓ Immagine caricata — cambia' : '+ Carica immagine barra (PNG/JPG)'}
            <input type="file" accept="image/*" onChange={e => handleBarFile(e.target.files?.[0] ?? null)}
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
          </button>
          {mb.src && (
            <button className="btn bgh" style={{ width: '100%', fontSize: 12, marginBottom: 8 }}
              onClick={() => onUpdate({ multiBar: { ...mb, src: null } })}>× Rimuovi immagine</button>
          )}
        </>
      )}

      <div className="stit" style={{ marginTop: 8 }}>PREZZO SOTTO OGNI PRODOTTO</div>
      <ToggleRow label="Mostra prezzo" sub="Aggiunge il prezzo scontato sotto ogni foto prodotto"
        value={mp.enabled} onChange={v => onUpdate({ multiPrice: { ...mp, enabled: v } })} />
      {mp.enabled && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div className="fld" style={{ margin: 0 }}>
              <label className="lbl">Sfondo</label>
              <input type="color" className="inp" value={mp.bgColor || '#1a1a1a'}
                onChange={e => onUpdate({ multiPrice: { ...mp, bgColor: e.target.value } })}
                style={{ height: 40, padding: 4, cursor: 'pointer' }} />
            </div>
            <div className="fld" style={{ margin: 0 }}>
              <label className="lbl">Testo</label>
              <input type="color" className="inp" value={mp.textColor || '#ffffff'}
                onChange={e => onUpdate({ multiPrice: { ...mp, textColor: e.target.value } })}
                style={{ height: 40, padding: 4, cursor: 'pointer' }} />
            </div>
          </div>
          <div className="fld">
            <label className="lbl">Altezza banda ({mp.height || 36}px)</label>
            <input type="range" min={24} max={64} value={mp.height || 36}
              onChange={e => onUpdate({ multiPrice: { ...mp, height: Number(e.target.value) } })}
              style={{ width: '100%', marginTop: 10 }} />
          </div>
          <div className="fld">
            <label className="lbl">Font</label>
            <select className="sel" value={mp.fontFamily ?? 'Arial'}
              onChange={e => onUpdate({ multiPrice: { ...mp, fontFamily: e.target.value } })}>
              {FONTS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
            </select>
          </div>
          <div className="fld">
            <label className="lbl">Simbolo valuta</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={`btn bsm ${(mp.currencyPos ?? 'before') === 'before' ? 'bp' : 'bgh'}`}
                style={{ flex: 1 }} onClick={() => onUpdate({ multiPrice: { ...mp, currencyPos: 'before' } })}>€ Sinistra</button>
              <button className={`btn bsm ${mp.currencyPos === 'after' ? 'bp' : 'bgh'}`}
                style={{ flex: 1 }} onClick={() => onUpdate({ multiPrice: { ...mp, currencyPos: 'after' } })}>Destra €</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ── Template Section ──────────────────────────────────────────

type ComponentKey = 'product' | 'overlay' | 'badge' | 'prezzo' | 'prezzoPrecedente' | 'sconto' | 'testoCustom' | 'store' | 'terminata' | 'multiplo';

const COMP_INFO: Record<ComponentKey, string> = {
  product:          '📦 Riquadro dove verrà inserita la foto del prodotto Amazon/AliExpress. Usa le frecce sull\'anteprima per spostarlo e 🔍 per ridimensionarlo.',
  overlay:          '🖼️ Immagine sovrapposta (cornice, sfondo decorativo). Carica un PNG con trasparenza. Dimensioni canvas: min 600×600, max 1320×800 — si adatta automaticamente alle dimensioni dell\'overlay caricato.',
  badge:            '🏆 Icona visibile solo sui prodotti al minimo storico. Viene disegnata sopra tutti gli altri layer. Carica un PNG e posizionalo.',
  prezzo:           '💰 Prezzo scontato — inserito automaticamente dal post. Spostalo, scegli font e colore.',
  prezzoPrecedente: '📉 Prezzo precedente (barrato) — inserito automaticamente. Puoi cambiare il colore della barra barrata separatamente.',
  sconto:           '🏷️ Percentuale di sconto — calcolata automaticamente (es. -50%). Impostane font, colore e posizione.',
  testoCustom:      '📝 Testo libero personalizzabile. Corrisponde al campo "Testo custom" del post.',
  store:            '🏪 Logo negozio — seleziona Amazon o AliExpress e regola posizione/dimensione per ciascuno.',
  terminata:        '🚫 Configura come appare il post quando l\'offerta termina: immagine B&N, testo overlay, elementi visibili e layout Telegram.',
  multiplo:         '📊 Impostazioni per post multipli: barra colorata in cima alla griglia e prezzo sotto ogni foto prodotto.',
};

const COMP_BUTTONS: { id: ComponentKey; icon: string; label: string }[] = [
  { id: 'product',          icon: '📦', label: 'Foto' },
  { id: 'overlay',          icon: '🖼️', label: 'Overlay' },
  { id: 'badge',            icon: '🏆', label: 'Badge' },
  { id: 'prezzo',           icon: '💰', label: 'Prezzo' },
  { id: 'prezzoPrecedente', icon: '📉', label: 'Prec.' },
  { id: 'sconto',           icon: '🏷️', label: 'Sconto' },
  { id: 'testoCustom',      icon: '📝', label: 'Testo' },
  { id: 'store',            icon: '🏪', label: 'Store' },
  { id: 'multiplo',         icon: '📊', label: 'Multiplo' },
  { id: 'terminata',        icon: '🚫', label: 'Terminata' },
];

function getElEnabled(id: ComponentKey, tpl: Template): boolean {
  if (id === 'product' || id === 'terminata') return true;
  if (id === 'multiplo') return !!(tpl.multiBar?.enabled || tpl.multiPrice?.enabled);
  if (id === 'store') return tpl.storeAmazon?.enabled || tpl.storeAliexpress?.enabled || false;
  if (id === 'overlay' || id === 'badge') return (tpl[id] as ImgEl).enabled;
  return (tpl[id] as TextEl).enabled;
}

function TemplateSection() {
  const { templates, setTemplates, templateFromDB } = useApp();
  const [selectedTplId, setSelectedTplId] = useState('');
  const [activePanel, setActivePanel] = useState<ComponentKey | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [previewPlatform, setPreviewPlatform] = useState<'amazon' | 'aliexpress'>('amazon');
  const [arrowStep, setArrowStep] = useState(1);
  const creatingTplRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestTplRef = useRef<Template | null>(null);

  const tpl = (selectedTplId ? templates.find(t => t.id === selectedTplId) : null) ?? templates[0] ?? makeDefaultTemplate('tpl1');

  // Aggiorna il ref ogni render così visibilitychange vede sempre l'ultimo stato
  latestTplRef.current = tpl;

  const saveTpl = (t: Template) => {
    if (!templateFromDB.current) return;
    latestTplRef.current = t;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      // Non usare create come fallback: se il profilo è cambiato durante il debounce
      // il template verrebbe ricreato sotto il profilo sbagliato
      templatesApi.update(t.id, t).catch(() => {});
    }, 800);
  };

  useEffect(() => {
    const handleHide = () => {
      if (!document.hidden) return;
      const t = latestTplRef.current;
      if (!t || !templateFromDB.current) return;
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      const initData = (window as any).Telegram?.WebApp?.initData ?? '';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (initData) headers['x-tg-init-data'] = initData;
      try { const pid = localStorage.getItem('activeProfileId'); if (pid) headers['x-profile-id'] = pid; } catch {}
      fetch(`/api/templates/${t.id}`, { method: 'PUT', headers, body: JSON.stringify(t), keepalive: true }).catch(() => {});
    };
    document.addEventListener('visibilitychange', handleHide);
    return () => document.removeEventListener('visibilitychange', handleHide);
  }, []);  // eslint-disable-line

  const updateTpl = (changes: Partial<Template>) => {
    const id = tpl.id;
    setTemplates(ts => {
      const idx = ts.findIndex(t => t.id === id);
      if (idx < 0) return ts;
      const updated = { ...ts[idx], ...changes };
      saveTpl(updated);
      const n = [...ts]; n[idx] = updated; return n;
    });
  };

  const updateImg = (key: 'overlay' | 'badge' | 'storeAmazon' | 'storeAliexpress', changes: Partial<ImgEl>) => {  // eslint-disable-line
    const id = tpl.id;
    setTemplates(ts => {
      const idx = ts.findIndex(t => t.id === id);
      if (idx < 0) return ts;
      const updated = { ...ts[idx], [key]: { ...(ts[idx][key] as ImgEl), ...changes } };
      saveTpl(updated);
      const n = [...ts]; n[idx] = updated; return n;
    });
  };

  const updateText = (key: 'prezzo' | 'prezzoPrecedente' | 'sconto' | 'testoCustom', changes: Partial<TextEl>) => {
    const id = tpl.id;
    setTemplates(ts => {
      const idx = ts.findIndex(t => t.id === id);
      if (idx < 0) return ts;
      const updated = { ...ts[idx], [key]: { ...(ts[idx][key] as TextEl), ...changes } };
      saveTpl(updated);
      const n = [...ts]; n[idx] = updated; return n;
    });
  };

  const updateProduct = (changes: Partial<{ x: number; y: number; size: number }>) => {
    const id = tpl.id;
    setTemplates(ts => {
      const idx = ts.findIndex(t => t.id === id);
      if (idx < 0) return ts;
      const updated = { ...ts[idx], product: { ...ts[idx].product, ...changes } };
      saveTpl(updated);
      const n = [...ts]; n[idx] = updated; return n;
    });
  };

  const createTpl = () => {
    if (creatingTplRef.current) return;
    creatingTplRef.current = true;
    const tempId = `tpl_${Date.now()}`;
    const newTpl: Template = { ...tpl, id: tempId, name: `${tpl.name ? tpl.name + ' (copia)' : 'Nuovo Template'}` };
    setTemplates(ts => [...ts, newTpl]);
    setSelectedTplId(tempId);
    templatesApi.create(newTpl).then(created => {
      if (created.id !== tempId) {
        setTemplates(ts => ts.map(t => t.id === tempId ? { ...t, id: created.id } : t));
        setSelectedTplId(created.id);
      }
    }).catch(() => {}).finally(() => { creatingTplRef.current = false; });
  };

  const deleteTpl = (id: string) => {
    if (templates.length <= 1) return;
    const remaining = templates.filter(t => t.id !== id);
    setTemplates(remaining);
    if (selectedTplId === id || tpl.id === id) setSelectedTplId(remaining[0]?.id ?? '');
    templatesApi.delete(id).catch(() => {});
  };

  const handleFile = async (key: 'overlay' | 'badge', file: File | null) => {
    if (!file) return;
    const b64 = await readAsBase64(file);
    if (key === 'overlay') {
      const img = new Image();
      img.onload = () => {
        // Scala proporzionalmente: lato lungo max 2048px (Telegram comprime oltre, Safari crasha)
        // Rispetta anche il limite Telegram: aspect ratio max 20:1
        const MAX_SIDE = 2048;
        const longest = Math.max(img.naturalWidth, img.naturalHeight);
        const scale = longest > MAX_SIDE ? MAX_SIDE / longest : 1;
        let w = Math.round(img.naturalWidth * scale);
        let h = Math.round(img.naturalHeight * scale);
        // Corregge aspect ratio estremi (limite Telegram 20:1)
        if (w / h > 20) h = Math.round(w / 20);
        if (h / w > 20) w = Math.round(h / 20);
        // Reset overlay a dimensione piena: riempie il canvas senza bordi bianchi
        updateTpl({ canvasW: w, canvasH: h });
        updateImg('overlay', { x: 0, y: 0, size: 100 });
      };
      img.src = b64 as string;
    }
    updateImg(key, { src: b64 });
  };

  const isTextKey = (k: ComponentKey): k is 'prezzo' | 'prezzoPrecedente' | 'sconto' | 'testoCustom' =>
    ['prezzo', 'prezzoPrecedente', 'sconto', 'testoCustom'].includes(k);
  const isMultiKey = (k: ComponentKey): k is 'multiplo' => k === 'multiplo';

  const getActiveZoom = (): { value: number; min: number; max: number; unit: string; onChange: (v: number) => void } | null => {
    if (!activePanel || activePanel === 'terminata') return null;
    if (activePanel === 'product') return { value: tpl.product.size, min: 20, max: 100, unit: '%' as const, onChange: v => updateProduct({ size: v }) };
    if (activePanel === 'overlay') return { value: tpl.overlay.size, min: 10, max: 100, unit: '%' as const, onChange: v => updateImg('overlay', { size: v }) };
    if (activePanel === 'badge') return { value: tpl.badge.size, min: 5, max: 50, unit: '%' as const, onChange: v => updateImg('badge', { size: v }) };
    if (activePanel === 'store') {
      const k = previewPlatform === 'amazon' ? 'storeAmazon' : 'storeAliexpress';
      const el = previewPlatform === 'amazon' ? tpl.storeAmazon : tpl.storeAliexpress;
      return { value: el.size, min: 5, max: 40, unit: '%' as const, onChange: v => updateImg(k, { size: v }) };
    }
    if (isTextKey(activePanel)) return null;
    return null;
  };

  const handleArrowMove = (dx: number, dy: number) => {
    if (!activePanel) return;
    const step = arrowStep;
    const clampPos = (v: number) => Math.min(100, Math.max(0, parseFloat((v + dx * step).toFixed(1))));
    const clampPosY = (v: number) => Math.min(100, Math.max(0, parseFloat((v + dy * step).toFixed(1))));
    if (activePanel === 'product') {
      updateProduct({ x: clampPos(tpl.product.x), y: clampPosY(tpl.product.y) });
    } else if (activePanel === 'overlay') {
      updateImg('overlay', { x: clampPos(tpl.overlay.x), y: clampPosY(tpl.overlay.y) });
    } else if (activePanel === 'badge') {
      updateImg('badge', { x: clampPos(tpl.badge.x), y: clampPosY(tpl.badge.y) });
    } else if (activePanel === 'store') {
      const key = previewPlatform === 'amazon' ? 'storeAmazon' : 'storeAliexpress';
      const el = previewPlatform === 'amazon' ? tpl.storeAmazon : tpl.storeAliexpress;
      updateImg(key, { x: clampPos(el.x), y: clampPosY(el.y) });
    } else if (isTextKey(activePanel)) {
      const el = tpl[activePanel] as TextEl;
      updateText(activePanel, { x: clampPos(el.x), y: clampPosY(el.y) });
    }
  };

  const toggleEnabled = (id: ComponentKey) => {
    if (id === 'product' || id === 'terminata' || id === 'multiplo') return;
    const cur = getElEnabled(id, tpl);
    if (id === 'store') {
      updateImg('storeAmazon', { enabled: !cur });
      updateImg('storeAliexpress', { enabled: !cur });
    } else if (id === 'overlay' || id === 'badge') {
      updateImg(id, { enabled: !cur });
    } else {
      updateText(id as 'prezzo' | 'prezzoPrecedente' | 'sconto' | 'testoCustom', { enabled: !cur });
    }
  };

  return (
    <>
      {/* Bottoni + toggle ON/OFF + ℹ️ SOPRA l'anteprima */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, padding: '10px 16px 8px' }}>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', flex: 1 }}>
          {COMP_BUTTONS.map(b => {
            const enabled = getElEnabled(b.id, tpl);
            const isActive = activePanel === b.id;
            const canToggle = b.id !== 'product';
            return (
              <div key={b.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0, width: 54 }}>
                <button
                  className={`btn bsm ${isActive ? 'bp' : 'bgh'}`}
                  style={{
                    width: 54, padding: '6px 2px',
                    opacity: canToggle && !enabled ? 0.45 : 1,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  }}
                  onClick={() => setActivePanel(isActive ? null : b.id)}
                >
                  <span style={{ fontSize: 18, lineHeight: 1 }}>{b.icon}</span>
                  <span style={{ fontSize: 10, lineHeight: 1.2, textAlign: 'center' }}>{b.label}</span>
                </button>
                {canToggle && (
                  <button
                    onClick={() => toggleEnabled(b.id)}
                    style={{
                      fontSize: 9, padding: '1px 8px', borderRadius: 8, cursor: 'pointer',
                      background: enabled ? 'var(--a1)' : 'var(--bg3)',
                      color: enabled ? '#fff' : 'var(--t3)',
                      border: 'none', lineHeight: 1.6, width: 54,
                    }}
                  >{enabled ? 'ON' : 'OFF'}</button>
                )}
              </div>
            );
          })}
        </div>
        {/* Bottone info contestuale */}
        <button
          className={`btn bsm ${showInfo ? 'bp' : 'bgh'}`}
          style={{ flexShrink: 0, marginLeft: 6, fontSize: 14, padding: '4px 10px' }}
          onClick={() => setShowInfo(v => !v)}
          title="Info componente"
        >ℹ️</button>
      </div>

      {/* Box info contestuale */}
      {showInfo && activePanel && (
        <div style={{
          margin: '0 16px 6px', padding: '10px 12px',
          background: 'var(--bg3)', borderRadius: 8, borderLeft: '3px solid var(--a1)',
          fontSize: 12, color: 'var(--t2)', lineHeight: 1.5,
        }}>
          {COMP_INFO[activePanel]}
        </div>
      )}
      {showInfo && !activePanel && (
        <div style={{
          margin: '0 16px 6px', padding: '10px 12px',
          background: 'var(--bg3)', borderRadius: 8,
          fontSize: 12, color: 'var(--t3)', fontStyle: 'italic',
        }}>
          Seleziona un componente per vedere le informazioni relative.
        </div>
      )}

      {/* Anteprima live — frecce per spostare l'elemento attivo */}
      {activePanel === 'multiplo' ? (
        <MultiPreviewer tpl={tpl} />
      ) : (
        <TemplatePreviewer
          tpl={tpl} platform={previewPlatform}
          onArrowMove={activePanel && activePanel !== 'terminata' && !isMultiKey(activePanel as ComponentKey) ? handleArrowMove : undefined}
          activeTextKey={activePanel && isTextKey(activePanel as ComponentKey) ? activePanel : null}
        />
      )}

      {/* Selettore step + zoom sulla stessa riga */}
      {activePanel && activePanel !== 'terminata' && !isMultiKey(activePanel as ComponentKey) && (() => {
        const zoom = getActiveZoom();
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 16px 0', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }}>Passo:</span>
            {[0.5, 1, 3, 5, 10].map(s => (
              <button key={s} className={`btn bsm ${arrowStep === s ? 'bp' : 'bgh'}`}
                style={{ fontSize: 10, padding: '2px 8px' }}
                onClick={() => setArrowStep(s)}>{s}%</button>
            ))}
            {zoom && (
              <>
                <div style={{ width: 1, height: 16, background: 'var(--bd)', margin: '0 2px', flexShrink: 0 }} />
                <button className="btn bgh bsm" style={{ padding: '2px 10px' }}
                  onClick={() => zoom.onChange(Math.max(zoom.min, zoom.value - 2))}>🔍−</button>
                <span style={{ fontSize: 11, color: 'var(--t2)', width: 36, textAlign: 'center' }}>{zoom.value}{zoom.unit ?? '%'}</span>
                <button className="btn bgh bsm" style={{ padding: '2px 10px' }}
                  onClick={() => zoom.onChange(Math.min(zoom.max, zoom.value + 2))}>🔍+</button>
              </>
            )}
          </div>
        );
      })()}

      {/* Pannello attivo — frecce subito sotto l'anteprima */}
      {activePanel && (
        <div style={{ padding: '10px 16px 16px', borderTop: '1px solid var(--bd)' }}>
          {activePanel === 'product' && (
            <ProductPanel el={tpl.product} onUpdate={updateProduct} />
          )}
          {activePanel === 'overlay' && (
            <OverlayImgPanel el={tpl.overlay} onUpdate={ch => updateImg('overlay', ch)} onFile={f => handleFile('overlay', f)} />
          )}
          {activePanel === 'badge' && (
            <BadgeImgPanel el={tpl.badge} onUpdate={ch => updateImg('badge', ch)} onFile={f => handleFile('badge', f)} />
          )}
          {activePanel === 'store' && (
            <StorePanel tpl={tpl} onUpdate={updateImg} onPreviewPlatform={setPreviewPlatform} />
          )}
          {isTextKey(activePanel) && (
            <TextElPanel
              el={tpl[activePanel] as TextEl}
              onUpdate={ch => updateText(activePanel as 'prezzo' | 'prezzoPrecedente' | 'sconto' | 'testoCustom', ch)}
              showTextInput={activePanel === 'testoCustom'}
              canvasH={tpl.canvasH ?? 1024}
              showCurrencyPos={activePanel === 'prezzo' || activePanel === 'prezzoPrecedente'}
              showSconto={activePanel === 'sconto'}
            />
          )}
          {activePanel === 'multiplo' && <MultipliPanel tpl={tpl} onUpdate={updateTpl} />}
          {activePanel === 'terminata' && <TerminataPanel />}
        </div>
      )}

      {!activePanel && (
        <InfoBanner>Seleziona un componente sopra per modificarlo. L'anteprima si aggiorna in tempo reale.</InfoBanner>
      )}
    </>
  );
}

// ── Terminata Panel ───────────────────────────────────────────
const DEFAULT_TERMINATA: TerminataConfig = {
  grayscale: true, overlayText: '❌ OFFERTA TERMINATA', overlayTextColor: '#ff0000',
  overlayTextSize: 7, overlayTextX: 50, overlayTextY: 50, overlayTextFont: 'Impact',
  showPrezzo: true, showPrezzoPrecedente: false, showSconto: false, layoutId: '',
  telegramMode: 'keep', telegramText: '❌ Offerta terminata',
};

function TerminataPanel() {
  const { settings, setSettings, layouts, templates } = useApp();
  const [cfg, setCfg] = useState<TerminataConfig>(settings.terminata ?? DEFAULT_TERMINATA);
  const [saved, setSaved] = useState(false);
  const [terminataStep, setTerminataStep] = useState(1);

  const handleTerminataArrow = (dx: number, dy: number) => {
    const s = terminataStep;
    setCfg(prev => ({
      ...prev,
      overlayTextX: Math.min(95, Math.max(0, parseFloat((prev.overlayTextX + dx * s).toFixed(1)))),
      overlayTextY: Math.min(95, Math.max(0, parseFloat((prev.overlayTextY + dy * s).toFixed(1)))),
    }));
  };

  const update = <K extends keyof TerminataConfig>(k: K, v: TerminataConfig[K]) =>
    setCfg(prev => ({ ...prev, [k]: v }));

  const save = async () => {
    const newSettings = { ...settings, terminata: cfg };
    await settingsApi.save(newSettings);
    setSettings(newSettings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const activeTpl = templates[0];

  return (
    <>
      <div className="stit">IMMAGINE</div>
      <ToggleRow label="Bianco e nero" sub="Desatura prodotto + overlay" value={cfg.grayscale} onChange={v => update('grayscale', v)} />

      <div className="stit" style={{ marginTop: 8 }}>TESTO SULL'IMMAGINE</div>
      <div className="fld">
        <label className="lbl">Testo overlay</label>
        <input className="inp" value={cfg.overlayText} onChange={e => update('overlayText', e.target.value)} placeholder="❌ OFFERTA TERMINATA" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div className="fld" style={{ margin: 0 }}>
          <label className="lbl">Colore</label>
          <input type="color" className="inp" value={cfg.overlayTextColor} onChange={e => update('overlayTextColor', e.target.value)} style={{ height: 40, padding: 4, cursor: 'pointer' }} />
        </div>
        <div className="fld" style={{ margin: 0 }}>
          <label className="lbl">Dim. ({cfg.overlayTextSize}%)</label>
          <input type="range" min={3} max={15} value={cfg.overlayTextSize} onChange={e => update('overlayTextSize', Number(e.target.value))} style={{ width: '100%', marginTop: 10 }} />
        </div>
      </div>
      <div className="fld">
        <label className="lbl">Font</label>
        <select className="sel" value={cfg.overlayTextFont || 'Impact'} onChange={e => update('overlayTextFont', e.target.value)}>
          {FONTS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
        </select>
      </div>

      {/* Anteprima reale — frecce per spostare il testo overlay */}
      <div className="lbl" style={{ marginBottom: 4 }}>ANTEPRIMA</div>
      {activeTpl && (
        <TemplatePreviewer
          tpl={activeTpl} terminata={cfg}
          onArrowMove={handleTerminataArrow}
        />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 0 0' }}>
        <span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }}>Passo:</span>
        {[0.5, 1, 3].map(s => (
          <button key={s} className={`btn bsm ${terminataStep === s ? 'bp' : 'bgh'}`}
            style={{ fontSize: 10, padding: '2px 8px' }}
            onClick={() => setTerminataStep(s)}>{s}%</button>
        ))}
      </div>
      <DragHint
        x={cfg.overlayTextX} y={cfg.overlayTextY}
        onCenter={() => setCfg(prev => ({ ...prev, overlayTextX: 50, overlayTextY: 50 }))}
      />

      <div className="stit">ELEMENTI VISIBILI</div>
      <ToggleRow label="Mostra prezzo attuale" value={cfg.showPrezzo} onChange={v => update('showPrezzo', v)} />
      <ToggleRow label="Mostra prezzo precedente" value={cfg.showPrezzoPrecedente} onChange={v => update('showPrezzoPrecedente', v)} />
      <ToggleRow label="Mostra percentuale sconto" value={cfg.showSconto} onChange={v => update('showSconto', v)} />

      <div className="stit" style={{ marginTop: 8 }}>TESTO TELEGRAM</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {([
          { value: 'keep',   label: 'Mantieni testo', sub: 'Cambia solo immagine' },
          { value: 'append', label: 'Aggiungi scritta', sub: 'Testo originale + scritta' },
          { value: 'only',   label: 'Solo scritta', sub: 'Cancella testo originale' },
        ] as { value: TerminataConfig['telegramMode']; label: string; sub: string }[]).map(opt => (
          <button key={opt.value}
            onClick={() => update('telegramMode', opt.value)}
            className={`btn bsm ${(cfg.telegramMode ?? 'keep') === opt.value ? 'bp' : 'bgh'}`}
            style={{ flex: 1, flexDirection: 'column', height: 'auto', padding: '6px 4px', lineHeight: 1.3, whiteSpace: 'normal', textAlign: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700 }}>{opt.label}</span>
            <span style={{ fontSize: 9, opacity: 0.7, display: 'block' }}>{opt.sub}</span>
          </button>
        ))}
      </div>
      {(cfg.telegramMode ?? 'keep') !== 'keep' && (
        <div style={{ fontSize: 12, color: '#94a3b8', padding: '6px 8px', background: 'rgba(99,102,241,0.08)', borderRadius: 6, marginTop: 4 }}>
          La scritta mostrata è quella del tag <b>{'{terminata}'}</b> — modificala in <b>Impostazioni → Tag</b>.
        </div>
      )}

      <button className="btn bp bfull" style={{ marginTop: 8 }} onClick={save}>✅ Salva</button>
      {saved && <div style={{ marginTop: 8, color: '#4ade80', fontSize: 13, textAlign: 'center' }}>✓ Salvato</div>}
    </>
  );
}

// ============================================================
// SETTINGS PAGE
// ============================================================
const MARKETPLACES = ['IT', 'US', 'DE', 'FR', 'ES', 'UK', 'JP'];

const Chevron = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width={16} height={16}
    style={{ transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

// ── Monitor Page ──────────────────────────────────────────────
type AuthStep = 'idle' | 'code' | 'twofa' | 'active';

export function MonitorPage({ nav }: { nav: (p: NavPage) => void }) {
  const { activeProfileId } = useApp();
  const [step, setStep] = useState<AuthStep>('idle');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [twofa, setTwofa] = useState('');
  const [newChannel, setNewChannel] = useState('');
  const [channels, setChannels] = useState<TgMonitorChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    Promise.all([
      tgMonitorApi.status(),
      tgMonitorApi.listChannels(),
    ]).then(([s, chs]) => {
      if (s.status === 'active') {
        setStep('active');
        setPhone(s.phone ?? '');
      }
      setChannels(chs);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const go = async (fn: () => Promise<void>) => {
    setErr('');
    setLoading(true);
    try { await fn(); } catch (e: any) { setErr(e.message ?? 'Errore'); }
    setLoading(false);
  };

  const handleSendCode = () => go(async () => {
    await tgMonitorApi.sendCode(phone);
    setStep('code');
  });

  const handleSignIn = () => go(async () => {
    const res = await tgMonitorApi.signIn(code);
    if (res.need2FA) { setStep('twofa'); return; }
    setStep('active');
    setChannels(await tgMonitorApi.listChannels());
  });

  const handle2FA = () => go(async () => {
    await tgMonitorApi.confirm2FA(twofa);
    setStep('active');
    setChannels(await tgMonitorApi.listChannels());
  });

  const handleSignOut = () => go(async () => {
    await tgMonitorApi.signOut();
    setStep('idle');
    setChannels([]);
    setPhone('');
  });

  const handleAddChannel = () => go(async () => {
    if (!newChannel.trim()) return;
    await tgMonitorApi.addChannel(newChannel.trim());
    setNewChannel('');
    setChannels(await tgMonitorApi.listChannels());
  });

  const handleRemove = (id: string) => go(async () => {
    await tgMonitorApi.removeChannel(id);
    setChannels(prev => prev.filter(c => c.id !== id));
  });

  // mode: 'queue' = metti in coda, 'publish' = pubblica subito, 'pause' = ferma controllo
  const handleSetMode = async (id: string, mode: 'queue' | 'publish' | 'pause') => {
    const updates = mode === 'pause'
      ? { active: false, auto_publish: false }
      : mode === 'publish'
      ? { active: true, auto_publish: true }
      : { active: true, auto_publish: false };
    const prev = channels.find(c => c.id === id);
    setChannels(ch => ch.map(c => c.id === id ? { ...c, ...updates } : c));
    try { await tgMonitorApi.updateChannel(id, updates); }
    catch (e: any) {
      if (prev) setChannels(ch => ch.map(c => c.id === id ? prev : c));
      setErr(e.message ?? 'Errore aggiornamento canale');
    }
  };

  const activeChannel = activeProfileId.includes(':') ? activeProfileId.split(':').slice(1).join(':') : null;

  return (
    <div className="pg">
      <PageHeader title="Monitor canali" onBack={() => nav('dash')} />

      {activeChannel && (
        <div style={{ margin: '0 16px 10px', background: 'var(--card)', border: '1px solid var(--bdr)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--t2)' }}>
          Canale attivo: <b style={{ color: 'var(--t1)' }}>{activeChannel}</b> — i canali aggiunti qui copiano su questo profilo
        </div>
      )}

      {err && (
        <div style={{ margin: '0 16px 12px', background: '#2a0a0a', border: '1px solid #5c1a1a', borderRadius: 8, padding: '10px 12px', color: '#f87171', fontSize: 13 }}>
          {err}
        </div>
      )}

      <div style={{ margin: '0 16px' }}>
        {/* ── Descrizione ── */}
        {step === 'idle' && !loading && (
          <div style={{ padding: '12px 14px', background: 'var(--card)', border: '1px solid var(--bdr)', borderRadius: 10, marginBottom: 16, fontSize: 13, color: 'var(--t2)', lineHeight: 1.6 }}>
            Connetti il tuo account Telegram per monitorare canali che non gestisci. Per ogni canale puoi scegliere se mettere i link trovati in coda autopost oppure pubblicarli subito.
          </div>
        )}

        {/* ── Inserimento numero ── */}
        {step === 'idle' && (
          <div>
            <div className="fld">
              <label className="lbl">Numero di telefono (con prefisso)</label>
              <input className="inp" value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="+393331234567" type="tel" autoFocus />
            </div>
            <button className="btn bp bfull" onClick={handleSendCode} disabled={loading || !phone.trim()}>
              {loading ? '⏳ Invio in corso...' : '📲 Invia codice di verifica'}
            </button>
          </div>
        )}

        {/* ── Inserimento codice OTP ── */}
        {step === 'code' && (
          <div>
            <div style={{ padding: '10px 14px', background: 'var(--card)', border: '1px solid var(--bdr)', borderRadius: 10, marginBottom: 14, fontSize: 13, color: 'var(--t2)' }}>
              Codice inviato su Telegram a <b style={{ color: 'var(--t1)' }}>{phone}</b>
            </div>
            <div className="fld">
              <label className="lbl">Codice di verifica</label>
              <input className="inp" value={code} onChange={e => setCode(e.target.value)}
                placeholder="12345" inputMode="numeric" maxLength={6} autoFocus />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => { setStep('idle'); setCode(''); }} style={{ flex: 1 }}>← Cambia</button>
              <button className="btn bp" onClick={handleSignIn} disabled={loading || !code.trim()} style={{ flex: 2 }}>
                {loading ? '⏳...' : '✅ Verifica'}
              </button>
            </div>
          </div>
        )}

        {/* ── Password 2FA ── */}
        {step === 'twofa' && (
          <div>
            <div style={{ padding: '10px 14px', background: 'var(--card)', border: '1px solid var(--bdr)', borderRadius: 10, marginBottom: 14, fontSize: 13, color: 'var(--t2)' }}>
              Account protetto da verifica in due passaggi
            </div>
            <div className="fld">
              <label className="lbl">Password cloud Telegram</label>
              <input className="inp" value={twofa} onChange={e => setTwofa(e.target.value)}
                placeholder="La tua password 2FA" type="password" autoFocus />
            </div>
            <button className="btn bp bfull" onClick={handle2FA} disabled={loading || !twofa.trim()}>
              {loading ? '⏳...' : '🔐 Conferma'}
            </button>
          </div>
        )}

        {/* ── Account connesso ── */}
        {step === 'active' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--card)', border: '1px solid var(--bdr)', borderRadius: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 20 }}>📡</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#4ade80' }}>Monitoraggio attivo</div>
                <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>{phone}</div>
              </div>
              <button className="btn" onClick={handleSignOut} disabled={loading}
                style={{ fontSize: 12, padding: '5px 12px', background: '#2a0a0a', color: '#f87171', border: '1px solid #5c1a1a', borderRadius: 7 }}>
                Disconnetti
              </button>
            </div>

            {/* Lista canali monitorati */}
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', letterSpacing: 1, marginBottom: 8 }}>
              CANALI MONITORATI {channels.length > 0 && `(${channels.length})`}
            </div>

            {channels.length === 0 && (
              <div style={{ padding: '12px 14px', background: 'var(--card)', border: '1px solid var(--bdr)', borderRadius: 10, marginBottom: 14, fontSize: 13, color: 'var(--t3)', textAlign: 'center' }}>
                Nessun canale aggiunto
              </div>
            )}

            {channels.map(ch => (
              <div key={ch.id} style={{ background: 'var(--card)', border: '1px solid var(--bdr)', borderRadius: 10, marginBottom: 8, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
                  <span style={{ fontSize: 16 }}>📢</span>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--t1)', wordBreak: 'break-all' }}>{ch.channel}</span>
                  <button className="btn" onClick={() => handleRemove(ch.id)} disabled={loading}
                    style={{ fontSize: 12, padding: '4px 10px', background: '#2a0a0a', color: '#f87171', border: '1px solid #5c1a1a', borderRadius: 6, flexShrink: 0 }}>
                    Rimuovi
                  </button>
                </div>
                {(() => {
                  const mode = !ch.active ? 'pause' : ch.auto_publish ? 'publish' : 'queue';
                  const btn = (m: 'queue' | 'publish' | 'pause', label: string, activeColor: string) => {
                    const isActive = mode === m;
                    return (
                      <button
                        key={m}
                        onClick={() => !isActive && handleSetMode(ch.id, m)}
                        style={{
                          flex: 1, padding: '5px 8px', borderRadius: 6, border: 'none',
                          cursor: isActive ? 'default' : 'pointer', fontSize: 12,
                          fontWeight: isActive ? 700 : 400,
                          background: isActive ? activeColor : 'var(--bg3)',
                          color: isActive ? '#fff' : 'var(--t3)',
                        }}>
                        {label}
                      </button>
                    );
                  };
                  return (
                    <>
                      <div style={{ borderTop: '1px solid var(--bdr)', padding: '8px 14px', display: 'flex', gap: 6 }}>
                        {btn('queue',   '📋 In coda',   'var(--a1)')}
                        {btn('publish', '⚡ Subito',    '#16a34a')}
                        {btn('pause',   '⏸ Pausa',     '#6b3d1e')}
                      </div>
                    </>
                  );
                })()}
              </div>
            ))}

            {/* Aggiungi canale */}
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', letterSpacing: 1, margin: '16px 0 8px' }}>
              AGGIUNGI CANALE
            </div>
            <div className="fld" style={{ margin: 0 }}>
              <input className="inp" value={newChannel} onChange={e => setNewChannel(e.target.value)}
                placeholder="@username o https://t.me/username"
                onKeyDown={e => e.key === 'Enter' && handleAddChannel()} />
            </div>
            <div style={{ height: 8 }} />
            <button className="btn bp bfull" onClick={handleAddChannel} disabled={loading || !newChannel.trim()}>
              {loading ? '⏳...' : '➕ Aggiungi canale'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsMenuItem({ icon, label, sub, onClick }: { icon: string; label: string; sub?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 12,
      background: 'var(--card)', border: '1px solid var(--bdr)', borderRadius: 10,
      padding: '14px 14px', cursor: 'pointer', color: 'var(--t1)', textAlign: 'left',
      marginBottom: 10,
    }}>
      <span style={{ fontSize: 22, lineHeight: 1 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>{sub}</div>}
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width={16} height={16} style={{ color: 'var(--t3)', flexShrink: 0 }}>
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  );
}

export function SettingsPage({ nav }: { nav: (p: NavPage) => void }) {
  const { settings, setSettings, reloadSettings, templates, activeProfileId } = useApp();
  const isSecondaryProfile = activeProfileId.includes(':');
  const [s, setS] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [openAmz, setOpenAmz] = useState(false);
  const [openAli, setOpenAli] = useState(false);
  const [subPage, setSubPage] = useState<null | 'general' | 'admin'>(null);

  React.useEffect(() => { setS(settings); }, [settings]);

  const save = async () => {
    setSaveErr('');
    try {
      await settingsApi.save(s);
      // Ricarica dal backend per evitare che i dati salvati di un profilo
      // contaminino la vista di un altro profilo tramite il context globale
      await reloadSettings();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Errore durante il salvataggio');
    }
  };

  const setAmazon = (field: keyof typeof s.amazon, value: string | boolean) =>
    setS(prev => ({ ...prev, amazon: { ...prev.amazon, [field]: value } }));

  const setAli = (field: keyof typeof s.aliexpress, value: string | boolean) =>
    setS(prev => ({ ...prev, aliexpress: { ...prev.aliexpress, [field]: value } }));

  // ── Menu principale ──────────────────────────────────────────
  if (!subPage) return (
    <div className="pg">
      <PageHeader title="Impostazioni" onBack={() => nav('dash')} />
      <div style={{ padding: '16px 16px 0' }}>
        <SettingsMenuItem
          icon="⚙️" label="Generali"
          sub="Autopost, orari, intervallo, notifiche"
          onClick={() => setSubPage('general')}
        />
        <SettingsMenuItem
          icon="🔐" label="Admin"
          sub="Credenziali Amazon, AliExpress, canali Telegram"
          onClick={() => setSubPage('admin')}
        />
      </div>
    </div>
  );

  {/* ── SOTTO-PAGINA ADMIN: credenziali e canali ── */}
  if (subPage === 'admin') return (
    <div className="pg">
      <PageHeader title="Admin" onBack={() => setSubPage(null)} />

      {/* ── AMAZON ── */}
      <div style={{ margin: '8px 16px 0' }}>
        <button
          onClick={() => setOpenAmz(o => !o)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--card)', border: '1px solid var(--bdr)',
            borderRadius: openAmz ? '10px 10px 0 0' : 10, padding: '12px 14px',
            cursor: 'pointer', color: 'var(--t1)',
          }}>
          <span style={{ fontSize: 18 }}>🟡</span>
          <span style={{ fontWeight: 700, fontSize: 14, flex: 1, textAlign: 'left' }}>Amazon Associates</span>
          <span className={`api-st ${s.amazon.enabled ? 'api-ok' : 'api-no'}`} style={{ marginRight: 6 }}>
            {s.amazon.enabled ? '✓ Attivo' : 'Off'}
          </span>
          <Chevron open={openAmz} />
        </button>

        {openAmz && (
          <div style={{ background: 'var(--card)', border: '1px solid var(--bdr)', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '14px 14px 8px' }}>
            <ToggleRow label="Attiva Amazon" value={s.amazon.enabled} onChange={v => setAmazon('enabled', v)} />

            <div className="fld">
              <label className="lbl">Partner Tag (affiliate)</label>
              <input className="inp" value={s.amazon.affiliateTag}
                onChange={e => setAmazon('affiliateTag', e.target.value)}
                placeholder="tuotag-21" />
              {s.amazon.affiliateTag && <div style={{ fontSize: 11, color: '#4ade80', marginTop: 3 }}>✓ {s.amazon.affiliateTag}</div>}
            </div>

            {isSecondaryProfile && (
              <div style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#a5b4fc' }}>
                🔗 Marketplace, versione API e credenziali ereditate dal profilo principale
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="fld" style={{ margin: 0 }}>
                <label className="lbl">Marketplace</label>
                {isSecondaryProfile
                  ? <div className="inp" style={{ opacity: 0.5, cursor: 'not-allowed', userSelect: 'none' }}>{s.amazon.marketplace || '—'}</div>
                  : <select className="sel" value={s.amazon.marketplace} onChange={e => setAmazon('marketplace', e.target.value)}>
                      {MARKETPLACES.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                }
              </div>
              <div className="fld" style={{ margin: 0 }}>
                <label className="lbl">Versione API</label>
                {isSecondaryProfile
                  ? <div className="inp" style={{ opacity: 0.5, cursor: 'not-allowed', userSelect: 'none' }}>{s.amazon.version || '—'}</div>
                  : <select className="sel" value={s.amazon.version} onChange={e => setAmazon('version', e.target.value)}>
                      <option value="2.1">2.1 – Nord Am.</option>
                      <option value="2.2">2.2 – Europa</option>
                      <option value="2.3">2.3 – Far East</option>
                      <option value="3.1">3.1 – LWA Nord Am.</option>
                      <option value="3.2">3.2 – LWA Europa</option>
                      <option value="3.3">3.3 – LWA Far East</option>
                    </select>
                }
              </div>
            </div>

            <div style={{ height: 12 }} />
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', letterSpacing: 1, marginBottom: 8 }}>CREDENZIALI API</div>
            <div className="fld">
              <label className="lbl">Credential ID</label>
              {isSecondaryProfile
                ? <>
                    <input className="inp" type="password" value={s.amazon.credentialId} readOnly
                      style={{ opacity: 0.5, cursor: 'not-allowed' }} placeholder="—" />
                    {s.amazon.credentialId && <div style={{ fontSize: 11, color: '#4ade80', marginTop: 3 }}>✓ Dal profilo principale ({s.amazon.credentialId.length} car.)</div>}
                  </>
                : <>
                    <input className="inp" type="password" value={s.amazon.credentialId}
                      onChange={e => setAmazon('credentialId', e.target.value)}
                      placeholder="amzn1.application-oa2-client...." />
                    {s.amazon.credentialId
                      ? <div style={{ fontSize: 11, color: '#4ade80', marginTop: 3 }}>✓ Personale ({s.amazon.credentialId.length} car.)</div>
                      : <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 3 }}>Vuoto → usa credenziali di sistema</div>}
                  </>
              }
            </div>
            <div className="fld">
              <label className="lbl">Credential Secret</label>
              {isSecondaryProfile
                ? <>
                    <input className="inp" type="password" value={s.amazon.credentialSecret} readOnly
                      style={{ opacity: 0.5, cursor: 'not-allowed' }} placeholder="—" />
                    {s.amazon.credentialSecret && <div style={{ fontSize: 11, color: '#4ade80', marginTop: 3 }}>✓ Dal profilo principale ({s.amazon.credentialSecret.length} car.)</div>}
                  </>
                : <>
                    <input className="inp" type="password" value={s.amazon.credentialSecret}
                      onChange={e => setAmazon('credentialSecret', e.target.value)}
                      placeholder="amzn1.oa2-cs.v1...." />
                    {s.amazon.credentialSecret
                      ? <div style={{ fontSize: 11, color: '#4ade80', marginTop: 3 }}>✓ Personale ({s.amazon.credentialSecret.length} car.)</div>
                      : <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 3 }}>Vuoto → usa credenziali di sistema</div>}
                  </>
              }
            </div>
          </div>
        )}
      </div>

      {/* ── ALIEXPRESS ── */}
      <div style={{ margin: '10px 16px 0' }}>
        <button
          onClick={() => setOpenAli(o => !o)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--card)', border: '1px solid var(--bdr)',
            borderRadius: openAli ? '10px 10px 0 0' : 10, padding: '12px 14px',
            cursor: 'pointer', color: 'var(--t1)',
          }}>
          <span style={{ fontSize: 18 }}>🔴</span>
          <span style={{ fontWeight: 700, fontSize: 14, flex: 1, textAlign: 'left' }}>AliExpress Affiliate</span>
          <span className={`api-st ${s.aliexpress.enabled ? 'api-ok' : 'api-no'}`} style={{ marginRight: 6 }}>
            {s.aliexpress.enabled ? '✓ Attivo' : 'Off'}
          </span>
          <Chevron open={openAli} />
        </button>

        {openAli && (
          <div style={{ background: 'var(--card)', border: '1px solid var(--bdr)', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '14px 14px 8px' }}>
            <ToggleRow label="Attiva AliExpress" value={s.aliexpress.enabled} onChange={v => setAli('enabled', v)} />

            {isSecondaryProfile && (
              <div style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#a5b4fc' }}>
                🔗 App Key e Secret ereditate dal profilo principale
              </div>
            )}

            <div className="fld">
              <label className="lbl">App Key</label>
              {isSecondaryProfile
                ? <>
                    <input className="inp" value={s.aliexpress.appKey} readOnly
                      style={{ opacity: 0.5, cursor: 'not-allowed' }} placeholder="—" />
                    {s.aliexpress.appKey && <div style={{ fontSize: 11, color: '#4ade80', marginTop: 3 }}>✓ Dal profilo principale</div>}
                  </>
                : <>
                    <input className="inp" value={s.aliexpress.appKey}
                      onChange={e => setAli('appKey', e.target.value)} placeholder="123456789" />
                    {s.aliexpress.appKey && <div style={{ fontSize: 11, color: '#4ade80', marginTop: 3 }}>✓ {s.aliexpress.appKey}</div>}
                  </>
              }
            </div>
            <div className="fld">
              <label className="lbl">App Secret</label>
              {isSecondaryProfile
                ? <>
                    <input className="inp" type="password" value={s.aliexpress.appSecret} readOnly
                      style={{ opacity: 0.5, cursor: 'not-allowed' }} placeholder="—" />
                    {s.aliexpress.appSecret && <div style={{ fontSize: 11, color: '#4ade80', marginTop: 3 }}>✓ Dal profilo principale ({s.aliexpress.appSecret.length} car.)</div>}
                  </>
                : <>
                    <input className="inp" type="password" value={s.aliexpress.appSecret}
                      onChange={e => setAli('appSecret', e.target.value)} placeholder="••••••••••••••••" />
                    {s.aliexpress.appSecret && <div style={{ fontSize: 11, color: '#4ade80', marginTop: 3 }}>✓ Inserito ({s.aliexpress.appSecret.length} car.)</div>}
                  </>
              }
            </div>
            <div className="fld">
              <label className="lbl">Tracking ID</label>
              <input className="inp" value={s.aliexpress.trackingId}
                onChange={e => setAli('trackingId', e.target.value)} placeholder="es: mio_sito" />
              {s.aliexpress.trackingId && <div style={{ fontSize: 11, color: '#4ade80', marginTop: 3 }}>✓ {s.aliexpress.trackingId}</div>}
            </div>
            <div className="fld">
              <label className="lbl">Paese target</label>
              <select className="sel" value={s.aliexpress.targetCountry} onChange={e => setAli('targetCountry', e.target.value)}>
                <option value="IT">🇮🇹 Italia (EUR)</option>
                <option value="US">🇺🇸 USA (USD)</option>
                <option value="DE">🇩🇪 Germania (EUR)</option>
                <option value="FR">🇫🇷 Francia (EUR)</option>
                <option value="ES">🇪🇸 Spagna (EUR)</option>
                <option value="UK">🇬🇧 UK (GBP)</option>
                <option value="PL">🇵🇱 Polonia (PLN)</option>
                <option value="NL">🇳🇱 Olanda (EUR)</option>
                <option value="RU">🇷🇺 Russia (RUB)</option>
                <option value="BR">🇧🇷 Brasile (BRL)</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* ── CANALI TELEGRAM ── */}
      <div className="stit" style={{ marginTop: 16 }}>CANALI TELEGRAM</div>
      <div className="api-card">
        <div className="api-top">
          <div className="api-ico" style={{ background: '#0a1a2a' }}>✈️</div>
          <div className="api-name">Canali di pubblicazione</div>
          <div className={`api-st ${s.channels.filter(Boolean).length > 0 ? 'api-ok' : 'api-no'}`}>
            {s.channels.filter(Boolean).length > 0 ? `${s.channels.filter(Boolean).length} canale` : 'Nessuno'}
          </div>
        </div>

        {isSecondaryProfile ? (
          <div style={{ padding: '8px 0' }}>
            <div style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#a5b4fc' }}>
              🔗 Questo profilo pubblica sul canale del profilo secondario. Per aggiungere o rimuovere canali vai al profilo principale.
            </div>
            {s.channels.filter(Boolean).map((ch, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--t3)', minWidth: 20 }}>{i + 1}.</div>
                <input className="inp" value={ch} readOnly style={{ opacity: 0.6, cursor: 'not-allowed' }} />
              </div>
            ))}
          </div>
        ) : (
          <>
            <InfoBanner>
              1. Aggiungi il bot come <b>amministratore</b> del canale.<br />
              2. Inserisci <b>@username</b> o <b>ID numerico</b> (es. -1001234567890).<br />
              3. Il primo canale è quello usato per la pubblicazione.
            </InfoBanner>
            {settings.channels.filter(Boolean).length > 0 && (
              <div style={{ fontSize: 11, color: '#4ade80', marginBottom: 8, padding: '6px 10px', background: '#0a2a0a', borderRadius: 6 }}>
                ✓ Salvato: {settings.channels.filter(Boolean).join(', ')}
              </div>
            )}
            {s.channels.map((ch, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--t3)', minWidth: 20 }}>{i + 1}.</div>
                <input className="inp" value={ch} placeholder="@username oppure -1001234567890"
                  onChange={e => {
                    const v = e.target.value;
                    setS(prev => ({ ...prev, channels: prev.channels.map((c, j) => j === i ? v : c) }));
                  }} />
                <button className="btn bre bic"
                  disabled={s.channels.filter(Boolean).length <= 1}
                  title={s.channels.filter(Boolean).length <= 1 ? 'Deve esserci almeno un canale' : ''}
                  onClick={() =>
                    setS(prev => ({ ...prev, channels: prev.channels.filter((_, j) => j !== i) }))
                  }>×</button>
              </div>
            ))}
            <button className="btn bp bsm" style={{ marginTop: 4, width: '100%' }}
              onClick={() => setS(prev => ({ ...prev, channels: [...prev.channels, ''] }))}>+ Aggiungi canale</button>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 8, lineHeight: 1.5 }}>
              Ogni canale ha impostazioni, template e layout separati.<br />
              Usa il switcher canale nella schermata principale per passare da un canale all'altro.
            </div>
          </>
        )}
      </div>

      {/* Salva (Admin) */}
      <div className="fld">
        <button className="btn bp bfull" onClick={save}>✅ Salva impostazioni</button>
        {saved && <div style={{ marginTop: 10, padding: '10px 14px', background: '#0a2a0a', border: '1px solid #1a5c1a', borderRadius: 8, color: '#4ade80', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>✓ Impostazioni salvate con successo</div>}
        {saveErr && <ErrorBanner>{saveErr}</ErrorBanner>}
      </div>
    </div>
  );

  {/* ── SOTTO-PAGINA GENERALI: autopost, timing, deal search ── */}
  return (
    <div className="pg">
      <PageHeader title="Generali" onBack={() => setSubPage(null)} />

      {/* ── AUTOPOST ── */}
      <div className="stit">AUTOPOST</div>
      <ToggleRow label="AutoPost attivo" sub="Pubblicazione automatica programmata" value={s.attivo} onChange={v => setS({ ...s, attivo: v })} />

      {/* Pubblicazione automatica per piattaforma */}
      <div style={{ margin: '8px 16px 0', background: 'var(--card)', border: '1px solid var(--bdr)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px 6px', fontSize: 11, fontWeight: 700, color: 'var(--t3)', letterSpacing: 1 }}>RICERCA OFFERTE AUTOMATICA</div>
        <ToggleRow
          label="🟡 Pubblica Amazon auto"
          sub="Aggiunge offerte Amazon alla coda automaticamente"
          value={s.dealSearch?.autoPublishAmazon ?? false}
          onChange={v => setS(prev => ({ ...prev, dealSearch: { ...(prev.dealSearch ?? { autoPublishAliexpress: false, autoPublishAmazon: false, publishPattern: '1:1', ali: { keywords: '', minDiscount: 0, minPrice: 0, maxPrice: 0, sort: 'DEFAULT_SORT' } }), autoPublishAmazon: v } }))}
        />
        <ToggleRow
          label="🔴 Pubblica AliExpress auto"
          sub="Aggiunge offerte AliExpress alla coda automaticamente"
          value={s.dealSearch?.autoPublishAliexpress ?? false}
          onChange={v => setS(prev => ({ ...prev, dealSearch: { ...(prev.dealSearch ?? { autoPublishAliexpress: false, autoPublishAmazon: false, publishPattern: '1:1', ali: { keywords: '', minDiscount: 0, minPrice: 0, maxPrice: 0, sort: 'DEFAULT_SORT' } }), autoPublishAliexpress: v } }))}
        />
        {(s.dealSearch?.autoPublishAmazon || s.dealSearch?.autoPublishAliexpress) && (
          <div style={{ padding: '0 14px 12px' }}>
            <label className="lbl">Schema alternanza pubblicazioni</label>
            <select className="sel" value={s.dealSearch?.publishPattern ?? '1:1'}
              onChange={e => setS(prev => ({ ...prev, dealSearch: { ...(prev.dealSearch ?? { autoPublishAliexpress: false, autoPublishAmazon: false, publishPattern: '1:1', ali: { keywords: '', minDiscount: 0, minPrice: 0, maxPrice: 0, sort: 'DEFAULT_SORT' } }), publishPattern: e.target.value } }))}>
              <option value="1:1">1:1 — Alterni (Amazon, Ali, Amazon, Ali...)</option>
              <option value="2:1">2:1 — 2 Amazon, 1 AliExpress</option>
              <option value="3:1">3:1 — 3 Amazon, 1 AliExpress</option>
              <option value="1:2">1:2 — 1 Amazon, 2 AliExpress</option>
              <option value="1:3">1:3 — 1 Amazon, 3 AliExpress</option>
              <option value="amazon-only">Solo Amazon</option>
              <option value="ali-only">Solo AliExpress</option>
            </select>
          </div>
        )}
        {s.dealSearch?.autoPublishAmazon && (
          <div style={{ padding: '8px 14px 12px', borderTop: '1px solid var(--bdr)' }}>
            <label className="lbl">Criterio di selezione post Amazon</label>
            <select className="sel"
              value={s.dealSearch?.autoPublishSort ?? 'discount'}
              onChange={e => setS(prev => ({ ...prev, dealSearch: { ...prev.dealSearch!, autoPublishSort: e.target.value as 'discount' | 'score' } }))}>
              <option value="discount">% sconto più alto</option>
              <option value="score">Score pesato (sconto + stelle + recensioni)</option>
            </select>
            {(s.dealSearch?.autoPublishSort ?? 'discount') === 'score' && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8 }}>
                  Somma dei pesi: {(s.dealSearch?.scoreWeightDiscount ?? 50) + (s.dealSearch?.scoreWeightRating ?? 30) + (s.dealSearch?.scoreWeightReviews ?? 20)}% (ideale 100%)
                </div>
                <label className="lbl">Peso % sconto — {s.dealSearch?.scoreWeightDiscount ?? 50}%</label>
                <input type="range" min={0} max={100} step={5}
                  value={s.dealSearch?.scoreWeightDiscount ?? 50}
                  onChange={e => setS(prev => ({ ...prev, dealSearch: { ...prev.dealSearch!, scoreWeightDiscount: parseInt(e.target.value) } }))}
                  style={{ width: '100%', accentColor: 'var(--a1)' }} />
                <label className="lbl" style={{ marginTop: 8 }}>Peso stelle — {s.dealSearch?.scoreWeightRating ?? 30}%</label>
                <input type="range" min={0} max={100} step={5}
                  value={s.dealSearch?.scoreWeightRating ?? 30}
                  onChange={e => setS(prev => ({ ...prev, dealSearch: { ...prev.dealSearch!, scoreWeightRating: parseInt(e.target.value) } }))}
                  style={{ width: '100%', accentColor: 'var(--a1)' }} />
                <label className="lbl" style={{ marginTop: 8 }}>Peso numero recensioni — {s.dealSearch?.scoreWeightReviews ?? 20}%</label>
                <input type="range" min={0} max={100} step={5}
                  value={s.dealSearch?.scoreWeightReviews ?? 20}
                  onChange={e => setS(prev => ({ ...prev, dealSearch: { ...prev.dealSearch!, scoreWeightReviews: parseInt(e.target.value) } }))}
                  style={{ width: '100%', accentColor: 'var(--a1)' }} />
              </div>
            )}
          </div>
        )}
        {s.dealSearch?.autoPublishAmazon && (
          <div style={{ borderTop: '1px solid var(--bdr)' }}>
            <ToggleRow
              label="Evita categoria ripetuta"
              sub="Non pubblicare due post consecutivi della stessa categoria Amazon"
              value={s.dealSearch?.noDupeCategory ?? false}
              onChange={v => setS(prev => ({ ...prev, dealSearch: { ...prev.dealSearch!, noDupeCategory: v } }))}
            />
            <div style={{ padding: '8px 14px 12px' }}>
              <label className="lbl">Post multiplo automatico ogni N singoli</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  className="inp"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={20}
                  style={{ width: 80 }}
                  value={s.dealSearch?.autoMultiEvery ?? ''}
                  placeholder="0 = off"
                  onChange={e => {
                    const v = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value) || 0);
                    setS(prev => ({ ...prev, dealSearch: { ...prev.dealSearch!, autoMultiEvery: v } }));
                  }}
                />
                <span style={{ fontSize: 13, color: 'var(--t2)' }}>singoli</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>
                {(s.dealSearch?.autoMultiEvery ?? 0) > 0
                  ? `Ogni ${s.dealSearch!.autoMultiEvery} post singoli pubblica automaticamente un post multiplo raggruppando prodotti con keyword simili`
                  : '0 = disabilitato'}
              </div>
            </div>
          </div>
        )}
      </div>
      <div style={{ height: 8 }} />
      <div style={{ height: 12 }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '0 16px' }}>
        <div className="fld" style={{ margin: 0 }}><label className="lbl">Ora inizio</label><input type="time" className="inp" value={s.oraI} onChange={e => setS({ ...s, oraI: e.target.value })} /></div>
        <div className="fld" style={{ margin: 0 }}><label className="lbl">Ora fine</label><input type="time" className="inp" value={s.oraF} onChange={e => setS({ ...s, oraF: e.target.value })} /></div>
      </div>
      <div className="fld">
        <label className="lbl">Intervallo tra i post</label>
        <select className="sel" value={(() => {
          const opts = [5,10,15,20,25,30,40,45,60,75,90,120,150,180,240,300,360,480,720,1440];
          return opts.includes(s.interv) ? s.interv : s.interv;
        })()} onChange={e => setS({ ...s, interv: parseInt(e.target.value) })}>
          {[5,10,15,20,25,30,40,45,60,75,90,120,150,180,240,300,360,480,720,1440]
            .concat(![5,10,15,20,25,30,40,45,60,75,90,120,150,180,240,300,360,480,720,1440].includes(s.interv) ? [s.interv] : [])
            .sort((a,b) => a - b)
            .map(m => {
              const label = m < 60 ? `${m} minuti` : m % 60 === 0 ? `${m/60} ${m/60===1?'ora':'ore'}` : `${Math.floor(m/60)}h ${m%60}min`;
              return <option key={m} value={m}>{label}</option>;
            })}
        </select>
      </div>
      <div className="fld">
        <label className="lbl">Pubblica con notifica se sconto ≥</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="inp"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            style={{ width: 80 }}
            value={s.notifThreshold ?? ''}
            placeholder="es. 80"
            onChange={e => {
              const v = e.target.value === '' ? undefined : Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
              setS(prev => ({ ...prev, notifThreshold: v }));
            }}
          />
          <span style={{ fontSize: 13, color: 'var(--t2)' }}>%</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>
          {s.notifThreshold !== undefined && s.notifThreshold > 0
            ? `Sconto ≥ ${s.notifThreshold}% → 🔔 notifica · sotto soglia → 🔕 silenzioso`
            : 'Vuoto = tutti i post silenziosissimi (usa il toggle per-post per forzare notifica)'}
        </div>
      </div>
      {/* ── RIEPILOGO GIORNALIERO ── */}
      <div className="stit">RIEPILOGO GIORNALIERO</div>
      <div style={{ margin: '0 16px 8px', background: 'var(--card)', border: '1px solid var(--bdr)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px 6px', fontSize: 11, color: 'var(--t3)' }}>
          Pubblica automaticamente un post multiplo con i 6 prodotti con lo sconto maggiore della giornata, uno per ogni canale configurato.
        </div>
        {(s.channels.length > 0 ? s.channels : ['default']).map((ch, idx) => {
          const key = ch === s.channels[0] && s.channels.length === 1 ? 'default' : ch;
          const cfg = (s.dailyRecap?.[key] ?? { enabled: false, time: '20:00', title: 'I MIGLIORI POST DELLA GIORNATA' });
          const setRecap = (patch: Partial<typeof cfg>) =>
            setS(prev => ({
              ...prev,
              dailyRecap: { ...(prev.dailyRecap ?? {}), [key]: { ...cfg, ...patch } },
            }));
          return (
            <div key={key} style={{ borderTop: idx > 0 ? '1px solid var(--bdr)' : undefined, padding: '10px 14px 12px' }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--t1)' }}>
                {ch === 'default' ? '📢 Canale principale' : ch}
              </div>
              <ToggleRow
                label="Attiva riepilogo"
                sub="Pubblica i top-6 post del giorno all'orario scelto"
                value={cfg.enabled}
                onChange={v => setRecap({ enabled: v })}
              />
              {cfg.enabled && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, marginTop: 8 }}>
                    <div className="fld" style={{ margin: 0 }}>
                      <label className="lbl">Orario</label>
                      <input type="time" className="inp" value={cfg.time} onChange={e => setRecap({ time: e.target.value })} />
                    </div>
                    <div className="fld" style={{ margin: 0 }}>
                      <label className="lbl">Titolo del post</label>
                      <input className="inp" value={cfg.title} placeholder="I MIGLIORI POST DELLA GIORNATA" onChange={e => setRecap({ title: e.target.value })} />
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="fld">
        <button className="btn bp bfull" onClick={save}>✅ Salva impostazioni</button>
        {saved && <div style={{ marginTop: 10, padding: '10px 14px', background: '#0a2a0a', border: '1px solid #1a5c1a', borderRadius: 8, color: '#4ade80', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>✓ Impostazioni salvate con successo</div>}
        {saveErr && <ErrorBanner>{saveErr}</ErrorBanner>}
      </div>
    </div>
  );
}
