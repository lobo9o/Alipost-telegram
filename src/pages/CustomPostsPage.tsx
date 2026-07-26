import React, { useState, useEffect, Component } from 'react';
import { NavPage } from '../types';
import { useApp } from '../context/AppContext';
import { PageHeader, EmptyState, ErrorBanner } from '../components/Shared';
import { customPostsApi, CustomPost, CustomPostSchedule } from '../lib/api';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

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

function newSchedule(channel: string): CustomPostSchedule {
  return { id: crypto.randomUUID(), days: [], time: '09:00', channel, active: true };
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

// ── Bot link helpers ──────────────────────────────────────────
const BOT_BASE = 'https://t.me/amaalipostdealbot';

function openBotChat(startParam?: string) {
  const url = startParam ? `${BOT_BASE}?start=${startParam}` : BOT_BASE;
  const tgWebApp = (window as any).Telegram?.WebApp;
  if (tgWebApp?.openTelegramLink) tgWebApp.openTelegramLink(url);
  else window.open(url, '_blank');
}

// ── Post Card ─────────────────────────────────────────────────
function PostCard({ post, channels, onDelete, onPostUpdate, onPublish, onBotOpen }: {
  post: CustomPost; channels: string[];
  onDelete: () => void;
  onPostUpdate: (p: CustomPost) => void;
  onPublish: (channel: string) => Promise<void>;
  onBotOpen: () => void;
}) {
  const [publishChannel, setPublishChannel] = useState(channels[0] ?? '');
  const [publishing, setPublishing] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [schedules, setSchedules] = useState(safeSchedules(post.schedules));
  const [savingSchedule, setSavingSchedule] = useState(false);

  const activeSchedules = schedules.filter(s => s.active);

  const handleSaveSchedules = async () => {
    setSavingSchedule(true);
    try {
      const updated = await customPostsApi.update(post.id, {
        title: post.title, image: post.image, body: post.body,
        keyboard: post.keyboard, schedules,
      });
      onPostUpdate({ ...updated, schedules: safeSchedules(updated.schedules) });
      setShowSchedule(false);
    } catch (e: any) {
      alert('Errore salvataggio: ' + e.message);
    } finally {
      setSavingSchedule(false);
    }
  };

  return (
    <div className="card">
      {/* Header: thumbnail + title */}
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

      {/* Active schedule badges */}
      {activeSchedules.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
          {activeSchedules.map((s, i) => (
            <span key={s.id || i} style={{ fontSize: 10, background: 'rgba(6,182,212,0.12)', color: 'var(--a1)', border: '1px solid rgba(6,182,212,0.22)', borderRadius: 20, padding: '2px 8px', fontWeight: 600 }}>
              {(Array.isArray(s.days) ? s.days : []).map(d => DAYS[d]).join(' ')} {s.time}
            </span>
          ))}
        </div>
      )}

      {/* 4 action buttons */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button className="btn bs" style={{ flex: 1, padding: '8px 0', fontSize: 12 }}
          onClick={() => { openBotChat('edit_' + post.id); onBotOpen(); }}>
          ✏️ Modifica
        </button>
        <button className="btn bs" style={{ flex: 1, padding: '8px 0', fontSize: 12 }}
          onClick={() => openBotChat('preview_' + post.id)}>
          👁 Preview
        </button>
        <button className={showSchedule ? 'btn bp' : 'btn bs'} style={{ flex: 1, padding: '8px 0', fontSize: 12 }}
          onClick={() => setShowSchedule(s => !s)}>
          📅 Orario
        </button>
        <button className="btn bre" style={{ padding: '8px 12px', fontSize: 13 }} onClick={onDelete}>🗑</button>
      </div>

      {/* Inline schedule editor */}
      {showSchedule && (
        <div style={{ marginBottom: 8 }}>
          {schedules.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--t3)', fontSize: 13, padding: '12px 0 8px' }}>
              Nessuna programmazione. Aggiungi un orario.
            </div>
          )}
          {schedules.map((s, i) => (
            <ScheduleItem key={s.id || i} sched={s} channels={channels}
              onChange={updated => setSchedules(prev => prev.map((x, xi) => xi === i ? updated : x))}
              onDelete={() => setSchedules(prev => prev.filter((_, xi) => xi !== i))} />
          ))}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button className="btn bs" style={{ flex: 1 }}
              onClick={() => setSchedules(prev => [...prev, newSchedule(channels[0] ?? '')])}>
              + Aggiungi
            </button>
            <button className="btn bp" style={{ flex: 1 }} onClick={handleSaveSchedules} disabled={savingSchedule}>
              {savingSchedule ? '...' : '✓ Salva orari'}
            </button>
          </div>
        </div>
      )}

      {/* Channel selector + publish */}
      <div className="irow">
        <select className="sel" style={{ flex: 1, fontSize: 12 }} value={publishChannel} onChange={e => setPublishChannel(e.target.value)}>
          {channels.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="btn bgr" style={{ padding: '0 14px', flexShrink: 0, fontSize: 12 }}
          onClick={async () => { setPublishing(true); await onPublish(publishChannel); setPublishing(false); }}
          disabled={publishing || !publishChannel}>
          {publishing ? '...' : '▶ Invio'}
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
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [botHint, setBotHint] = useState(false);

  const loadPosts = () => {
    setLoading(true);
    customPostsApi.list()
      .then(data => {
        const list = Array.isArray(data) ? data : [];
        setPosts(list.map(p => ({ ...p, schedules: safeSchedules(p.schedules) })));
      })
      .catch(e => setErr(e.message || 'Errore caricamento'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadPosts(); }, []);

  const handleDelete = async (id: string) => {
    if (!window.confirm('Eliminare questo post promo?')) return;
    await customPostsApi.delete(id).catch(() => {});
    setPosts(prev => prev.filter(p => p.id !== id));
  };

  const handlePostUpdate = (updated: CustomPost) => {
    setPosts(prev => prev.map(p => p.id === updated.id ? updated : p));
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

  return (
    <div className="pg">
      <PageHeader title="Post Promo" onBack={() => nav('dash')} badge={posts.length || undefined}
        right={
          <button className="btn bp" style={{ padding: '7px 14px', fontSize: 13 }}
            onClick={() => { setBotHint(true); openBotChat('newpost'); }}>
            + Nuovo
          </button>
        }
      />

      {err && <ErrorBanner>{err}</ErrorBanner>}
      {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--t3)' }}>Caricamento...</div>}

      {botHint && (
        <div style={{
          margin: '0 16px 14px', padding: '12px 14px', borderRadius: 10,
          background: 'rgba(6,182,212,0.10)', border: '1px solid rgba(6,182,212,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--a1)', marginBottom: 2 }}>Chat del bot aperta</div>
            <div style={{ fontSize: 12, color: 'var(--t2)' }}>Quando hai finito torna qui e ricarica.</div>
          </div>
          <button className="btn bs" style={{ fontSize: 12, padding: '6px 12px', flexShrink: 0 }}
            onClick={() => { setBotHint(false); loadPosts(); }}>
            Ricarica
          </button>
        </div>
      )}

      {!loading && posts.length === 0 && !err && (
        <EmptyState icon="📢" text="Nessun post promo salvato"
          action={
            <button className="btn bp" onClick={() => { setBotHint(true); openBotChat('newpost'); }}>
              + Crea il primo post nel bot
            </button>
          }
        />
      )}

      {posts.map(post => (
        <PostCard
          key={post.id}
          post={post}
          channels={channels}
          onDelete={() => handleDelete(post.id)}
          onPostUpdate={handlePostUpdate}
          onPublish={channel => handlePublish(post, channel)}
          onBotOpen={() => setBotHint(true)}
        />
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
