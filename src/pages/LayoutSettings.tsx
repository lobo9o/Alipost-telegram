import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { NavPage, TextLayout, LayoutType } from '../types';
import { PageHeader, SwitchTabs, InfoBanner, ToggleRow } from '../components/Shared';
import { genId } from '../data/mock';

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
  const [newTag, setNewTag] = useState('');

  const addTag = () => {
    if (!newTag.trim()) return;
    const formatted = newTag.startsWith('{') ? newTag : `{${newTag}}`;
    setTags(t => [...t, formatted]);
    setNewTag('');
  };

  return (
    <>
      <div className="stit">TAG DISPONIBILI</div>
      <div style={{ padding: '0 16px 14px', display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {tags.map((t, i) => (
          <span key={i} className="tag-pill">
            {t}
            <span className="del" onClick={() => setTags(ts => ts.filter((_, j) => j !== i))}>×</span>
          </span>
        ))}
      </div>
      <div className="stit">AGGIUNGI TAG</div>
      <div style={{ padding: '0 16px 14px' }}>
        <div className="irow">
          <input className="inp" value={newTag} onChange={e => setNewTag(e.target.value)}
            placeholder="{nuovo_tag}" onKeyDown={e => e.key === 'Enter' && addTag()} />
          <button className="btn bp" onClick={addTag} style={{ padding: '0 16px', flexShrink: 0 }}>+ Aggiungi</button>
        </div>
      </div>
      <InfoBanner>I tag vengono sostituiti dinamicamente nel testo del post durante la pubblicazione.</InfoBanner>
    </>
  );
}

// ── Text Layouts ──────────────────────────────────────────────
const TIPO_STYLE: Record<LayoutType, string> = {
  normale: 'ltype norm',
  minimo_storico: 'ltype min',
  multiplo: 'ltype mult',
};
const TIPO_LABEL: Record<LayoutType, string> = {
  normale: 'Normale',
  minimo_storico: 'Min. Storico',
  multiplo: 'Multiplo',
};

function TextLayoutSection() {
  const { layouts, setLayouts } = useApp();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<TextLayout, 'id'>>({ nome: '', tipo: 'normale', contenuto: '' });

  const startNew = () => { setForm({ nome: '', tipo: 'normale', contenuto: '' }); setEditing('new'); };
  const startEdit = (l: TextLayout) => { setForm({ nome: l.nome, tipo: l.tipo, contenuto: l.contenuto }); setEditing(l.id); };

  const save = () => {
    if (editing === 'new') setLayouts(ls => [...ls, { id: genId(), ...form }]);
    else setLayouts(ls => ls.map(x => x.id === editing ? { ...x, ...form } : x));
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
            <option value="normale">Normale</option>
            <option value="minimo_storico">Minimo Storico</option>
            <option value="multiplo">Multiplo</option>
          </select>
        </div>
        <div className="fld">
          <label className="lbl">Contenuto (usa i tag)</label>
          <textarea className="txta" value={form.contenuto} onChange={e => setForm({ ...form, contenuto: e.target.value })} rows={7} />
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
            <button className="btn bgh bsm" style={{ color: 'var(--re)' }} onClick={() => setLayouts(ls => ls.filter(x => x.id !== l.id))}>×</button>
          </div>
          <div className="lpreview">{l.contenuto}</div>
        </div>
      ))}
    </>
  );
}

