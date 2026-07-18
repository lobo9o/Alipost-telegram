import React, { useState, useEffect, useRef, Component, useLayoutEffect } from 'react';
import { NavPage } from '../types';
import { useApp } from '../context/AppContext';
import { PageHeader, EmptyState, ErrorBanner } from '../components/Shared';
import { customPostsApi, CustomPost, CustomPostSchedule, emojiIdsApi, EmojiEntry } from '../lib/api';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

const KB_COLOR_MAP: Record<string, string> = { g: 'success', r: 'danger', b: 'primary' };
const KB_COLOR_STYLES: Record<string, { bg: string; color: string }> = {
  success: { bg: 'rgba(16,185,129,0.18)', color: '#34d399' },
  danger:  { bg: 'rgba(239,68,68,0.18)',  color: '#f87171' },
  primary: { bg: 'rgba(6,182,212,0.18)',  color: '#22d3ee' },
};

function parseKbRows(keyboard: string) {
  return (keyboard || '').split('\n').filter(l => l.trim()).map(row =>
    row.split('&&').map(b => b.trim()).filter(Boolean).map(btn => {
      const cm = btn.match(/^#([grb])\s+/);
      const style = cm ? KB_COLOR_MAP[cm[1]] : undefined;
      const clean = cm ? btn.slice(cm[0].length) : btn;
      const m = clean.match(/^(.*?)\s+-\s+https?:\/\/.+$/) ?? clean.match(/^(.*?)\s+-\s+.+$/);
      return { text: (m ? m[1] : clean.split(' - ')[0] ?? clean).trim(), style };
    })
  ).filter(r => r.length);
}

function safeSchedules(schedules: any): CustomPostSchedule[] {
  if (!Array.isArray(schedules)) return [];
  return schedules.map(s => ({
    id: s.id ?? crypto.randomUUID(),
    days: Array.isArray(s.days) ? s.days : [],
    time: s.time ?? '09:00',
    channel: s.channel ?? '',
    active: s.active !== false,
    lastSentDate: s.lastSentDate,
  }));
}

// Normalizza l'HTML estratto da contentEditable al formato Telegram (<br> per a capo)
function normalizeBody(html: string): string {
  let v = html;
  v = v.replace(/<div><br\s*\/?><\/div>/gi, '<br>');
  v = v.replace(/<\/div>\s*<div>/gi, '<br>');
  v = v.replace(/<div>/gi, '');
  v = v.replace(/<\/div>/gi, '<br>');
  v = v.replace(/(<br\s*\/?>){3,}/gi, '<br><br>');
  return v.trim();
}

function newSchedule(channel: string): CustomPostSchedule {
  return { id: crypto.randomUUID(), days: [], time: '09:00', channel, active: true };
}

function emptyForm(): Omit<CustomPost, 'id' | 'created_at' | 'updated_at'> {
  return { title: '', image: '', body: '', keyboard: '', schedules: [] };
}

// ── Error Boundary ────────────────────────────────────────────
class PageErrorBoundary extends Component<{ children: React.ReactNode; onReset: () => void }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: Error) { return { error: err.message }; }
  componentDidCatch(err: Error) { console.error('[CustomPostsPage]', err); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: 'var(--re)' }}>
          <div style={{ marginBottom: 8, fontWeight: 700 }}>Errore nella pagina</div>
          <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 16 }}>{this.state.error}</div>
          <button className="btn bp" onClick={() => { this.setState({ error: null }); this.props.onReset(); }}>Ricarica</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Body Editor (contenteditable — mostra emoji animate direttamente) ─────────
