import React, { useState } from 'react';
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

// Arrow-based position control — replaces drag joystick
function PositionArrows({ x, y, onChange }: {
  x: number; y: number;
  onChange: (x: number, y: number) => void;
}) {
  const [step, setStep] = useState(3);

  const move = (dx: number, dy: number) => {
    onChange(
      Math.min(95, Math.max(0, Math.round(x + dx * step))),
      Math.min(95, Math.max(0, Math.round(y + dy * step))),
    );
  };

  const arrowBtn: React.CSSProperties = {
    width: 48, height: 48, padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span className="lbl" style={{ marginBottom: 0 }}>POSIZIONE</span>
        <span style={{ fontSize: 10, color: 'var(--t3)', marginLeft: 'auto' }}>X:{x}% · Y:{y}%</span>
      </div>
      {/* Step selector */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }}>Passo:</span>
        {[1, 3, 5, 10].map(s => (
          <button key={s} className={`btn bsm ${step === s ? 'bp' : 'bgh'}`}
            style={{ fontSize: 10, padding: '2px 10px' }}
            onClick={() => setStep(s)}>{s}%</button>
        ))}
      </div>
      {/* Arrow pad */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 48px)', gap: 4, justifyContent: 'center' }}>
        <div />
        <button className="btn bgh" style={arrowBtn} onClick={() => move(0, -1)}>↑</button>
        <div />
        <button className="btn bgh" style={arrowBtn} onClick={() => move(-1, 0)}>←</button>
        <div style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg3)', borderRadius: 8, fontSize: 20, color: 'var(--t3)' }}>✛</div>
        <button className="btn bgh" style={arrowBtn} onClick={() => move(1, 0)}>→</button>
        <div />
        <button className="btn bgh" style={arrowBtn} onClick={() => move(0, 1)}>↓</button>
        <div />
      </div>
    </div>
  );
}

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

// Scale che allinea la preview CSS al canvas 1024px (fontSize * 2 / preview ~340px)
const PREVIEW_SCALE = 0.65;

