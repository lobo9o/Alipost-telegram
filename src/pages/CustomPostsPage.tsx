import React, { useState, useEffect, useRef } from 'react';
import { NavPage } from '../types';
import { useApp } from '../context/AppContext';
import { PageHeader, EmptyState, ErrorBanner } from '../components/Shared';
import { customPostsApi, CustomPost, CustomPostSchedule } from '../lib/api';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

function newSchedule(channel: string): CustomPostSchedule {
  return { id: crypto.randomUUID(), days: [], time: '09:00', channel, active: true };
}

function emptyForm(): Omit<CustomPost, 'id' | 'created_at' | 'updated_at'> {
  return { title: '', image: '', body: '', keyboard: '', schedules: [] };
}

// ── Preview ───────────────────────────────────────────────────
function PostPreview({ image, body, keyboard }: { image: string; body: string; keyboard: string }) {
  const rows = keyboard
    .split('\n')
    .filter(l => l.trim())
    .map(row =>
      row.split('&&')
        .map(b => b.trim())
        .filter(Boolean)
        .map(btn => {
          const m = btn.match(/^(.*?)\s+-\s+https?:\/\/.+$/);
          return m ? m[1].trim() : btn.split(' - ')[0]?.trim() ?? btn;
        })
    )
    .filter(r => r.length);

  return (
    <div className="pvbox" style={{ margin: '0 16px 12px' }}>
      <span className="pvbdg">PREVIEW TELEGRAM</span>
      {image ? (
        <div style={{ width: '100%', marginBottom: 10, borderRadius: 8, overflow: 'hidden', background: 'var(--bg4)', maxHeight: 200 }}>
          <img
            src={image}
            alt=""
            style={{ width: '100%', objectFit: 'cover', display: 'block' }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      ) : (
        <div style={{ width: '100%', height: 80, borderRadius: 8, background: 'var(--bg4)', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)', fontSize: 12 }}>
          Nessuna immagine
        </div>
      )}
      <div
        className="pvmsg"
        dangerouslySetInnerHTML={{ __html: (body || '<i>Nessun testo</i>').replace(/\n/g, '<br>') }}
      />
      {rows.map((row, ri) => (
        <div key={ri} style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          {row.map((b, bi) => (
            <div key={bi} className="tgbtn" style={{ flex: 1, textAlign: 'center' }}>{b}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Schedule Item ─────────────────────────────────────────────
function ScheduleItem({
  sched,
  channels,
  onChange,
  onDelete,
}: {
  sched: CustomPostSchedule;
  channels: string[];
  onChange: (s: CustomPostSchedule) => void;
  onDelete: () => void;
}) {
  return (
    <div className="card" style={{ margin: '0 0 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Programmazione</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div
            className={`tgl ${sched.active ? 'on' : ''}`}
            onClick={() => onChange({ ...sched, active: !sched.active })}
          >
            <div className="tgl-k" />
          </div>
          <button className="btn bre" style={{ padding: '4px 10px', fontSize: 13, lineHeight: 1 }} onClick={onDelete}>✕</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
        {DAYS.map((d, i) => {
          const sel = sched.days.includes(i);
          return (
            <button
              key={i}
              style={{
                padding: '5px 10px', fontSize: 12, fontWeight: 700, borderRadius: 20,
                background: sel ? 'var(--a1)' : 'var(--bg4)',
                color: sel ? '#fff' : 'var(--t2)',
                border: sel ? '1px solid var(--a1)' : '1px solid var(--bd)',
                cursor: 'pointer',
              }}
              onClick={() => {
                const days = sel ? sched.days.filter(x => x !== i) : [...sched.days, i].sort((a, b) => a - b);
                onChange({ ...sched, days });
              }}
            >{d}</button>
          );
        })}
      </div>

      <div className="irow">
        <div style={{ flex: '0 0 110px' }}>
          <span className="lbl">Orario</span>
          <input
            type="time"
            className="inp"
            value={sched.time}
            onChange={e => onChange({ ...sched, time: e.target.value })}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="lbl">Canale</span>
          <select
            className="sel"
            value={sched.channel}
            onChange={e => onChange({ ...sched, channel: e.target.value })}
          >
            <option value="">Seleziona...</option>
            {channels.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {sched.lastSentDate && (
        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 8 }}>
          Ultimo invio: {sched.lastSentDate}
        </div>
      )}
    </div>
  );
}

// ── Editor ────────────────────────────────────────────────────
function PostEditor({
  initial,
  channels,
  onSave,
  onBack,
}: {
  initial: CustomPost | null;
  channels: string[];
  onSave: (post: CustomPost) => void;
  onBack: () => void;
}) {
  const [form, setForm] = useState<Omit<CustomPost, 'id' | 'created_at' | 'updated_at'>>(
    initial
      ? { title: initial.title, image: initial.image, body: initial.body, keyboard: initial.keyboard, schedules: initial.schedules }
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
    setSaving(true);
    setErr('');
    try {
      const saved = initial
        ? await customPostsApi.update(initial.id, form)
        : await customPostsApi.create(form);
      onSave(saved);
    } catch (e: any) {
      setErr(e.message || 'Errore salvataggio');
    } finally {
      setSaving(false);
    }
  };

  const TABS: { id: 'edit' | 'preview' | 'schedule'; label: string }[] = [
    { id: 'edit', label: '✏️ Testo' },
    { id: 'preview', label: '👁 Preview' },
    { id: 'schedule', label: `📅 Orari${form.schedules.length ? ` (${form.schedules.length})` : ''}` },
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

      {/* Tabs */}
      <div style={{ display: 'flex', margin: '0 16px 14px', background: 'var(--bg3)', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--bd)' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            style={{
              flex: 1, padding: '9px 4px', fontSize: 11, fontWeight: 600,
              background: tab === t.id ? 'var(--a1)' : 'transparent',
              color: tab === t.id ? '#fff' : 'var(--t2)',
              border: 'none', cursor: 'pointer',
            }}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {err && <ErrorBanner>{err}</ErrorBanner>}

      {tab === 'edit' && (
        <div style={{ padding: '0 16px' }}>
          <span className="lbl">Titolo (interno, non pubblicato)</span>
          <input
            className="inp"
            style={{ marginBottom: 12 }}
            placeholder="Es. Promo Prime Day"
            value={form.title}
            onChange={e => set('title', e.target.value)}
          />

          <span className="lbl">Immagine</span>
          <div className="irow" style={{ marginBottom: 8 }}>
            <input
              className="inp"
              placeholder="https://..."
              value={form.image.startsWith('data:') ? '' : form.image}
              onChange={e => set('image', e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn bs" style={{ padding: '0 14px', flexShrink: 0 }} onClick={() => fileRef.current?.click()}>
              📷
            </button>
          </div>
          {form.image && (
            <div style={{ position: 'relative', marginBottom: 12, borderRadius: 8, overflow: 'hidden', maxHeight: 150, background: 'var(--bg4)' }}>
              <img
                src={form.image}
                alt=""
                style={{ width: '100%', objectFit: 'cover', display: 'block' }}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <button
                style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none', borderRadius: 20, padding: '3px 9px', fontSize: 13, cursor: 'pointer' }}
                onClick={() => set('image', '')}
              >✕</button>
            </div>
          )}
          <input type="file" accept="image/*" ref={fileRef} style={{ display: 'none' }} onChange={handleImageFile} />

          <span className="lbl">Testo (HTML Telegram)</span>
          <textarea
            className="txta"
            style={{ height: 130, marginBottom: 12, fontFamily: 'monospace', fontSize: 12 }}
            placeholder={'<b>🎉 PROMO PRIME DAY!</b>\n\nDescrizione della promozione...'}
            value={form.body}
            onChange={e => set('body', e.target.value)}
          />

          <span className="lbl">Tastiera (bottoni)</span>
          <textarea
            className="txta"
            style={{ height: 80, fontFamily: 'monospace', fontSize: 12, marginBottom: 6 }}
            placeholder={'🛒 Acquista - https://...\n📦 Offerta 2 - https://... && 📋 Altro - https://...'}
            value={form.keyboard}
            onChange={e => set('keyboard', e.target.value)}
          />
          <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 16, lineHeight: 1.5 }}>
            Una riga = una fila. Separa bottoni nella stessa fila con <code style={{ background: 'var(--bg4)', padding: '1px 4px', borderRadius: 3 }}>&&</code>. Formato: Testo - URL
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
            <ScheduleItem
              key={s.id}
              sched={s}
              channels={channels}
              onChange={updated => set('schedules', form.schedules.map((x, xi) => xi === i ? updated : x))}
              onDelete={() => set('schedules', form.schedules.filter((_, xi) => xi !== i))}
            />
          ))}
          <button
            className="btn bs"
            style={{ width: '100%' }}
            onClick={() => set('schedules', [...form.schedules, newSchedule(channels[0] ?? '')])}
          >
            + Aggiungi programmazione
          </button>
        </div>
      )}
    </div>
  );
}

// ── Post Card ─────────────────────────────────────────────────
function PostCard({
  post,
  channels,
  onEdit,
  onDelete,
  onPublish,
}: {
  post: CustomPost;
  channels: string[];
  onEdit: () => void;
  onDelete: () => void;
  onPublish: (channel: string) => Promise<void>;
}) {
  const [publishChannel, setPublishChannel] = useState(channels[0] ?? '');
  const [publishing, setPublishing] = useState(false);

  const activeSchedules = post.schedules.filter(s => s.active);

  const handlePublish = async () => {
    if (!publishChannel) return;
    setPublishing(true);
    await onPublish(publishChannel);
    setPublishing(false);
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ width: 52, height: 52, borderRadius: 8, background: 'var(--bg4)', flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
          {post.image ? (
            <img
              src={post.image}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : '📢'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2, color: 'var(--t1)' }}>
            {post.title || <em style={{ color: 'var(--t3)', fontWeight: 400 }}>Senza titolo</em>}
          </div>
          {post.body && (
            <div style={{ fontSize: 12, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {post.body.replace(/<[^>]+>/g, '')}
            </div>
          )}
        </div>
      </div>

      {activeSchedules.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
          {activeSchedules.map(s => (
            <span
              key={s.id}
              style={{ fontSize: 10, background: 'rgba(6,182,212,0.12)', color: 'var(--a1)', border: '1px solid rgba(6,182,212,0.22)', borderRadius: 20, padding: '2px 8px', fontWeight: 600 }}
            >
              {s.days.map(d => DAYS[d]).join(' ')} {s.time}
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
        <button
          className="btn bgr"
          style={{ padding: '0 14px', flexShrink: 0, fontSize: 12 }}
          onClick={handlePublish}
          disabled={publishing || !publishChannel}
        >
          {publishing ? '...' : '▶ Invia ora'}
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export function CustomPostsPage({ nav }: { nav: (p: NavPage) => void }) {
  const { allChannels, settings } = useApp();
  const channels = (allChannels.length ? allChannels : (settings.channels ?? []));

  const [posts, setPosts] = useState<CustomPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CustomPost | null | 'new'>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    customPostsApi.list()
      .then(data => setPosts(Array.isArray(data) ? data : []))
      .catch(e => setErr(e.message || 'Errore caricamento'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = (saved: CustomPost) => {
    setPosts(prev => {
      const idx = prev.findIndex(p => p.id === saved.id);
      return idx >= 0 ? prev.map(p => p.id === saved.id ? saved : p) : [saved, ...prev];
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
        onSave={handleSave}
        onBack={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="pg">
      <PageHeader
        title="Post Promo"
        onBack={() => nav('dash')}
        badge={posts.length || undefined}
        right={
          <button className="btn bp" style={{ padding: '7px 14px', fontSize: 13 }} onClick={() => setEditing('new')}>
            + Nuovo
          </button>
        }
      />

      {err && <ErrorBanner>{err}</ErrorBanner>}

      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--t3)' }}>Caricamento...</div>
      )}

      {!loading && posts.length === 0 && !err && (
        <EmptyState
          icon="📢"
          text="Nessun post promo salvato"
          action={
            <button className="btn bp" onClick={() => setEditing('new')}>+ Crea il primo post</button>
          }
        />
      )}

      {posts.map(post => (
        <PostCard
          key={post.id}
          post={post}
          channels={channels}
          onEdit={() => setEditing(post)}
          onDelete={() => handleDelete(post.id)}
          onPublish={channel => handlePublish(post, channel)}
        />
      ))}
    </div>
  );
}
