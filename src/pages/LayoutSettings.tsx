import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { NavPage, TextLayout, KeyboardLayout, LayoutType, Tag, Template, TextEl, ImgEl, makeDefaultTemplate, TerminataConfig } from '../types';
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
  '{link_affiliato}', '{link}',
  '{coupon}', '{boxcoupon}', '{custom}',
  '{store}', '{storeup}',
  '{countryflag}', '{country}', '{countryup}',
  '{giorno}', '{ora}', '{data}',
  '{stelle}', '{recensioni}', '{cat}', '{author}',
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
  '{coupon}':          'Codice coupon se presente nel post',
  '{boxcoupon}':       'Mostra testo "Abilita il coupon prima di acquistare" per link con coupon da abilitare nella pagina Amazon',
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
          <div className="irow">
            <input className="inp" value={editValue} onChange={e => setEditValue(e.target.value)}
              placeholder="Valore / descrizione"
              onKeyDown={e => e.key === 'Enter' && saveEdit()} />
            <button className="btn bp bsm" onClick={saveEdit} style={{ flexShrink: 0 }}>✓</button>
            <button className="btn bs bsm" onClick={() => setEditId(null)} style={{ flexShrink: 0 }}>×</button>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="tag-pill" style={{ flexShrink: 0 }}>{t.name}</span>
          <span style={{ fontSize: 12, color: 'var(--t2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t.value || <span style={{ fontStyle: 'italic', color: 'var(--t3)' }}>vuoto</span>}
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
            <option value="historical_low">Minimo Storico</option>
            <option value="multi">Multiplo</option>
            <option value="aliexpress">AliExpress</option>
            <option value="aliexpress_historical_low">Min. Storico AliExpress</option>
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
  '{whatsapp}': 'Condivisione WhatsApp',
  '{poll}': 'Sondaggio 👍👎',
};

const COLOR_MAP: Record<string, string> = { g: '#22c55e', r: '#ef4444', b: '#3b82f6' };

function parseKbButton(raw: string): { text: string; color?: string; url: string } {
  let s = raw.trim();
  let color: string | undefined;
  const colorMatch = s.match(/^#([grb])\s+/);
  if (colorMatch) { color = COLOR_MAP[colorMatch[1]]; s = s.slice(colorMatch[0].length); }
  const lastDash = s.lastIndexOf(' - ');
  if (lastDash === -1) return { text: s, url: '' };
  return { text: s.slice(0, lastDash).trim(), color, url: s.slice(lastDash + 3).trim() };
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
            <b>Tag URL:</b> <code>{'{link}'}</code> link offerta · <code>{'{whatsapp}'}</code> condividi · <code>{'{poll}'}</code> sondaggio
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

export function TemplatePreviewer({ tpl, terminata, platform = 'amazon', onArrowMove }: {
  tpl: Template; terminata?: TerminataConfig; platform?: 'amazon' | 'aliexpress';
  onArrowMove?: (dx: number, dy: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(340);
  useEffect(() => {
    if (containerRef.current) setContainerW(containerRef.current.clientWidth);
  }, []);

  const pp = tpl.product;
  // fontScale esatto: canvas usa fontSize*2 su 1024px, quindi nella preview usiamo lo stesso rapporto
  const fontScale = (2 * containerW) / (tpl.canvasW ?? 1024);
  // fontSize per il testo terminata: uguale al canvas (overlayTextSize% di containerW)
  const terminataFontPx = terminata ? (terminata.overlayTextSize / 100) * containerW : 0;

  const innerContent = (
    <>
      {/* Product placeholder box */}
      <div style={{
        position: 'absolute', left: `${pp.x}%`, top: `${pp.y}%`,
        width: `${pp.size}%`, height: `${pp.size}%`,
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
        { el: tpl.prezzo as TextEl, text: '€24,99' },
        { el: tpl.prezzoPrecedente as TextEl, text: '€49,99' },
        { el: tpl.sconto as TextEl, text: '-50%' },
        { el: tpl.testoCustom as TextEl, text: tpl.testoCustom.text || 'Testo' },
      ]).map(({ el, text }, i) =>
        el.enabled ? (
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
          }}>{text}</div>
        ) : null
      )}

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
          fontWeight: 900, fontFamily: 'Impact, Arial Black',
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
      <InfoBanner>📦 Riquadro dove verrà inserita l'immagine Amazon/AliExpress. Usale frecce sull'anteprima per spostarlo e usa 🔍 per ridimensionarlo.</InfoBanner>
      <DragHint x={el.x} y={el.y} onCenter={() => onUpdate({ x: Math.round((100 - el.size) / 2), y: Math.round((100 - el.size) / 2) })} />
      <ZoomControls value={el.size} onChange={v => onUpdate({ size: v })} min={20} max={100} label="DIMENSIONE RIQUADRO" />
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
      <ZoomControls value={el.size} onChange={v => onUpdate({ size: v })} min={10} max={100} />
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
      <ZoomControls value={el.size} onChange={v => onUpdate({ size: v })} min={5} max={50} />
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
      <ZoomControls value={el.size} onChange={v => onUpdate(key, { size: v })} min={5} max={40} />
    </>
  );
}

const FONTS = [
  'Arial',
  'Bangers',
  'Comix Heavy',
  'Edwardian Script ITC',
  'Exo 2',
  'Gobold Italic',
  'Impact',
  'Gotham Rounded',
  'Lemon Milk Bold',
  'Lemon Milk Bold Italic',
  'Lemon Milk Light',
  'Lemon Milk Light Italic',
  'Lobster',
  'Milano',
  'Montserrat',
  'Montserrat Bold',
  'Montserrat Bold Italic',
  'Open Sans',
  'Open Sans Bold',
  'Open Sans Bold Italic',
  'Open Sans Italic',
  'The Blacklist',
];

function TextElPanel({ el, onUpdate, showTextInput = false }: {
  el: TextEl;
  onUpdate: (ch: Partial<TextEl>) => void;
  showTextInput?: boolean;
}) {
  return (
    <>
      {showTextInput && (
        <div style={{ marginBottom: 12 }}>
          <div className="lbl">TESTO</div>
          <input className="inp" value={el.text} onChange={e => onUpdate({ text: e.target.value })} placeholder="Testo personalizzato..." />
        </div>
      )}

      <DragHint x={el.x} y={el.y} onCenter={() => onUpdate({ x: 50, y: 50 })} />

      {/* Direzione crescita testo */}
      <div style={{ marginBottom: 12 }}>
        <div className="lbl">ANCORA TESTO</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={`btn bsm ${(el.textAnchor ?? 'left') === 'left' ? 'bp' : 'bgh'}`}
            style={{ flex: 1 }} onClick={() => onUpdate({ textAnchor: 'left' })}>◀ Sinistra</button>
          <button className={`btn bsm ${el.textAnchor === 'center' ? 'bp' : 'bgh'}`}
            style={{ flex: 1 }} onClick={() => onUpdate({ textAnchor: 'center' })}>▶◀ Centro</button>
          <button className={`btn bsm ${el.textAnchor === 'right' ? 'bp' : 'bgh'}`}
            style={{ flex: 1 }} onClick={() => onUpdate({ textAnchor: 'right' })}>Destra ▶</button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span className="lbl" style={{ marginBottom: 0, flex: 1 }}>DIMENSIONE FONT</span>
        <input type="range" min={10} max={80} value={el.fontSize}
          style={{ flex: 2, accentColor: 'var(--a1)' }}
          onChange={e => onUpdate({ fontSize: Number(e.target.value) })} />
        <span style={{ fontSize: 11, color: 'var(--t2)', width: 32, textAlign: 'right' }}>{el.fontSize}px</span>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div className="lbl">FONT</div>
        <select className="sel" value={el.fontFamily} onChange={e => onUpdate({ fontFamily: e.target.value })}>
          {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
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

// ── Template Section ──────────────────────────────────────────

type ComponentKey = 'product' | 'overlay' | 'badge' | 'prezzo' | 'prezzoPrecedente' | 'sconto' | 'testoCustom' | 'store' | 'terminata';

const COMP_INFO: Record<ComponentKey, string> = {
  product:          '📦 Riquadro dove apparirà la foto del prodotto. Spostalo con le frecce e ridimensionalo con lo slider.',
  overlay:          '🖼️ Immagine sovrapposta (cornice, sfondo decorativo). Carica un PNG con trasparenza. Spostalo e ridimensionalo.',
  badge:            '🏆 Icona visibile solo sui prodotti al minimo storico. Viene disegnata sopra tutti gli altri layer. Carica un PNG e posizionalo.',
  prezzo:           '💰 Prezzo scontato — inserito automaticamente dal post. Spostalo, scegli font e colore.',
  prezzoPrecedente: '📉 Prezzo precedente (barrato) — inserito automaticamente. Puoi cambiare il colore della barra barrata separatamente.',
  sconto:           '🏷️ Percentuale di sconto — calcolata automaticamente (es. -50%). Impostane font, colore e posizione.',
  testoCustom:      '📝 Testo libero personalizzabile. Corrisponde al campo "Testo custom" del post.',
  store:            '🏪 Logo negozio — seleziona Amazon o AliExpress e regola posizione/dimensione per ciascuno.',
  terminata:        '🚫 Configura come appare il post quando l\'offerta termina: immagine B&N, testo overlay, elementi visibili e layout Telegram.',
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
  { id: 'terminata',        icon: '🚫', label: 'Terminata' },
];

function getElEnabled(id: ComponentKey, tpl: Template): boolean {
  if (id === 'product' || id === 'terminata') return true;
  if (id === 'store') return tpl.storeAmazon?.enabled || tpl.storeAliexpress?.enabled || false;
  if (id === 'overlay' || id === 'badge') return (tpl[id] as ImgEl).enabled;
  return (tpl[id] as TextEl).enabled;
}

function TemplateSection() {
  const { templates, setTemplates, templateFromDB } = useApp();
  const [activePanel, setActivePanel] = useState<ComponentKey | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [previewPlatform, setPreviewPlatform] = useState<'amazon' | 'aliexpress'>('amazon');
  const [arrowStep, setArrowStep] = useState(1);

  const tpl = templates[0] ?? makeDefaultTemplate('tpl1');

  const saveTpl = (t: Template) => {
    if (!templateFromDB.current) return; // blocca salvataggio se template non confermato dal DB
    templatesApi.update(t.id, t).catch(e => {
      if (String(e?.message).includes('Not found')) templatesApi.create(t).catch(() => {});
    });
  };

  const updateTpl = (changes: Partial<Template>) => {
    setTemplates(ts => {
      const updated = { ...(ts[0] ?? makeDefaultTemplate('tpl1')), ...changes };
      saveTpl(updated);
      return [updated];
    });
  };

  const updateImg = (key: 'overlay' | 'badge' | 'storeAmazon' | 'storeAliexpress', changes: Partial<ImgEl>) => {  // eslint-disable-line
    setTemplates(ts => {
      const base = ts[0] ?? makeDefaultTemplate('tpl1');
      const updated = { ...base, [key]: { ...(base[key] as ImgEl), ...changes } };
      saveTpl(updated);
      return [updated];
    });
  };

  const updateText = (key: 'prezzo' | 'prezzoPrecedente' | 'sconto' | 'testoCustom', changes: Partial<TextEl>) => {
    setTemplates(ts => {
      const base = ts[0] ?? makeDefaultTemplate('tpl1');
      const updated = { ...base, [key]: { ...(base[key] as TextEl), ...changes } };
      saveTpl(updated);
      return [updated];
    });
  };

  const updateProduct = (changes: Partial<{ x: number; y: number; size: number }>) => {
    setTemplates(ts => {
      const base = ts[0] ?? makeDefaultTemplate('tpl1');
      const updated = { ...base, product: { ...base.product, ...changes } };
      saveTpl(updated);
      return [updated];
    });
  };

  const handleFile = async (key: 'overlay' | 'badge', file: File | null) => {
    if (!file) return;
    const b64 = await readAsBase64(file);
    if (key === 'overlay') {
      const img = new Image();
      img.onload = () => {
        const w = Math.min(1320, Math.max(600, img.naturalWidth));
        const h = Math.min(800, Math.max(600, img.naturalHeight));
        updateTpl({ canvasW: w, canvasH: h });
      };
      img.src = b64 as string;
    }
    updateImg(key, { src: b64 });
  };

  const isTextKey = (k: ComponentKey): k is 'prezzo' | 'prezzoPrecedente' | 'sconto' | 'testoCustom' =>
    ['prezzo', 'prezzoPrecedente', 'sconto', 'testoCustom'].includes(k);

  const handleArrowMove = (dx: number, dy: number) => {
    if (!activePanel) return;
    const step = arrowStep;
    const clampPos = (v: number) => Math.min(95, Math.max(0, parseFloat((v + dx * step).toFixed(1))));
    const clampPosY = (v: number) => Math.min(95, Math.max(0, parseFloat((v + dy * step).toFixed(1))));
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
    if (id === 'product' || id === 'terminata') return;
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
      <TemplatePreviewer
        tpl={tpl} platform={previewPlatform}
        onArrowMove={activePanel && activePanel !== 'terminata' ? handleArrowMove : undefined}
      />

      {/* Selettore step frecce */}
      {activePanel && activePanel !== 'terminata' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 16px 0' }}>
          <span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }}>Passo:</span>
          {[0.5, 1, 3, 5, 10].map(s => (
            <button key={s} className={`btn bsm ${arrowStep === s ? 'bp' : 'bgh'}`}
              style={{ fontSize: 10, padding: '2px 8px' }}
              onClick={() => setArrowStep(s)}>{s}%</button>
          ))}
        </div>
      )}

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
            />
          )}
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
  overlayTextSize: 7, overlayTextX: 50, overlayTextY: 50,
  showPrezzo: true, showPrezzoPrecedente: false, showSconto: false, layoutId: '',
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
      <div className="fld">
        <label className="lbl">Layout testo Telegram</label>
        <select className="sel" value={cfg.layoutId} onChange={e => update('layoutId', e.target.value)}>
          <option value="">— Solo prefisso ❌ TERMINATA —</option>
          {layouts.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
        </select>
      </div>

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

  return (
    <div className="pg">
      <PageHeader title="Monitor canali" onBack={() => nav('dash')} />

      {err && (
        <div style={{ margin: '0 16px 12px', background: '#2a0a0a', border: '1px solid #5c1a1a', borderRadius: 8, padding: '10px 12px', color: '#f87171', fontSize: 13 }}>
          {err}
        </div>
      )}

      <div style={{ margin: '0 16px' }}>
        {/* ── Descrizione ── */}
        {step === 'idle' && !loading && (
          <div style={{ padding: '12px 14px', background: 'var(--card)', border: '1px solid var(--bdr)', borderRadius: 10, marginBottom: 16, fontSize: 13, color: 'var(--t2)', lineHeight: 1.6 }}>
            Connetti il tuo account Telegram per monitorare canali che non gestisci. Ogni link Amazon o AliExpress trovato viene aggiunto automaticamente in coda.
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
              <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--card)', border: '1px solid var(--bdr)', borderRadius: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 16 }}>📢</span>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--t1)', wordBreak: 'break-all' }}>{ch.channel}</span>
                <button className="btn" onClick={() => handleRemove(ch.id)} disabled={loading}
                  style={{ fontSize: 12, padding: '4px 10px', background: '#2a0a0a', color: '#f87171', border: '1px solid #5c1a1a', borderRadius: 6, flexShrink: 0 }}>
                  Rimuovi
                </button>
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
  const { settings, setSettings } = useApp();
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
      setSettings(s);
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="fld" style={{ margin: 0 }}>
                <label className="lbl">Marketplace</label>
                <select className="sel" value={s.amazon.marketplace} onChange={e => setAmazon('marketplace', e.target.value)}>
                  {MARKETPLACES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="fld" style={{ margin: 0 }}>
                <label className="lbl">Versione API</label>
                <select className="sel" value={s.amazon.version} onChange={e => setAmazon('version', e.target.value)}>
                  <option value="2.1">2.1 – Nord Am.</option>
                  <option value="2.2">2.2 – Europa</option>
                  <option value="2.3">2.3 – Far East</option>
                  <option value="3.1">3.1 – LWA Nord Am.</option>
                  <option value="3.2">3.2 – LWA Europa</option>
                  <option value="3.3">3.3 – LWA Far East</option>
                </select>
              </div>
            </div>

            <div style={{ height: 12 }} />
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', letterSpacing: 1, marginBottom: 8 }}>CREDENZIALI API</div>
            <div className="fld">
              <label className="lbl">Credential ID</label>
              <input className="inp" type="password" value={s.amazon.credentialId}
                onChange={e => setAmazon('credentialId', e.target.value)}
                placeholder="amzn1.application-oa2-client...." />
              {s.amazon.credentialId
                ? <div style={{ fontSize: 11, color: '#4ade80', marginTop: 3 }}>✓ Personale ({s.amazon.credentialId.length} car.)</div>
                : <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 3 }}>Vuoto → usa credenziali di sistema</div>}
            </div>
            <div className="fld">
              <label className="lbl">Credential Secret</label>
              <input className="inp" type="password" value={s.amazon.credentialSecret}
                onChange={e => setAmazon('credentialSecret', e.target.value)}
                placeholder="amzn1.oa2-cs.v1...." />
              {s.amazon.credentialSecret
                ? <div style={{ fontSize: 11, color: '#4ade80', marginTop: 3 }}>✓ Personale ({s.amazon.credentialSecret.length} car.)</div>
                : <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 3 }}>Vuoto → usa credenziali di sistema</div>}
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
            <div className="fld">
              <label className="lbl">App Key</label>
              <input className="inp" value={s.aliexpress.appKey}
                onChange={e => setAli('appKey', e.target.value)} placeholder="123456789" />
              {s.aliexpress.appKey && <div style={{ fontSize: 11, color: '#4ade80', marginTop: 3 }}>✓ {s.aliexpress.appKey}</div>}
            </div>
            <div className="fld">
              <label className="lbl">App Secret</label>
              <input className="inp" type="password" value={s.aliexpress.appSecret}
                onChange={e => setAli('appSecret', e.target.value)} placeholder="••••••••••••••••" />
              {s.aliexpress.appSecret && <div style={{ fontSize: 11, color: '#4ade80', marginTop: 3 }}>✓ Inserito ({s.aliexpress.appSecret.length} car.)</div>}
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
              onChange={e => { const v = e.target.value; setS(prev => ({ ...prev, channels: prev.channels.map((c, j) => j === i ? v : c) })); }} />
            <button className="btn bre bic" onClick={() => setS(prev => ({ ...prev, channels: prev.channels.filter((_, j) => j !== i) }))}>×</button>
          </div>
        ))}
        <button className="btn bp bsm" style={{ marginTop: 4, width: '100%' }}
          onClick={() => setS(prev => ({ ...prev, channels: [...prev.channels, ''] }))}>+ Aggiungi canale</button>
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
      <div className="fld">
        <button className="btn bp bfull" onClick={save}>✅ Salva impostazioni</button>
        {saved && <div style={{ marginTop: 10, padding: '10px 14px', background: '#0a2a0a', border: '1px solid #1a5c1a', borderRadius: 8, color: '#4ade80', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>✓ Impostazioni salvate con successo</div>}
        {saveErr && <ErrorBanner>{saveErr}</ErrorBanner>}
      </div>
    </div>
  );
}