function BodyEditor({ value, onChange, emojiList }: {
  value: string;
  onChange: (v: string) => void;
  emojiList: EmojiEntry[];
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInit = useRef(false);
  const [focused, setFocused] = useState(false);

  // Inizializza una volta sola
  useLayoutEffect(() => {
    if (!isInit.current && editorRef.current) {
      editorRef.current.innerHTML = value || '';
      isInit.current = true;
    }
  });

  // Risincronizza se il valore cambia dall'esterno (es. caricamento post esistente)
  // ma solo se l'editor non è focalizzato (per non spostare il cursore)
  useEffect(() => {
    const el = editorRef.current;
    if (el && !el.contains(document.activeElement) && el.innerHTML !== value) {
      el.innerHTML = value || '';
    }
  }, [value]);

  const readHtml = () => normalizeBody(editorRef.current?.innerHTML ?? '');

  const handleInput = () => onChange(readHtml());

  // Intercetta Enter → inserisce <br> (non <div>) per compatibilità Telegram
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.execCommand('insertLineBreak');
      handleInput();
    }
  };

  // Incolla come testo semplice (evita HTML estranei)
  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    handleInput();
  };

  // Inserisce <tg-emoji> al cursore senza perdere il focus sull'editor
  const insertEmoji = (char: string, id: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    const tgEl = document.createElement('tg-emoji');
    tgEl.setAttribute('emoji-id', id);
    tgEl.textContent = char;
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(tgEl);
      const newRange = document.createRange();
      newRange.setStartAfter(tgEl);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    } else {
      el.appendChild(tgEl);
    }
    onChange(readHtml());
  };

  const isVisuallyEmpty = !value || value.replace(/<br\s*\/?>/gi, '').replace(/<[^>]*>/g, '').trim() === '';

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ position: 'relative' }}>
        {isVisuallyEmpty && !focused && (
          <div style={{ position: 'absolute', top: 10, left: 12, pointerEvents: 'none', color: 'var(--t3)', fontSize: 12, lineHeight: 1.6 }}>
            Scrivi il testo del post...<br />
            <span style={{ opacity: 0.7 }}>Puoi usare &lt;b&gt;grassetto&lt;/b&gt;, &lt;i&gt;corsivo&lt;/i&gt;</span>
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          suppressContentEditableWarning
          style={{
            minHeight: 130, background: 'var(--bg3)', borderRadius: 8, padding: '10px 12px',
            fontSize: 14, lineHeight: 1.7, color: 'var(--t1)', wordBreak: 'break-word',
            outline: 'none', marginBottom: 8,
            border: `1px solid ${focused ? 'var(--a1)' : 'var(--bd)'}`,
            transition: 'border-color .15s',
          }}
        />
      </div>

      {emojiList.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <span className="lbl">✨ Emoji animate — clicca per inserire</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingTop: 4 }}>
            {emojiList.map(e => (
              <button
                key={e.custom_emoji_id}
                onMouseDown={ev => ev.preventDefault()} // non perdere il focus sull'editor
                onClick={() => insertEmoji(e.emoji_char, e.custom_emoji_id)}
                style={{
                  width: 40, height: 40, borderRadius: 8, cursor: 'pointer',
                  background: 'var(--bg4)', border: '1px solid var(--bd)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {/* tg-emoji nel picker → Telegram Mini App lo anima */}
                <span
                  style={{ fontSize: 24, lineHeight: 1 }}
                  dangerouslySetInnerHTML={{ __html: `<tg-emoji emoji-id="${e.custom_emoji_id}">${e.emoji_char}</tg-emoji>` }}
                />
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
            Le emoji animate appaiono animate nel post pubblicato e nella preview qui sopra
          </div>
        </div>
      )}
    </div>
  );
}

// ── Animated body (usa ref per far processare <tg-emoji> a Telegram Mini App) ─
function AnimatedBody({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = (html || '<i style="color:var(--t3)">Nessun testo</i>').replace(/\n/g, '<br>');
    }
  }, [html]);
  return <div ref={ref} className="pvmsg" />;
}

