import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { NavPage, TextLayout, LayoutType, Tag, Template, TextEl, ImgEl, makeDefaultTemplate } from '../types';
import { PageHeader, SwitchTabs, InfoBanner, ErrorBanner, ToggleRow } from '../components/Shared';
import { genId } from '../data/mock';
import { tagsApi, layoutsApi, templatesApi, settingsApi } from '../lib/api';

// ============================================================
// LAYOUT PAGE (Tags / Text / Template)
// ============================================================
export function LayoutPage({ nav }: { nav: (p: NavPage) => void }) {
  const [tab, setTab] = useState('tags');
  return (
    <div className="pg">
      <PageHeader title="Layout" onBack={() => nav('dash')} />
      <SwitchTabs
        options={[['tags', '🏷️ Tag'], ['testo', '📝 Testo'], ['template', '🖼️ Template']]}
        value={tab} onChange={setTab}
      />
      {tab === 'tags' && <TagsSection />}
      {tab === 'testo' && <TextLayoutSection />}
      {tab === 'template' && <TemplateSection />}
    </div>
  );
}

// ── Tags ─────────────────────────────────────────────────────
function TagsSection() {
  const { tags, setTags } = useApp();
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editValue, setEditValue] = useState('');

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

  return (
    <>
      <div className="stit">TAG DISPONIBILI ({tags.length})</div>
      {tags.map(t => (
        <div key={t.id} className="card" style={{ margin: '0 16px 8px', padding: '10px 12px' }}>
          {editId === t.id ? (
            <>
              <input className="inp" value={editName} onChange={e => setEditName(e.target.value)}
                placeholder="{nome_tag}" style={{ marginBottom: 7 }} />
              <div className="irow">
                <input className="inp" value={editValue} onChange={e => setEditValue(e.target.value)}
                  placeholder="Valore sostituito nel post"
                  onKeyDown={e => e.key === 'Enter' && saveEdit()} />
                <button className="btn bp bsm" onClick={saveEdit} style={{ flexShrink: 0 }}>✓</button>
                <button className="btn bs bsm" onClick={() => setEditId(null)} style={{ flexShrink: 0 }}>×</button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="tag-pill" style={{ flexShrink: 0 }}>{t.name}</span>
              <span style={{ fontSize: 12, color: 'var(--t2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.value || <span style={{ fontStyle: 'italic', color: 'var(--t3)' }}>nessun valore</span>}
              </span>
              <button className="btn bgh bsm" style={{ padding: '3px 8px' }} onClick={() => startEdit(t)}>✏️</button>
              <button className="btn bgh bsm" style={{ color: 'var(--re)', padding: '3px 8px' }}
                onClick={() => { setTags(ts => ts.filter(x => x.id !== t.id)); tagsApi.delete(t.id).catch(() => {}); }}>×</button>
            </div>
          )}
        </div>
      ))}

      <div className="stit">AGGIUNGI TAG</div>
      <div style={{ padding: '0 16px 8px' }}>
        <input className="inp" value={newName} onChange={e => setNewName(e.target.value)}
          placeholder="{nome_tag}" style={{ marginBottom: 7 }}
          onKeyDown={e => e.key === 'Enter' && addTag()} />
        <div className="irow">
          <input className="inp" value={newValue} onChange={e => setNewValue(e.target.value)}
            placeholder="Valore / descrizione"
            onKeyDown={e => e.key === 'Enter' && addTag()} />
          <button className="btn bp" onClick={addTag} style={{ padding: '0 16px', flexShrink: 0 }}>+ Aggiungi</button>
        </div>
      </div>
      <InfoBanner>Il <b>nome</b> è il placeholder nei layout (es. {'{titolo}'}). Il <b>valore</b> viene sostituito durante la pubblicazione.</InfoBanner>
    </>
  );
}

// ── Text Layouts ──────────────────────────────────────────────
const TIPO_STYLE: Record<LayoutType, string> = {
  normal: 'ltype norm',
  historical_low: 'ltype hist',
  multi: 'ltype mult',
};
const TIPO_LABEL: Record<LayoutType, string> = {
  normal: 'Normale',
  historical_low: 'Min. Storico',
  multi: 'Multiplo',
};

function TextLayoutSection() {
  const { layouts, setLayouts } = useApp();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<TextLayout, 'id'>>({ nome: '', tipo: 'normal', contenuto: '' });

  const startNew = () => { setForm({ nome: '', tipo: 'normal', contenuto: '' }); setEditing('new'); };
  const startEdit = (l: TextLayout) => { setForm({ nome: l.nome, tipo: l.tipo, contenuto: l.contenuto }); setEditing(l.id); };

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
          </select>
        </div>
        <div className="fld">
          <label className="lbl">Contenuto — usa tag come {'{titolo}'}, {'{prezzo_scontato}'}, {'{custom}'}</label>
          <textarea className="txta" value={form.contenuto} onChange={e => setForm({ ...form, contenuto: e.target.value })} rows={8} />
        </div>
        <div style={{ padding: '0 16px 16px', display: 'flex', gap: 8 }}>
          <button className="btn bs" style={{ flex: 1 }} onClick={() => setEditing(null)}>Annulla</button>
          <button className="btn bp" style={{ flex: 1 }} onClick={save}>💾 Salva layout</button>
        </div>
      </>
    );
  }

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
            <button className="btn bgh bsm" style={{ color: 'var(--re)' }} onClick={() => { setLayouts(ls => ls.filter(x => x.id !== l.id)); layoutsApi.delete(l.id).catch(() => {}); }}>×</button>
          </div>
          <div className="lpreview">{l.contenuto}</div>
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