export function TemplatePreviewer({ tpl }: { tpl: Template }) {
  const pp = tpl.product;
  return (
    <div style={{
      margin: '12px 16px', borderRadius: 10, overflow: 'hidden',
      position: 'relative', aspectRatio: '1/1', background: tpl.bgColor,
      boxShadow: '0 2px 16px rgba(0,0,0,0.4)', isolation: 'isolate',
    }}>
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

      {/* Store icon */}
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
        { el: tpl.testoCustom as TextEl, text: tpl.testoCustom.text || 'Testo' },
      ]).map(({ el, text }, i) =>
        el.enabled ? (
          <div key={i} style={{
            position: 'absolute',
            ...(el.textAnchor === 'right'
              ? { right: `${100 - el.x}%`, top: `${el.y}%` }
              : { left: `${el.x}%`, top: `${el.y}%` }),
            fontSize: `${el.fontSize * PREVIEW_SCALE}px`,
            fontFamily: el.fontFamily, fontWeight: el.bold ? 700 : 400,
            color: el.color,
            textDecoration: el.strikethrough ? `line-through ${el.strikethroughColor || el.color}` : 'none',
            WebkitTextStroke: el.strokeEnabled ? `${el.strokeWidth * PREVIEW_SCALE}px ${el.strokeColor}` : undefined,
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
      <InfoBanner>📦 Riquadro dove verrà inserita l'immagine Amazon/AliExpress. Spostalo e ridimensionalo secondo le tue preferenze.</InfoBanner>
      <PositionArrows x={el.x} y={el.y} onChange={(x, y) => onUpdate({ x, y })} />
      <SizeSlider value={el.size} onChange={v => onUpdate({ size: v })} min={20} max={100} label="DIMENSIONE RIQUADRO" />
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
      <PositionArrows x={el.x} y={el.y} onChange={(x, y) => onUpdate({ x, y })} />
      <SizeSlider value={el.size} onChange={v => onUpdate({ size: v })} min={10} max={100} />
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
      <PositionArrows x={el.x} y={el.y} onChange={(x, y) => onUpdate({ x, y })} />
      <SizeSlider value={el.size} onChange={v => onUpdate({ size: v })} min={5} max={50} />
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

function StorePanel({ el, onUpdate }: {
  el: ImgEl;
  onUpdate: (ch: Partial<ImgEl>) => void;
}) {
  return (
    <>
      <PositionArrows x={el.x} y={el.y} onChange={(x, y) => onUpdate({ x, y })} />
      <SizeSlider value={el.size} onChange={v => onUpdate({ size: v })} min={5} max={40} />
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

      <PositionArrows x={el.x} y={el.y} onChange={(x, y) => onUpdate({ x, y })} />

      {/* Direzione crescita testo */}
      <div style={{ marginBottom: 12 }}>
        <div className="lbl">ANCORA TESTO</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={`btn bsm ${(el.textAnchor ?? 'left') === 'left' ? 'bp' : 'bgh'}`}
            style={{ flex: 1 }} onClick={() => onUpdate({ textAnchor: 'left' })}>← da sinistra</button>
          <button className={`btn bsm ${el.textAnchor === 'right' ? 'bp' : 'bgh'}`}
            style={{ flex: 1 }} onClick={() => onUpdate({ textAnchor: 'right' })}>da destra →</button>
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

type ComponentKey = 'product' | 'overlay' | 'badge' | 'prezzo' | 'prezzoPrecedente' | 'sconto' | 'testoCustom' | 'store';

const COMP_INFO: Record<ComponentKey, string> = {
  product:          '📦 Riquadro dove apparirà la foto del prodotto. Spostalo con le frecce e ridimensionalo con lo slider.',
  overlay:          '🖼️ Immagine sovrapposta (cornice, sfondo decorativo). Carica un PNG con trasparenza. Spostalo e ridimensionalo.',
  badge:            '🏆 Icona visibile solo sui prodotti al minimo storico. Viene disegnata sopra tutti gli altri layer. Carica un PNG e posizionalo.',
  prezzo:           '💰 Prezzo scontato — inserito automaticamente dal post. Spostalo, scegli font e colore. Con "ancora destra" il testo cresce verso sinistra dal punto impostato.',
  prezzoPrecedente: '📉 Prezzo precedente (barrato) — inserito automaticamente. Puoi cambiare il colore della barra barrata separatamente dal colore del testo.',
  sconto:           '🏷️ Percentuale di sconto — calcolata automaticamente (es. -50%). Impostane font, colore e posizione.',
  testoCustom:      '📝 Testo libero personalizzabile. Corrisponde al campo "Testo custom" del post. Puoi scrivere un testo fisso o lasciarlo vuoto.',
  store:            '🏪 Logo negozio automatico: arancio Amazon, rosso AliExpress. Si adatta in base al tipo di prodotto del post.',
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
];

function getElEnabled(id: ComponentKey, tpl: Template): boolean {
  if (id === 'product') return true;
  if (id === 'overlay' || id === 'badge' || id === 'store') return (tpl[id] as ImgEl).enabled;
  return (tpl[id] as TextEl).enabled;
}

function TemplateSection() {
  const { templates, setTemplates } = useApp();
  const [activePanel, setActivePanel] = useState<ComponentKey | null>(null);
  const [showInfo, setShowInfo] = useState(false);

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
    updateImg(key, { src: b64 });
  };

  const isTextKey = (k: ComponentKey): k is 'prezzo' | 'prezzoPrecedente' | 'sconto' | 'testoCustom' =>
    ['prezzo', 'prezzoPrecedente', 'sconto', 'testoCustom'].includes(k);

  const toggleEnabled = (id: ComponentKey) => {
    if (id === 'product') return;
    const cur = getElEnabled(id, tpl);
    if (id === 'overlay' || id === 'badge' || id === 'store') {
      updateImg(id as 'overlay' | 'badge' | 'store', { enabled: !cur });
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
              <div key={b.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                <button
                  className={`btn bsm ${isActive ? 'bp' : 'bgh'}`}
                  style={{ fontSize: 11, opacity: canToggle && !enabled ? 0.45 : 1 }}
                  onClick={() => setActivePanel(isActive ? null : b.id)}
                >
                  {b.icon} {b.label}
                </button>
                {canToggle && (
                  <button
                    onClick={() => toggleEnabled(b.id)}
                    style={{
                      fontSize: 9, padding: '1px 8px', borderRadius: 8, cursor: 'pointer',
                      background: enabled ? 'var(--a1)' : 'var(--bg3)',
                      color: enabled ? '#fff' : 'var(--t3)',
                      border: 'none', lineHeight: 1.6,
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

      {/* Anteprima live */}
      <TemplatePreviewer tpl={tpl} />

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
        <InfoBanner>Seleziona un componente sopra per modificarlo. L'anteprima si aggiorna in tempo reale.</InfoBanner>
      )}
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

export function SettingsPage({ nav }: { nav: (p: NavPage) => void }) {
  const { settings, setSettings } = useApp();
  const [s, setS] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [openAmz, setOpenAmz] = useState(true);
  const [openAli, setOpenAli] = useState(false);

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
              <label className="lbl">Affiliate ID</label>
              <input className="inp" value={s.aliexpress.affiliateId}
                onChange={e => setAli('affiliateId', e.target.value)} placeholder="12345678" />
            </div>
            <div className="fld">
              <label className="lbl">Tracking ID</label>
              <input className="inp" value={s.aliexpress.trackingId}
                onChange={e => setAli('trackingId', e.target.value)} placeholder="affiliate_tracking_id" />
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

      {/* ── AUTOPOST ── */}
      <div className="stit">AUTOPOST</div>
      <ToggleRow label="AutoPost attivo" sub="Pubblicazione automatica programmata" value={s.attivo} onChange={v => setS({ ...s, attivo: v })} />
      <div style={{ height: 12 }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '0 16px' }}>
        <div className="fld" style={{ margin: 0 }}><label className="lbl">Ora inizio</label><input type="time" className="inp" value={s.oraI} onChange={e => setS({ ...s, oraI: e.target.value })} /></div>
        <div className="fld" style={{ margin: 0 }}><label className="lbl">Ora fine</label><input type="time" className="inp" value={s.oraF} onChange={e => setS({ ...s, oraF: e.target.value })} /></div>
      </div>
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
