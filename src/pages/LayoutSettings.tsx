import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { NavPage, TextLayout, LayoutType, Tag } from '../types';
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
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editValue, setEditValue] = useState('');

  const formatName = (n: string) => n.trim().startsWith('{') ? n.trim() : `{${n.trim()}}`;

  const addTag = () => {
    if (!newName.trim()) return;
    setTags(t => [...t, { id: genId(), name: formatName(newName), value: newValue.trim() }]);
    setNewName('');
    setNewValue('');
  };

  const startEdit = (tag: Tag) => {
    setEditId(tag.id);
    setEditName(tag.name);
    setEditValue(tag.value);
  };

  const saveEdit = () => {
    if (!editId) return;
    setTags(ts => ts.map(t => t.id === editId ? { ...t, name: formatName(editName), value: editValue } : t));
    setEditId(null);
  };

  return (
    <>
      <div className="stit">TAG DISPONIBILI</div>
      {tags.map(t => (
        <div key={t.id} className="card" style={{ margin: '0 16px 8px', padding: '10px 12px' }}>
          {editId === t.id ? (
            <>
              <input className="inp" value={editName} onChange={e => setEditName(e.target.value)}
                placeholder="{nome_tag}" style={{ marginBottom: 7 }} />
              <div className="irow">
                <input className="inp" value={editValue} onChange={e => setEditValue(e.target.value)}
                  placeholder="Valore / descrizione"
                  onKeyDown={e => e.key === 'Enter' && saveEdit()} />
                <button className="btn bp bsm" onClick={saveEdit} style={{ flexShrink: 0 }}>✓ Salva</button>
                <button className="btn bs bsm" onClick={() => setEditId(null)} style={{ flexShrink: 0 }}>×</button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="tag-pill" style={{ flexShrink: 0 }}>{t.name}</span>
              <span style={{ fontSize: 12, color: 'var(--t2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.value || <span style={{ color: 'var(--t3)', fontStyle: 'italic' }}>nessun valore</span>}
              </span>
              <button className="btn bgh bsm" style={{ padding: '3px 8px', flexShrink: 0 }} onClick={() => startEdit(t)}>✏️</button>
              <button className="btn bgh bsm" style={{ color: 'var(--re)', padding: '3px 8px', flexShrink: 0 }}
                onClick={() => setTags(ts => ts.filter(x => x.id !== t.id))}>×</button>
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
            placeholder="Valore / descrizione del tag"
            onKeyDown={e => e.key === 'Enter' && addTag()} />
          <button className="btn bp" onClick={addTag} style={{ padding: '0 16px', flexShrink: 0 }}>+ Aggiungi</button>
        </div>
      </div>
      <InfoBanner>Il <b>nome</b> è il placeholder usato nei layout (es. {'{titolo}'}). Il <b>valore</b> viene sostituito durante la pubblicazione.</InfoBanner>
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
  const { telElems, setTelElems, templateSettings, setTemplateSettings } = useApp();
  const [overlayName, setOverlayName] = useState(templateSettings.overlay ?? '');
  const [logoName, setLogoName] = useState(templateSettings.logo ?? '');

  const toggleVis = (id: string) => setTelElems(els => els.map(e => e.id === id ? { ...e, vis: !e.vis } : e));

  const handleOverlay = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.files?.[0]?.name ?? '';
    setOverlayName(name);
    setTemplateSettings(ts => ({ ...ts, overlay: name || null }));
  };

  const handleLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.files?.[0]?.name ?? '';
    setLogoName(name);
    setTemplateSettings(ts => ({ ...ts, logo: name || null }));
  };

  return (
    <>
      <div className="stit">CANVAS IMMAGINE</div>
      <div className="canvas-wrap" style={{ margin: '0 16px 12px' }}>
        <div className="mock-canvas">
          <div style={{ textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🖼️</div>
            Canvas 1:1
            {templateSettings.overlay && (
              <div style={{ fontSize: 11, color: 'var(--a3)', marginTop: 4 }}>Overlay: {templateSettings.overlay}</div>
            )}
            {templateSettings.logo && (
              <div style={{ fontSize: 11, color: 'var(--gr2)', marginTop: 2 }}>Logo: {templateSettings.logo}</div>
            )}
            {!templateSettings.overlay && !templateSettings.logo && (
              <div style={{ fontSize: 11, marginTop: 4 }}>Immagine prodotto + overlay PNG</div>
            )}
          </div>
        </div>
      </div>

      <div className="stit">UPLOAD RISORSE</div>
      <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label className="btn bs" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', justifyContent: 'center' }}>
          📁 {overlayName ? `Overlay: ${overlayName}` : 'Carica overlay PNG'}
          <input type="file" accept="image/png" style={{ display: 'none' }} onChange={handleOverlay} />
        </label>
        <label className="btn bs" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', justifyContent: 'center' }}>
          ✦ {logoName ? `Logo: ${logoName}` : 'Carica logo'}
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogo} />
        </label>
      </div>

      <ToggleRow
        label="Badge Minimo Storico"
        sub="Mostra il badge nel template immagine"
        value={templateSettings.badgeEnabled}
        onChange={v => setTemplateSettings(ts => ({ ...ts, badgeEnabled: v }))}
      />

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
      <InfoBanner>Posizionamento X/Y, dimensioni e font configurabili nella versione con backend.</InfoBanner>
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
  const save = () => setSettings(s);

  const setAmazon = (field: keyof typeof s.amazon, value: string | boolean) =>
    setS(prev => ({ ...prev, amazon: { ...prev.amazon, [field]: value } }));

  const setAli = (field: keyof typeof s.aliexpress, value: string | boolean) =>
    setS(prev => ({ ...prev, aliexpress: { ...prev.aliexpress, [field]: value } }));

  return (
    <div className="pg">
      <PageHeader title="Impostazioni" onBack={() => nav('dash')} />

      {/* ── Amazon ── */}
      <div className="stit">AMAZON SETTINGS</div>
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
          <label className="lbl">Affiliate Tag (Tracking ID)</label>
          <input className="inp" value={s.amazon.affiliateTag}
            onChange={e => setAmazon('affiliateTag', e.target.value)}
            placeholder="miosite-21" />
        </div>
        <div className="fld">
          <label className="lbl">Marketplace</label>
          <select className="sel" value={s.amazon.marketplace}
            onChange={e => setAmazon('marketplace', e.target.value)}>
            {MARKETPLACES.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="fld">
          <label className="lbl" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Access Key
            <span style={{ fontSize: 10, background: '#2a1800', color: '#f59e0b', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>SOLO BACKEND</span>
          </label>
          <input className="inp" type="password" value={s.amazon.accessKey}
            onChange={e => setAmazon('accessKey', e.target.value)}
            placeholder="AKIAIOSFODNN7EXAMPLE" />
        </div>
        <div className="fld">
          <label className="lbl" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Secret Key
            <span style={{ fontSize: 10, background: '#2a1800', color: '#f59e0b', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>SOLO BACKEND</span>
          </label>
          <input className="inp" type="password" value={s.amazon.secretKey}
            onChange={e => setAmazon('secretKey', e.target.value)}
            placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCY..." />
        </div>
        <InfoBanner>🔒 Access Key e Secret Key non vengono mai utilizzate nel frontend. Sono preparate per la chiamata al tuo backend.</InfoBanner>
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
          <input className="inp" value={s.aliexpress.affiliateId}
            onChange={e => setAli('affiliateId', e.target.value)}
            placeholder="12345678" />
        </div>
        <div className="fld">
          <label className="lbl">Tracking ID</label>
          <input className="inp" value={s.aliexpress.trackingId}
            onChange={e => setAli('trackingId', e.target.value)}
            placeholder="affiliate_tracking_id" />
        </div>
      </div>

      {/* ── Canali Telegram ── */}
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

      {/* ── AutoPost ── */}
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