// Joystick 2D position pad
const Joystick = React.memo(function Joystick({ x, y, onChange, label }: {
  x: number; y: number;
  onChange: (x: number, y: number) => void;
  label?: string;
}) {
  const padRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const cbRef = useRef(onChange);
  useEffect(() => { cbRef.current = onChange; });

  const toPos = (clientX: number, clientY: number) => {
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nx = Math.round(Math.min(90, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
    const ny = Math.round(Math.min(90, Math.max(0, ((clientY - rect.top) / rect.height) * 100)));
    cbRef.current(nx, ny);
  };

  useEffect(() => {
    const el = padRef.current;
    if (!el) return;
    const onTS = (e: TouchEvent) => { e.preventDefault(); if (e.touches[0]) toPos(e.touches[0].clientX, e.touches[0].clientY); };
    const onTM = (e: TouchEvent) => { e.preventDefault(); if (e.touches[0]) toPos(e.touches[0].clientX, e.touches[0].clientY); };
    el.addEventListener('touchstart', onTS, { passive: false });
    el.addEventListener('touchmove', onTM, { passive: false });
    return () => { el.removeEventListener('touchstart', onTS); el.removeEventListener('touchmove', onTM); };
  }, []); // stable via cbRef

  return (
    <div style={{ marginBottom: 12 }}>
      {label && <div className="lbl" style={{ marginBottom: 4 }}>{label}</div>}
      <div
        ref={padRef}
        style={{ width: '100%', height: 100, background: 'var(--bg3)', borderRadius: 8, position: 'relative', cursor: 'crosshair', userSelect: 'none', border: '1px solid var(--bd)' }}
        onMouseDown={e => { dragging.current = true; toPos(e.clientX, e.clientY); }}
        onMouseMove={e => { if (dragging.current) toPos(e.clientX, e.clientY); }}
        onMouseUp={() => { dragging.current = false; }}
        onMouseLeave={() => { dragging.current = false; }}
      >
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.08)' }} />
        <div style={{
          position: 'absolute', left: `${x}%`, top: `${y}%`,
          width: 20, height: 20, background: 'var(--a1)', borderRadius: '50%',
          transform: 'translate(-50%, -50%)', border: '2px solid #fff',
          boxShadow: '0 0 0 2px var(--a1)', pointerEvents: 'none', zIndex: 1,
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--t3)', marginTop: 3 }}>
        <span>X: {x}%</span><span>Y: {y}%</span>
      </div>
    </div>
  );
});

function SizeSlider({ value, onChange, min = 5, max = 100, label = 'DIMENSIONE' }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; label?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <span className="lbl" style={{ marginBottom: 0, flex: 1 }}>{label}</span>
      <input type="range" min={min} max={max} value={value}
        style={{ flex: 2, accentColor: 'var(--a1)' }}
        onChange={e => onChange(Number(e.target.value))} />
      <span style={{ fontSize: 11, color: 'var(--t2)', width: 32, textAlign: 'right' }}>{value}%</span>
    </div>
  );
}

// Live CSS preview of the template
const PREVIEW_SCALE = 0.3;

function TemplatePreviewer({ tpl }: { tpl: Template }) {
  const pp = tpl.product;
  return (
    <div style={{
      margin: '12px 16px', borderRadius: 10, overflow: 'hidden',
      position: 'relative', aspectRatio: '1/1', background: tpl.bgColor,
      boxShadow: '0 2px 16px rgba(0,0,0,0.4)',
    }}>
      {/* Product placeholder */}
      <div style={{
        position: 'absolute', left: `${pp.x}%`, top: `${pp.y}%`,
        width: `${pp.size}%`, height: `${pp.size}%`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(128,128,128,0.08)',
      }}>
        <span style={{ fontSize: `${pp.size * 0.4}px`, opacity: 0.5 }}>📦</span>
      </div>

      {/* Overlay */}
      {tpl.overlay.enabled && tpl.overlay.src && (
        <img src={tpl.overlay.src} alt="" style={{
          position: 'absolute', left: `${tpl.overlay.x}%`, top: `${tpl.overlay.y}%`,
          width: `${tpl.overlay.size}%`, height: `${tpl.overlay.size}%`,
          objectFit: 'contain', pointerEvents: 'none',
        }} />
      )}

      {/* Badge */}
      {tpl.badge.enabled && tpl.badge.src && (
        <img src={tpl.badge.src} alt="" style={{
          position: 'absolute', left: `${tpl.badge.x}%`, top: `${tpl.badge.y}%`,
          width: `${tpl.badge.size}%`, objectFit: 'contain', pointerEvents: 'none',
        }} />
      )}
      {tpl.badge.enabled && !tpl.badge.src && (
        <div style={{
          position: 'absolute', left: `${tpl.badge.x}%`, top: `${tpl.badge.y}%`,
          background: '#fbbf24', color: '#000', fontSize: 8, padding: '2px 4px',
          borderRadius: 3, fontWeight: 700, pointerEvents: 'none',
        }}>🏆 MIN</div>
      )}

      {/* Store placeholder */}
      {tpl.store.enabled && (
        <div style={{
          position: 'absolute', left: `${tpl.store.x}%`, top: `${tpl.store.y}%`,
          width: `${tpl.store.size}%`, aspectRatio: '1/1',
          background: '#FF9900', borderRadius: '20%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: `${tpl.store.size * 0.4}px`, pointerEvents: 'none',
        }}>🏪</div>
      )}

      {/* Text elements */}
      {([
        { el: tpl.prezzo as TextEl, text: '€24,99' },
        { el: tpl.prezzoPrecedente as TextEl, text: '€49,99' },
        { el: tpl.sconto as TextEl, text: '-50%' },
        { el: tpl.testoCustom as TextEl, text: tpl.testoCustom.text || 'Testo custom' },
      ]).map(({ el, text }, i) =>
        el.enabled ? (
          <div key={i} style={{
            position: 'absolute', left: `${el.x}%`, top: `${el.y}%`,
            fontSize: `${el.fontSize * PREVIEW_SCALE}px`,
            fontFamily: el.fontFamily, fontWeight: el.bold ? 700 : 400,
            color: el.color,
            textDecoration: el.strikethrough ? 'line-through' : 'none',
            WebkitTextStroke: el.strokeEnabled ? `${el.strokeWidth * PREVIEW_SCALE}px ${el.strokeColor}` : undefined,
            whiteSpace: 'nowrap', pointerEvents: 'none',
          }}>
            {text}
          </div>
        ) : null
      )}
    </div>
  );
}

// ── Component panels ──────────────────────────────────────────

function OverlayImgPanel({ el, onUpdate, onFile }: {
  el: ImgEl;
  onUpdate: (ch: Partial<ImgEl>) => void;
  onFile: (f: File | null) => void;
}) {
  return (
    <>
      <div style={{ background: 'var(--bg3)', borderRadius: 8, marginBottom: 10 }}>
        <ToggleRow label="Mostra overlay" value={el.enabled} onChange={v => onUpdate({ enabled: v })} />
      </div>
      <label className="btn bs" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', justifyContent: 'center', marginBottom: 6 }}>
        🖼️ {el.src ? '✓ Overlay caricato — cambia' : 'Carica overlay PNG'}
        <input type="file" accept="image/png,image/webp" style={{ display: 'none' }}
          onChange={e => onFile(e.target.files?.[0] ?? null)} />
      </label>
      {el.src && (
        <button className="btn bgh bsm" style={{ color: 'var(--re)', width: '100%', marginBottom: 8 }}
          onClick={() => onUpdate({ src: null })}>× Rimuovi overlay</button>
      )}
      <SizeSlider value={el.size} onChange={v => onUpdate({ size: v })} min={10} max={100} />
      <Joystick x={el.x} y={el.y} onChange={(x, y) => onUpdate({ x, y })} label="POSIZIONE (trascina)" />
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
      <div style={{ background: 'var(--bg3)', borderRadius: 8, marginBottom: 10 }}>
        <ToggleRow label="Badge minimo storico" sub="Visibile solo se il prodotto è al minimo storico" value={el.enabled} onChange={v => onUpdate({ enabled: v })} />
      </div>
      <label className="btn bs" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', justifyContent: 'center', marginBottom: 6 }}>
        🏆 {el.src ? '✓ Icona caricata — cambia' : 'Carica icona badge'}
        <input type="file" accept="image/*" style={{ display: 'none' }}
          onChange={e => onFile(e.target.files?.[0] ?? null)} />
      </label>
      {el.src && (
        <button className="btn bgh bsm" style={{ color: 'var(--re)', width: '100%', marginBottom: 8 }}
          onClick={() => onUpdate({ src: null })}>× Rimuovi icona</button>
      )}
      <SizeSlider value={el.size} onChange={v => onUpdate({ size: v })} min={5} max={50} />
      <Joystick x={el.x} y={el.y} onChange={(x, y) => onUpdate({ x, y })} label="POSIZIONE (trascina)" />
    </>
  );
}

function StorePanel({ el, onUpdate }: {
  el: ImgEl;
  onUpdate: (ch: Partial<ImgEl>) => void;
}) {
  return (
    <>
      <div style={{ background: 'var(--bg3)', borderRadius: 8, marginBottom: 10 }}>
        <ToggleRow label="Logo store" sub="Amazon o AliExpress — automatico in base al link" value={el.enabled} onChange={v => onUpdate({ enabled: v })} />
      </div>
      <InfoBanner>🟡 Amazon · 🔴 AliExpress — il logo si adatta automaticamente al tipo di prodotto</InfoBanner>
      <SizeSlider value={el.size} onChange={v => onUpdate({ size: v })} min={5} max={40} />
      <Joystick x={el.x} y={el.y} onChange={(x, y) => onUpdate({ x, y })} label="POSIZIONE (trascina)" />
    </>
  );
}

const FONTS = ['Impact', 'Arial', 'Arial Black', 'Georgia', 'Verdana', 'Courier New'];

function TextElPanel({ el, onUpdate, showTextInput = false }: {
  el: TextEl;
  onUpdate: (ch: Partial<TextEl>) => void;
  showTextInput?: boolean;
}) {
  return (
    <>
      <div style={{ background: 'var(--bg3)', borderRadius: 8, marginBottom: 10 }}>
        <ToggleRow label="Attivo" value={el.enabled} onChange={v => onUpdate({ enabled: v })} />
      </div>

      {showTextInput && (
        <div style={{ marginBottom: 10 }}>
          <div className="lbl">TESTO</div>
          <input className="inp" value={el.text} onChange={e => onUpdate({ text: e.target.value })} placeholder="Testo personalizzato..." />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span className="lbl" style={{ marginBottom: 0, flex: 1 }}>DIMENSIONE FONT</span>
        <input type="range" min={10} max={80} value={el.fontSize}
          style={{ flex: 2, accentColor: 'var(--a1)' }}
          onChange={e => onUpdate({ fontSize: Number(e.target.value) })} />
        <span style={{ fontSize: 11, color: 'var(--t2)', width: 32, textAlign: 'right' }}>{el.fontSize}px</span>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div className="lbl">FONT</div>
        <select className="sel" value={el.fontFamily} onChange={e => onUpdate({ fontFamily: e.target.value })}>
          {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className={`btn bsm ${el.bold ? 'bp' : 'bgh'}`} style={{ flex: 1, fontWeight: 700 }}
          onClick={() => onUpdate({ bold: !el.bold })}>B Grassetto</button>
        <button className={`btn bsm ${el.strikethrough ? 'bp' : 'bgh'}`} style={{ flex: 1, textDecoration: 'line-through' }}
          onClick={() => onUpdate({ strikethrough: !el.strikethrough })}>S Barrato</button>
      </div>

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

      <Joystick x={el.x} y={el.y} onChange={(x, y) => onUpdate({ x, y })} label="POSIZIONE (trascina)" />
    </>
  );
}

// ── Template Section ──────────────────────────────────────────

type ComponentKey = 'overlay' | 'badge' | 'prezzo' | 'prezzoPrecedente' | 'sconto' | 'testoCustom' | 'store';

const COMP_BUTTONS: { id: ComponentKey; icon: string; label: string }[] = [
  { id: 'overlay',          icon: '🖼️', label: 'Overlay' },
  { id: 'badge',            icon: '🏆', label: 'Badge' },
  { id: 'prezzo',           icon: '💰', label: 'Prezzo' },
  { id: 'prezzoPrecedente', icon: '📉', label: 'Prec.' },
  { id: 'sconto',           icon: '🏷️', label: 'Sconto' },
  { id: 'testoCustom',      icon: '📝', label: 'Testo' },
  { id: 'store',            icon: '🏪', label: 'Store' },
];

function getElEnabled(id: ComponentKey, tpl: Template): boolean {
  if (id === 'overlay' || id === 'badge' || id === 'store') return (tpl[id] as ImgEl).enabled;
  return (tpl[id] as TextEl).enabled;
}

function TemplateSection() {
  const { templates, setTemplates } = useApp();
  const [activePanel, setActivePanel] = useState<ComponentKey | null>(null);

  const tpl = templates[0] ?? makeDefaultTemplate('tpl1');

  const saveTpl = (t: Template) => {
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

  const updateImg = (key: 'overlay' | 'badge' | 'store', changes: Partial<ImgEl>) => {
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

  const handleFile = async (key: 'overlay' | 'badge', file: File | null) => {
    if (!file) return;
    const b64 = await readAsBase64(file);
    updateImg(key, { src: b64 });
  };

  const isTextKey = (k: ComponentKey): k is 'prezzo' | 'prezzoPrecedente' | 'sconto' | 'testoCustom' =>
    ['prezzo', 'prezzoPrecedente', 'sconto', 'testoCustom'].includes(k);

  return (
    <>
      {/* Live preview */}
      <TemplatePreviewer tpl={tpl} />

      {/* Background color */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 16px 14px' }}>
        <span className="lbl" style={{ marginBottom: 0, flex: 1 }}>COLORE SFONDO</span>
        <input type="color" value={tpl.bgColor} style={{ width: 40, height: 30, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
          onChange={e => updateTpl({ bgColor: e.target.value })} />
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>{tpl.bgColor}</span>
      </div>

      {/* Component buttons — scrollable row */}
      <div style={{ display: 'flex', gap: 6, padding: '0 16px 14px', overflowX: 'auto' }}>
        {COMP_BUTTONS.map(b => {
          const enabled = getElEnabled(b.id, tpl);
          const isActive = activePanel === b.id;
          return (
            <button key={b.id}
              className={`btn bsm ${isActive ? 'bp' : enabled ? 'bs' : 'bgh'}`}
              style={{ flexShrink: 0, fontSize: 11 }}
              onClick={() => setActivePanel(isActive ? null : b.id)}
            >
              {b.icon} {b.label}
              {enabled && !isActive && <span style={{ marginLeft: 3, fontSize: 7, color: 'var(--a3)' }}>●</span>}
            </button>
          );
        })}
      </div>

      {/* Active panel */}
      {activePanel && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--bd)', paddingTop: 14 }}>
          {activePanel === 'overlay' && (
            <OverlayImgPanel el={tpl.overlay} onUpdate={ch => updateImg('overlay', ch)} onFile={f => handleFile('overlay', f)} />
          )}
          {activePanel === 'badge' && (
            <BadgeImgPanel el={tpl.badge} onUpdate={ch => updateImg('badge', ch)} onFile={f => handleFile('badge', f)} />
          )}
          {activePanel === 'store' && (
            <StorePanel el={tpl.store} onUpdate={ch => updateImg('store', ch)} />
          )}
          {isTextKey(activePanel) && (
            <TextElPanel
              el={tpl[activePanel] as TextEl}
              onUpdate={ch => updateText(activePanel as 'prezzo' | 'prezzoPrecedente' | 'sconto' | 'testoCustom', ch)}
              showTextInput={activePanel === 'testoCustom'}
            />
          )}
        </div>
      )}

      {!activePanel && (
        <InfoBanner>Seleziona un componente per modificarlo. Le modifiche vengono salvate automaticamente.</InfoBanner>
      )}
    </>
  );
}

// ============================================================
// SETTINGS PAGE
// ============================================================
const MARKETPLACES = ['IT', 'US', 'DE', 'FR', 'ES', 'UK', 'JP'];

export function SettingsPage({ nav }: { nav: (p: NavPage) => void }) {
  const { settings, setSettings } = useApp();
  const [s, setS] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState('');

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

  return (
    <div className="pg">
      <PageHeader title="Impostazioni" onBack={() => nav('dash')} />

      {/* ── Amazon ── */}
      <div className="stit">AMAZON CREATORS API</div>
      <div className="api-card">
        <div className="api-top">
          <div className="api-ico" style={{ background: '#1a1000' }}>🟡</div>
          <div className="api-name">Amazon Associates</div>
          <div className={`api-st ${s.amazon.enabled ? 'api-ok' : 'api-no'}`}>
            {s.amazon.enabled ? '✓ Attivo' : 'Disattivato'}
          </div>
        </div>
        <ToggleRow label="Attiva Amazon" value={s.amazon.enabled} onChange={v => setAmazon('enabled', v)} />
        <div className="fld">
          <label className="lbl">Partner Tag / Application ID</label>
          <input className="inp" value={s.amazon.affiliateTag} onChange={e => setAmazon('affiliateTag', e.target.value)} placeholder="cavalieridelr-21.alipost2" />
          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>Inserisci l'Application ID dalla dashboard Creators API (formato: tag-21.nomeapp)</div>
        </div>
        <div className="fld">
          <label className="lbl">Versione credenziale</label>
          <select className="sel" value={s.amazon.version} onChange={e => setAmazon('version', e.target.value)}>
            <option value="2.1">2.1 — Nord America</option>
            <option value="2.2">2.2 — Europa</option>
            <option value="2.3">2.3 — Far East</option>
            <option value="3.1">3.1 — Nord America (LWA)</option>
            <option value="3.2">3.2 — Europa (LWA)</option>
            <option value="3.3">3.3 — Far East (LWA)</option>
          </select>
        </div>
        <div className="fld">
          <label className="lbl">Marketplace</label>
          <select className="sel" value={s.amazon.marketplace} onChange={e => setAmazon('marketplace', e.target.value)}>
            {MARKETPLACES.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="fld">
          <label className="lbl" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Credential ID
            <span style={{ fontSize: 10, background: '#2a1800', color: '#f59e0b', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>SOLO BACKEND</span>
          </label>
          <input className="inp" type="password" value={s.amazon.credentialId} onChange={e => setAmazon('credentialId', e.target.value)} placeholder="amzn1.application-oa2-client...." />
          {s.amazon.credentialId && <div style={{ fontSize: 11, color: '#4ade80', marginTop: 3 }}>✓ Configurato ({s.amazon.credentialId.length} caratteri)</div>}
        </div>
        <div className="fld">
          <label className="lbl" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Credential Secret
            <span style={{ fontSize: 10, background: '#2a1800', color: '#f59e0b', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>SOLO BACKEND</span>
          </label>
          <input className="inp" type="password" value={s.amazon.credentialSecret} onChange={e => setAmazon('credentialSecret', e.target.value)} placeholder="amzn1.oa2-cs.v1...." />
          {s.amazon.credentialSecret && <div style={{ fontSize: 11, color: '#4ade80', marginTop: 3 }}>✓ Configurato ({s.amazon.credentialSecret.length} caratteri)</div>}
        </div>
        <InfoBanner>🔒 Credential ID e Secret non vengono mai esposti nel frontend. Creali su Associates → Strumenti → CreatorsAPI.</InfoBanner>
      </div>

      {/* ── AliExpress ── */}
      <div className="stit">ALIEXPRESS SETTINGS</div>
      <div className="api-card">
        <div className="api-top">
          <div className="api-ico" style={{ background: '#1a0808' }}>🔴</div>
          <div className="api-name">AliExpress Affiliate</div>
          <div className={`api-st ${s.aliexpress.enabled ? 'api-ok' : 'api-no'}`}>
            {s.aliexpress.enabled ? '✓ Attivo' : 'Disattivato'}
          </div>
        </div>
        <ToggleRow label="Attiva AliExpress" value={s.aliexpress.enabled} onChange={v => setAli('enabled', v)} />
        <div className="fld">
          <label className="lbl">Affiliate ID</label>
          <input className="inp" value={s.aliexpress.affiliateId} onChange={e => setAli('affiliateId', e.target.value)} placeholder="12345678" />
        </div>
        <div className="fld">
          <label className="lbl">Tracking ID</label>
          <input className="inp" value={s.aliexpress.trackingId} onChange={e => setAli('trackingId', e.target.value)} placeholder="affiliate_tracking_id" />
        </div>
      </div>

      {/* ── Telegram ── */}
      <div className="stit">CANALI TELEGRAM</div>
      <div className="api-card">
        <div className="api-top">
          <div className="api-ico" style={{ background: '#0a1a2a' }}>✈️</div>
          <div className="api-name">Canali di pubblicazione</div>
          <div className={`api-st ${s.channels.filter(Boolean).length > 0 ? 'api-ok' : 'api-no'}`}>
            {s.channels.filter(Boolean).length > 0 ? `${s.channels.filter(Boolean).length} canale` : 'Nessuno'}
          </div>
        </div>
        <InfoBanner>
          1. Aggiungi il bot come <b>amministratore</b> del tuo canale Telegram.<br />
          2. Inserisci lo <b>username del canale</b> (es. <b>@miocanale</b>) o l'<b>ID numerico</b> (es. <b>-1001234567890</b>).<br />
          3. Il primo canale della lista è quello usato per la pubblicazione.
        </InfoBanner>
        {settings.channels.filter(Boolean).length > 0 && (
          <div style={{ fontSize: 11, color: '#4ade80', marginBottom: 8, padding: '6px 10px', background: '#0a2a0a', borderRadius: 6 }}>
            ✓ Salvato in DB: {settings.channels.filter(Boolean).join(', ')}
          </div>
        )}
        {s.channels.map((ch, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--t3)', minWidth: 20 }}>{i + 1}.</div>
            <input className="inp" value={ch}
              placeholder="@username oppure -1001234567890"
              onChange={e => { const v = e.target.value; setS(prev => ({ ...prev, channels: prev.channels.map((c, j) => j === i ? v : c) })); }} />
            <button className="btn bre bic" onClick={() => setS(prev => ({ ...prev, channels: prev.channels.filter((_, j) => j !== i) }))}>×</button>
          </div>
        ))}
        <button className="btn bp bsm" style={{ marginTop: 4, width: '100%' }}
          onClick={() => setS(prev => ({ ...prev, channels: [...prev.channels, ''] }))}>+ Aggiungi canale</button>
      </div>

      {/* ── AutoPost ── */}
      <div className="stit">AUTOPOST</div>
      <ToggleRow label="AutoPost attivo" sub="Pubblicazione automatica programmata" value={s.attivo} onChange={v => setS({ ...s, attivo: v })} />
      <div style={{ height: 12 }} />
      <div className="fld"><label className="lbl">Ora inizio</label><input type="time" className="inp" value={s.oraI} onChange={e => setS({ ...s, oraI: e.target.value })} /></div>
      <div className="fld"><label className="lbl">Ora fine</label><input type="time" className="inp" value={s.oraF} onChange={e => setS({ ...s, oraF: e.target.value })} /></div>
      <div className="fld">
        <label className="lbl">Intervallo (minuti)</label>
        <input type="number" className="inp" value={s.interv} min={15} max={1440} onChange={e => setS({ ...s, interv: parseInt(e.target.value) || 60 })} />
      </div>
      <div className="fld">
        <button className="btn bp bfull" onClick={save}>✅ Salva impostazioni</button>
        {saved && <div style={{ marginTop: 10, padding: '10px 14px', background: '#0a2a0a', border: '1px solid #1a5c1a', borderRadius: 8, color: '#4ade80', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>✓ Impostazioni salvate con successo</div>}
        {saveErr && <ErrorBanner>{saveErr}</ErrorBanner>}
      </div>
    </div>
  );
}
