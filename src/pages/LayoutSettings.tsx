import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { NavPage, TextLayout, LayoutType, Tag, Template, TemplateType } from '../types';
import { PageHeader, SwitchTabs, InfoBanner, ToggleRow } from '../components/Shared';
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
const TPL_TYPE_LABEL: Record<TemplateType, string> = {
  normal: 'Normale',
  historical_low: 'Min. Storico',
};

function TemplatePreviewer({ tpl }: { tpl: Template }) {
  return (
    <div className="tpl-preview">
      {/* Product placeholder */}
      <div className="tpl-product">
        <span style={{ fontSize: 64, opacity: tpl.overlay ? 0.15 : 0.35 }}>📦</span>
      </div>

      {/* Overlay PNG */}
      {tpl.overlay && (
        <img src={tpl.overlay} alt="" className="tpl-overlay" />
      )}

      {/* Logo */}
      {tpl.logo && (
        <img src={tpl.logo} alt="" className="tpl-logo" />
      )}

      {/* Historical Low Badge */}
      {tpl.badgeEnabled && (
        <div className="tpl-badge">🏆 MIN. STORICO</div>
      )}

      {/* Platform label placeholder (top-left if no logo) */}
      {!tpl.logo && (
        <div className="tpl-platform" style={{ background: 'rgba(0,0,0,0.6)', color: 'var(--am2)' }}>
          🟡 Amazon
        </div>
      )}

      {/* Price bar */}
      <div className="tpl-price-bar">
        <div className="tpl-price-row">
          <span className="tpl-price-new">€00.00</span>
          <span className="tpl-price-old">€00.00</span>
          <span className="tpl-price-disc">-0%</span>
        </div>
      </div>

      {/* Empty state hint */}
      {!tpl.overlay && !tpl.logo && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', color: 'var(--t3)', fontSize: 11, pointerEvents: 'none', marginTop: -10 }}>
          Carica overlay o logo
        </div>
      )}
    </div>
  );
}