// ── Preview ───────────────────────────────────────────────────
function PostPreview({ image, body, keyboard }: { image: string; body: string; keyboard: string }) {
  const kbRows = parseKbRows(keyboard);
  return (
    <div className="pvbox" style={{ margin: '0 16px 12px' }}>
      <span className="pvbdg">PREVIEW TELEGRAM</span>
      {image ? (
        <div style={{ width: '100%', marginBottom: 10, borderRadius: 8, overflow: 'hidden', background: 'var(--bg4)', maxHeight: 200 }}>
          <img src={image} alt="" style={{ width: '100%', objectFit: 'cover', display: 'block' }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        </div>
      ) : (
        <div style={{ width: '100%', height: 70, borderRadius: 8, background: 'var(--bg4)', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)', fontSize: 12 }}>
          Nessuna immagine
        </div>
      )}
      <AnimatedBody html={body} />
      {kbRows.map((row, ri) => (
        <div key={ri} style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          {row.map((b, bi) => {
            const cs = b.style ? KB_COLOR_STYLES[b.style] : null;
            return (
              <div key={bi} className="tgbtn" style={{ flex: 1, textAlign: 'center', ...(cs ? { background: cs.bg, color: cs.color } : {}) }}>
                {b.text}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Schedule Item ─────────────────────────────────────────────
function ScheduleItem({ sched, channels, onChange, onDelete }: {
  sched: CustomPostSchedule; channels: string[];
  onChange: (s: CustomPostSchedule) => void; onDelete: () => void;
}) {
  const days = Array.isArray(sched.days) ? sched.days : [];
  return (
    <div className="card" style={{ margin: '0 0 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Programmazione</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className={`tgl ${sched.active ? 'on' : ''}`} onClick={() => onChange({ ...sched, active: !sched.active })}>
            <div className="tgl-k" />
          </div>
          <button className="btn bre" style={{ padding: '4px 10px', fontSize: 13 }} onClick={onDelete}>✕</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
        {DAYS.map((d, i) => {
          const sel = days.includes(i);
          return (
            <button key={i} style={{
              padding: '5px 10px', fontSize: 12, fontWeight: 700, borderRadius: 20, cursor: 'pointer',
              background: sel ? 'var(--a1)' : 'var(--bg4)', color: sel ? '#fff' : 'var(--t2)',
              border: sel ? '1px solid var(--a1)' : '1px solid var(--bd)',
            }} onClick={() => {
              const next = sel ? days.filter(x => x !== i) : [...days, i].sort((a, b) => a - b);
              onChange({ ...sched, days: next });
            }}>{d}</button>
          );
        })}
      </div>
      <div className="irow">
        <div style={{ flex: '0 0 110px' }}>
          <span className="lbl">Orario</span>
          <input type="time" className="inp" value={sched.time || '09:00'} onChange={e => onChange({ ...sched, time: e.target.value })} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="lbl">Canale</span>
          <select className="sel" value={sched.channel || ''} onChange={e => onChange({ ...sched, channel: e.target.value })}>
            <option value="">Seleziona...</option>
            {channels.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      {sched.lastSentDate && (
        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 8 }}>Ultimo invio: {sched.lastSentDate}</div>
      )}
    </div>
  );
}

// ── Editor ────────────────────────────────────────────────────
function PostEditor({ initial, channels, emojiList, onSave, onBack }: {
  initial: CustomPost | null; channels: string[]; emojiList: EmojiEntry[];
  onSave: (post: CustomPost) => void; onBack: () => void;
}) {
  const [form, setForm] = useState<Omit<CustomPost, 'id' | 'created_at' | 'updated_at'>>(
    initial
      ? { title: initial.title || '', image: initial.image || '', body: initial.body || '', keyboard: initial.keyboard || '', schedules: safeSchedules(initial.schedules) }
      : emptyForm()
  );
  const [tab, setTab] = useState<'edit' | 'preview' | 'schedule'>('edit');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof typeof form, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => set('image', ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setSaving(true); setErr('');
    try {
      const payload = { ...form, body: normalizeBody(form.body), schedules: safeSchedules(form.schedules) };
      const saved = initial
        ? await customPostsApi.update(initial.id, payload)
        : await customPostsApi.create(payload);
      if (!saved || typeof saved !== 'object') throw new Error('Risposta server non valida');
      onSave({ ...saved, schedules: safeSchedules(saved.schedules) });
    } catch (e: any) {
      setErr(e.message || 'Errore salvataggio');
    } finally {
      setSaving(false);
    }
  };

  const TABS = [
    { id: 'edit' as const, label: '✏️ Testo' },
    { id: 'preview' as const, label: '👁 Preview' },
    { id: 'schedule' as const, label: `📅 Orari${form.schedules.length ? ` (${form.schedules.length})` : ''}` },
  ];

  return (
    <div className="pg">
      <PageHeader
        title={initial ? 'Modifica Post' : 'Nuovo Post'}
        onBack={onBack}
        right={
          <button className="btn bp" style={{ padding: '7px 14px', fontSize: 13 }} onClick={handleSave} disabled={saving}>
            {saving ? '...' : 'Salva'}
          </button>
        }
      />
      <div style={{ display: 'flex', margin: '0 16px 14px', background: 'var(--bg3)', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--bd)' }}>
        {TABS.map(t => (
          <button key={t.id} style={{
            flex: 1, padding: '9px 4px', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
            background: tab === t.id ? 'var(--a1)' : 'transparent',
            color: tab === t.id ? '#fff' : 'var(--t2)',
          }} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {err && <ErrorBanner>{err}</ErrorBanner>}

      {tab === 'edit' && (
        <div style={{ padding: '0 16px' }}>
          <span className="lbl">Titolo (interno)</span>
          <input className="inp" style={{ marginBottom: 12 }} placeholder="Es. Promo Prime Day"
            value={form.title} onChange={e => set('title', e.target.value)} />

          <span className="lbl">Immagine</span>
          <div className="irow" style={{ marginBottom: 8 }}>
            <input className="inp" placeholder="https://..." value={form.image.startsWith('data:') ? '' : form.image}
              onChange={e => set('image', e.target.value)} style={{ flex: 1 }} />
            <button className="btn bs" style={{ padding: '0 14px', flexShrink: 0 }} onClick={() => fileRef.current?.click()}>📷</button>
          </div>
          {form.image && (
            <div style={{ position: 'relative', marginBottom: 12, borderRadius: 8, overflow: 'hidden', maxHeight: 150, background: 'var(--bg4)' }}>
              <img src={form.image} alt="" style={{ width: '100%', objectFit: 'cover', display: 'block' }}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <button style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none', borderRadius: 20, padding: '3px 9px', fontSize: 13, cursor: 'pointer' }}
                onClick={() => set('image', '')}>✕</button>
            </div>
          )}
          <input type="file" accept="image/*" ref={fileRef} style={{ display: 'none' }} onChange={handleImageFile} />

          <span className="lbl">Testo del post</span>
          <BodyEditor value={form.body} onChange={v => set('body', v)} emojiList={emojiList} />

          <span className="lbl">Tastiera (bottoni)</span>
          <textarea className="txta"
            style={{ height: 80, fontFamily: 'monospace', fontSize: 12, marginBottom: 4 }}
            placeholder={'🛒 Acquista - https://...\n#g 🟢 Verde - https://... && #r 🔴 Rosso - https://...'}
            value={form.keyboard} onChange={e => set('keyboard', e.target.value)} />
          <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 16, lineHeight: 1.6 }}>
            Colori: <code style={{ background: 'var(--bg4)', padding: '1px 3px', borderRadius: 3 }}>#g</code> verde &nbsp;
            <code style={{ background: 'var(--bg4)', padding: '1px 3px', borderRadius: 3 }}>#r</code> rosso &nbsp;
            <code style={{ background: 'var(--bg4)', padding: '1px 3px', borderRadius: 3 }}>#b</code> blu &nbsp;·&nbsp;
            Separa bottoni stessa fila con <code style={{ background: 'var(--bg4)', padding: '1px 3px', borderRadius: 3 }}>&&</code>
          </div>
        </div>
      )}

      {tab === 'preview' && (
        <PostPreview image={form.image} body={form.body} keyboard={form.keyboard} />
      )}

      {tab === 'schedule' && (
        <div style={{ padding: '0 16px' }}>
          {form.schedules.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--t3)', fontSize: 13, padding: '24px 0 16px' }}>
              Nessuna programmazione.<br />Aggiungi un orario per inviare automaticamente.
            </div>
          )}
          {form.schedules.map((s, i) => (
            <ScheduleItem key={s.id || i} sched={s} channels={channels}
              onChange={updated => set('schedules', form.schedules.map((x, xi) => xi === i ? updated : x))}
              onDelete={() => set('schedules', form.schedules.filter((_, xi) => xi !== i))} />
          ))}
          <button className="btn bs" style={{ width: '100%' }}
            onClick={() => set('schedules', [...form.schedules, newSchedule(channels[0] ?? '')])}>
            + Aggiungi programmazione
          </button>
        </div>
      )}
    </div>
  );
}

// ── Post Card ─────────────────────────────────────────────────
function PostCard({ post, channels, onEdit, onDelete, onPublish }: {
  post: CustomPost; channels: string[];
  onEdit: () => void; onDelete: () => void;
  onPublish: (channel: string) => Promise<void>;
}) {
  const [publishChannel, setPublishChannel] = useState(channels[0] ?? '');
  const [publishing, setPublishing] = useState(false);
  const schedules = safeSchedules(post.schedules);
  const activeSchedules = schedules.filter(s => s.active);

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ width: 52, height: 52, borderRadius: 8, background: 'var(--bg4)', flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
          {post.image
            ? <img src={post.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            : '📢'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
            {post.title || <em style={{ color: 'var(--t3)', fontWeight: 400 }}>Senza titolo</em>}
          </div>
          {post.body && (
            <div style={{ fontSize: 12, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {String(post.body).replace(/<[^>]+>/g, '')}
            </div>
          )}
        </div>
      </div>

      {activeSchedules.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
          {activeSchedules.map((s, i) => (
            <span key={s.id || i} style={{ fontSize: 10, background: 'rgba(6,182,212,0.12)', color: 'var(--a1)', border: '1px solid rgba(6,182,212,0.22)', borderRadius: 20, padding: '2px 8px', fontWeight: 600 }}>
              {(Array.isArray(s.days) ? s.days : []).map(d => DAYS[d]).join(' ')} {s.time}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button className="btn bs" style={{ flex: 1, padding: '8px 0', fontSize: 12 }} onClick={onEdit}>✏️ Modifica</button>
        <button className="btn bre" style={{ padding: '8px 12px', fontSize: 13 }} onClick={onDelete}>🗑</button>
      </div>
      <div className="irow">
        <select className="sel" style={{ flex: 1, fontSize: 12 }} value={publishChannel} onChange={e => setPublishChannel(e.target.value)}>
          {channels.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="btn bgr" style={{ padding: '0 14px', flexShrink: 0, fontSize: 12 }}
          onClick={async () => { setPublishing(true); await onPublish(publishChannel); setPublishing(false); }}
          disabled={publishing || !publishChannel}>
          {publishing ? '...' : '▶ Invia ora'}
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
function CustomPostsInner({ nav }: { nav: (p: NavPage) => void }) {
  const { allChannels, settings } = useApp();
  const channels = allChannels.length ? allChannels : (settings.channels ?? []);

  const [posts, setPosts] = useState<CustomPost[]>([]);
  const [emojiList, setEmojiList] = useState<EmojiEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CustomPost | null | 'new'>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    Promise.all([
      customPostsApi.list(),
      emojiIdsApi.list().catch(() => ({ emoji: [] })),
    ]).then(([data, emojiData]) => {
      const list = Array.isArray(data) ? data : [];
      setPosts(list.map(p => ({ ...p, schedules: safeSchedules(p.schedules) })));
      setEmojiList(emojiData.emoji ?? []);
    }).catch(e => setErr(e.message || 'Errore caricamento'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = (saved: CustomPost) => {
    const safe = { ...saved, schedules: safeSchedules(saved.schedules) };
    setPosts(prev => {
      const idx = prev.findIndex(p => p.id === safe.id);
      return idx >= 0 ? prev.map(p => p.id === safe.id ? safe : p) : [safe, ...prev];
    });
    setEditing(null);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Eliminare questo post promo?')) return;
    await customPostsApi.delete(id).catch(() => {});
    setPosts(prev => prev.filter(p => p.id !== id));
  };

  const handlePublish = async (post: CustomPost, channel: string): Promise<void> => {
    try {
      const result = await customPostsApi.publishNow(post.id, channel);
      if (!result.ok) throw new Error(result.error || 'Errore invio');
      alert('✅ Post inviato!');
    } catch (e: any) {
      alert('❌ Errore: ' + (e.message || 'sconosciuto'));
    }
  };

  if (editing !== null) {
    return (
      <PostEditor
        initial={editing === 'new' ? null : editing}
        channels={channels}
        emojiList={emojiList}
        onSave={handleSave}
        onBack={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="pg">
      <PageHeader title="Post Promo" onBack={() => nav('dash')} badge={posts.length || undefined}
        right={<button className="btn bp" style={{ padding: '7px 14px', fontSize: 13 }} onClick={() => setEditing('new')}>+ Nuovo</button>}
      />

      {err && <ErrorBanner>{err}</ErrorBanner>}
      {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--t3)' }}>Caricamento...</div>}

      {!loading && posts.length === 0 && !err && (
        <EmptyState icon="📢" text="Nessun post promo salvato"
          action={<button className="btn bp" onClick={() => setEditing('new')}>+ Crea il primo post</button>} />
      )}

      {posts.map(post => (
        <PostCard key={post.id} post={post} channels={channels}
          onEdit={() => setEditing(post)}
          onDelete={() => handleDelete(post.id)}
          onPublish={channel => handlePublish(post, channel)} />
      ))}
    </div>
  );
}

export function CustomPostsPage({ nav }: { nav: (p: NavPage) => void }) {
  const [key, setKey] = useState(0);
  return (
    <PageErrorBoundary onReset={() => setKey(k => k + 1)}>
      <CustomPostsInner key={key} nav={nav} />
    </PageErrorBoundary>
  );
}