// ── Template Image Editor ─────────────────────────────────────
function TemplateSection() {
  const { telElems, setTelElems } = useApp();
  const toggleVis = (id: string) => setTelElems(els => els.map(e => e.id === id ? { ...e, vis: !e.vis } : e));

  return (
    <>
      <div className="stit">CANVAS IMMAGINE</div>
      <div className="canvas-wrap" style={{ margin: '0 16px 12px' }}>
        <div className="mock-canvas">
          <div style={{ textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🖼️</div>
            Canvas 1:1<br />
            <span style={{ fontSize: 11 }}>Immagine prodotto + overlay PNG</span>
          </div>
        </div>
      </div>
      <div style={{ padding: '0 16px 10px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn bsm bs">📁 Carica overlay PNG</button>
        <button className="btn bsm bs">🖼️ Carica immagine prodotto</button>
        <button className="btn bsm bs">✦ Carica logo</button>
      </div>
      <div className="stit">ELEMENTI TEMPLATE</div>
      {telElems.map(el => (
        <div key={el.id} className="el-row">
          <div className="el-dot" style={{ background: el.color }} />
          <div className="el-name">{el.nome}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--t2)' }}>{el.vis ? 'Visibile' : 'Nascosto'}</span>
            <div className={`el-vis ${el.vis ? 'on' : ''}`} onClick={() => toggleVis(el.id)} />
          </div>
        </div>
      ))}
      <InfoBanner style={{ marginTop: 10 }}>Posizionamento X/Y, dimensioni e font configurabili nella versione con backend.</InfoBanner>
    </>
  );
}

// ============================================================
// SETTINGS PAGE
// ============================================================
export function SettingsPage({ nav }: { nav: (p: NavPage) => void }) {
  const { settings, setSettings } = useApp();
  const [s, setS] = useState(settings);
  const save = () => setSettings(s);

  const apiFields = [
    { key: 'azApi' as const, label: 'Amazon PA-API Key', ico: '🟡', name: 'Amazon' },
    { key: 'aliApi' as const, label: 'AliExpress API Key', ico: '🔴', name: 'AliExpress' },
    { key: 'trackAz' as const, label: 'Amazon Tracking ID', ico: '🟡', name: 'Amazon Tracking' },
    { key: 'trackAli' as const, label: 'AliExpress Tracking', ico: '🔴', name: 'AliExpress Tracking' },
  ];

  return (
    <div className="pg">
      <PageHeader title="Impostazioni" onBack={() => nav('dash')} />

      <div className="stit">INTEGRAZIONI API</div>
      {apiFields.map(f => (
        <div key={f.key} className="api-card">
          <div className="api-top">
            <div className="api-ico" style={{ background: 'var(--bg3)' }}>{f.ico}</div>
            <div className="api-name">{f.name}</div>
            <div className={`api-st ${s[f.key] ? 'api-ok' : 'api-no'}`}>{s[f.key] ? '✓ Attivo' : 'Non configurato'}</div>
          </div>
          <input className="inp" type="password" value={s[f.key]}
            onChange={e => setS({ ...s, [f.key]: e.target.value })} placeholder={f.label} />
        </div>
      ))}

      <div className="stit">CANALI TELEGRAM</div>
      <div className="card">
        {s.channels.map((ch, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: i < s.channels.length - 1 ? 8 : 0 }}>
            <input className="inp" value={ch}
              onChange={e => setS({ ...s, channels: s.channels.map((c, j) => j === i ? e.target.value : c) })} />
            <button className="btn bre bic" onClick={() => setS({ ...s, channels: s.channels.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        <button className="btn bp bsm" style={{ marginTop: 8, width: '100%' }}
          onClick={() => setS({ ...s, channels: [...s.channels, ''] })}>
          + Aggiungi canale
        </button>
      </div>

      <div className="stit">AUTOPOST</div>
      <ToggleRow label="AutoPost attivo" sub="Pubblicazione automatica programmata"
        value={s.attivo} onChange={v => setS({ ...s, attivo: v })} />

      <div style={{ height: 12 }} />
      <div className="fld">
        <label className="lbl">Ora inizio</label>
        <input type="time" className="inp" value={s.oraI} onChange={e => setS({ ...s, oraI: e.target.value })} />
      </div>
      <div className="fld">
        <label className="lbl">Ora fine</label>
        <input type="time" className="inp" value={s.oraF} onChange={e => setS({ ...s, oraF: e.target.value })} />
      </div>
      <div className="fld">
        <label className="lbl">Intervallo (minuti)</label>
        <input type="number" className="inp" value={s.interv} min={15} max={1440}
          onChange={e => setS({ ...s, interv: parseInt(e.target.value) || 60 })} />
      </div>

      <div className="fld">
        <button className="btn bp bfull" onClick={save}>✅ Salva impostazioni</button>
      </div>
    </div>
  );
}