function TemplateSection() {
  const { templates, setTemplates } = useApp();
  const [editId, setEditId] = useState<string | null>(null);

  const updateTpl = (id: string, changes: Partial<Template>) => {
    setTemplates(ts => ts.map(t => t.id === id ? { ...t, ...changes } : t));
    templatesApi.update(id, changes).catch(() => {});
  };

  const handleOverlay = (tplId: string, file: File | null) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    updateTpl(tplId, { overlay: url });
  };

  const handleLogo = (tplId: string, file: File | null) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    updateTpl(tplId, { logo: url });
  };

  const addTemplate = () => {
    const tpl: Template = { id: genId(), nome: 'Nuovo Template', tipo: 'normal', overlay: null, logo: null, badgeEnabled: false };
    setTemplates(ts => [...ts, tpl]);
    templatesApi.create(tpl).catch(() => {});
  };

  return (
    <>
      <div style={{ padding: '10px 16px 0', display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn bp bsm" onClick={addTemplate}>+ Nuovo template</button>
      </div>

      {templates.map(tpl => (
        <div key={tpl.id} className="tpl-card">
          <div className="tpl-card-header">
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: tpl.tipo === 'historical_low' ? '#2a1800' : '#1a1a40', color: tpl.tipo === 'historical_low' ? 'var(--am)' : 'var(--a3)' }}>
              {TPL_TYPE_LABEL[tpl.tipo]}
            </span>
            {editId === tpl.id ? (
              <input className="inp" value={tpl.nome} onChange={e => updateTpl(tpl.id, { nome: e.target.value })}
                style={{ flex: 1, fontSize: 13, padding: '6px 10px' }} />
            ) : (
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{tpl.nome}</span>
            )}
            <button className="btn bgh bsm" onClick={() => setEditId(editId === tpl.id ? null : tpl.id)}>
              {editId === tpl.id ? '✓' : '✏️'}
            </button>
            <button className="btn bgh bsm" style={{ color: 'var(--re)' }}
              onClick={() => { setTemplates(ts => ts.filter(t => t.id !== tpl.id)); templatesApi.delete(tpl.id).catch(() => {}); }}>×</button>
          </div>

          {editId === tpl.id && (
            <div className="tpl-card-body">
              {/* Preview */}
              <TemplatePreviewer tpl={tpl} />

              {/* Tipo */}
              <div className="fld" style={{ paddingLeft: 0, paddingRight: 0 }}>
                <label className="lbl">Tipo template</label>
                <select className="sel" value={tpl.tipo} onChange={e => updateTpl(tpl.id, { tipo: e.target.value as TemplateType })}>
                  <option value="normal">Normale</option>
                  <option value="historical_low">Minimo Storico</option>
                </select>
              </div>

              {/* Upload overlay */}
              <div style={{ marginBottom: 8 }}>
                <div className="lbl">OVERLAY PNG</div>
                <label className="btn bs" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', justifyContent: 'center' }}>
                  📁 {tpl.overlay ? '✓ Overlay caricato' : 'Carica overlay PNG'}
                  <input type="file" accept="image/png,image/webp" style={{ display: 'none' }}
                    onChange={e => handleOverlay(tpl.id, e.target.files?.[0] ?? null)} />
                </label>
                {tpl.overlay && (
                  <button className="btn bgh bsm" style={{ color: 'var(--re)', marginTop: 5 }}
                    onClick={() => updateTpl(tpl.id, { overlay: null })}>× Rimuovi overlay</button>
                )}
              </div>

              {/* Upload logo */}
              <div style={{ marginBottom: 8 }}>
                <div className="lbl">LOGO</div>
                <label className="btn bs" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', justifyContent: 'center' }}>
                  ✦ {tpl.logo ? '✓ Logo caricato' : 'Carica logo'}
                  <input type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={e => handleLogo(tpl.id, e.target.files?.[0] ?? null)} />
                </label>
                {tpl.logo && (
                  <button className="btn bgh bsm" style={{ color: 'var(--re)', marginTop: 5 }}
                    onClick={() => updateTpl(tpl.id, { logo: null })}>× Rimuovi logo</button>
                )}
              </div>

              {/* Badge toggle */}
              <div style={{ background: 'var(--bg3)', borderRadius: 8, overflow: 'hidden' }}>
                <ToggleRow
                  label="Badge Minimo Storico"
                  sub="Mostra il badge nel template"
                  value={tpl.badgeEnabled}
                  onChange={v => updateTpl(tpl.id, { badgeEnabled: v })}
                />
              </div>
            </div>
          )}
        </div>
      ))}
      <InfoBanner>Clicca ✏️ per espandere e modificare ogni template. La preview si aggiorna in tempo reale.</InfoBanner>
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

  React.useEffect(() => { setS(settings); }, [settings]);

  const save = async () => {
    try {
      await settingsApi.save(s);
      setSettings(s);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // errore silenzioso — il backend logga
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
        </div>
        <div className="fld">
          <label className="lbl" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Credential Secret
            <span style={{ fontSize: 10, background: '#2a1800', color: '#f59e0b', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>SOLO BACKEND</span>
          </label>
          <input className="inp" type="password" value={s.amazon.credentialSecret} onChange={e => setAmazon('credentialSecret', e.target.value)} placeholder="amzn1.oa2-cs.v1...." />
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
        {s.channels.map((ch, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--t3)', minWidth: 20 }}>{i + 1}.</div>
            <input className="inp" value={ch}
              placeholder="@username oppure -1001234567890"
              onChange={e => setS({ ...s, channels: s.channels.map((c, j) => j === i ? e.target.value : c) })} />
            <button className="btn bre bic" onClick={() => setS({ ...s, channels: s.channels.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        <button className="btn bp bsm" style={{ marginTop: 4, width: '100%' }}
          onClick={() => setS({ ...s, channels: [...s.channels, ''] })}>+ Aggiungi canale</button>
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
      </div>
    </div>
  );
}
