import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { NavPage, CreatedPost, QueueItem, Platform, Template } from '../types';
import { PageHeader, SourceBadge, StatusBadge, SwitchTabs, EmptyState, InfoBanner, ErrorBanner, ToggleRow, TelegramPreview } from '../components/Shared';
import { genId } from '../data/mock';
import { detectAmazonLink } from '../services/amazonService';
import { resolvePostTags } from '../utils/tagUtils';
import { productApi, postsApi, autopostApi } from '../lib/api';

// ── Template image preview (reused in PostCard + standalone) ──
function TemplateImagePreview({ post, template }: { post: CreatedPost; template: Template | undefined }) {
  const showBadge = post.isHistoricalLow || (template?.badgeEnabled ?? false);
  const hasImage = post.image && post.image !== 'placeholder.jpg';

  return (
    <div className="tpl-preview">
      {/* Product image or emoji */}
      <div className="tpl-product">
        {hasImage
          ? <img src={post.image} alt="" style={{ width: '65%', height: '65%', objectFit: 'contain' }} />
          : <span style={{ fontSize: 88, filter: 'drop-shadow(0 4px 24px rgba(0,0,0,0.6))' }}>{post.emoji}</span>
        }
      </div>

      {/* Overlay PNG */}
      {template?.overlay && <img src={template.overlay} alt="" className="tpl-overlay" />}

      {/* Logo */}
      {template?.logo
        ? <img src={template.logo} alt="" className="tpl-logo" />
        : <div className="tpl-platform" style={{ background: post.platform === 'amazon' ? 'rgba(245,158,11,0.15)' : 'rgba(255,107,107,0.15)', color: post.platform === 'amazon' ? '#f59e0b' : '#ff6b6b', backdropFilter: 'blur(6px)' }}>
            {post.platform === 'amazon' ? '🟡 Amazon' : '🔴 AliExpress'}
          </div>
      }

      {/* Historical Low Badge */}
      {showBadge && <div className="tpl-badge">🏆 MIN. STORICO</div>}

      {/* Price bar */}
      <div className="tpl-price-bar">
        <div className="tpl-price-row">
          <span className="tpl-price-new">€{post.discountedPrice.toFixed(2)}</span>
          <span className="tpl-price-old">€{post.originalPrice.toFixed(2)}</span>
          <span className="tpl-price-disc">-{post.discountPercent}%</span>
        </div>
      </div>
    </div>
  );
}

// ── Single post card (used in carousel) ───────────────────────
function PostCard({ postId, onDelete, onQueue, onPublish }: {
  postId: string;
  onDelete: () => void;
  onQueue: () => void;
  onPublish: () => void;
}) {
  const { createdPosts, setCreatedPosts, layouts, templates, tags } = useApp();
  const post = createdPosts.find(p => p.id === postId);
  if (!post) return null;

  const currentTemplate = templates.find(t => t.id === post.templateId);
  const currentLayout = layouts.find(l => l.id === post.layoutId);
  const previewText = currentLayout ? resolvePostTags(currentLayout.contenuto, post, tags) : '—';

  const update = (changes: Partial<CreatedPost>) =>
    setCreatedPosts(prev => prev.map(p => p.id === postId ? { ...p, ...changes } : p));

  const handlePrice = (field: 'originalPrice' | 'discountedPrice', raw: string) => {
    const num = parseFloat(raw) || 0;
    const orig = field === 'originalPrice' ? num : post.originalPrice;
    const disc = field === 'discountedPrice' ? num : post.discountedPrice;
    const pct = orig > 0 ? Math.round((1 - disc / orig) * 100) : 0;
    update({ [field]: num, discountPercent: Math.max(0, pct) });
  };

  const handleHistoricalLow = (v: boolean) => {
    const tplId = v
      ? (templates.find(t => t.tipo === 'historical_low')?.id ?? post.templateId)
      : (templates.find(t => t.tipo === 'normal')?.id ?? post.templateId);
    const layId = v
      ? (layouts.find(l => l.tipo === 'historical_low')?.id ?? post.layoutId)
      : (layouts.find(l => l.tipo === 'normal')?.id ?? post.layoutId);
    update({ isHistoricalLow: v, templateId: tplId, layoutId: layId });
  };

  return (
    <div>
      {/* Template image preview */}
      <TemplateImagePreview post={post} template={currentTemplate} />

      <div className="post-card">
        {/* Header */}
        <div className="post-card-header">
          <SourceBadge platform={post.platform} />
          {post.isHistoricalLow && (
            <span style={{ fontSize: 10, background: '#2a0808', color: '#ef4444', border: '1px solid #5a1515', padding: '2px 7px', borderRadius: 10, fontWeight: 700 }}>🏆 Min. Storico</span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)' }}>prodotto da link</span>
        </div>

        {/* Title */}
        <div style={{ marginBottom: 10 }}>
          <div className="lbl">TITOLO</div>
          <input className="inp" value={post.title} onChange={e => update({ title: e.target.value })} />
        </div>

        {/* Prices */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div className="lbl">PREZZO ORIG. → {'{prezzo}'}</div>
            <input className="inp" type="number" step="0.01" value={post.originalPrice}
              onChange={e => handlePrice('originalPrice', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="lbl">PREZZO SCONT. → {'{prezzo_scontato}'}</div>
            <input className="inp" type="number" step="0.01" value={post.discountedPrice}
              onChange={e => handlePrice('discountedPrice', e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '7px 12px', background: '#2a1800', borderRadius: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--t2)', flex: 1 }}>Sconto calcolato automaticamente</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--am2)', fontFamily: 'Syne, sans-serif' }}>-{post.discountPercent}%</span>
        </div>

        {/* Historical Low toggle */}
        <div style={{ background: 'var(--bg3)', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
          <ToggleRow label="Minimo Storico" sub="Cambia template e layout automaticamente"
            value={post.isHistoricalLow} onChange={handleHistoricalLow} />
        </div>

        {/* Template selector */}
        <div style={{ marginBottom: 8 }}>
          <div className="lbl">TEMPLATE IMMAGINE</div>
          <select className="sel" value={post.templateId} onChange={e => update({ templateId: e.target.value })}>
            {templates.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </div>

        {/* Layout selector */}
        <div style={{ marginBottom: 8 }}>
          <div className="lbl">LAYOUT TESTO</div>
          <select className="sel" value={post.layoutId} onChange={e => update({ layoutId: e.target.value })}>
            {layouts.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
        </div>

        {/* Custom text */}
        <div style={{ marginBottom: 10 }}>
          <div className="lbl">TESTO PERSONALIZZATO → {'{custom}'}</div>
          <textarea className="txta" rows={2} value={post.customText}
            onChange={e => update({ customText: e.target.value })}
            placeholder="Inserisci un testo aggiuntivo..." />
        </div>
      </div>

      {/* Live text preview */}
      <div className="stit">ANTEPRIMA TESTO (aggiornamento in tempo reale)</div>
      <TelegramPreview
        text={previewText}
        buttons={[`🛒 Compra su ${post.platform === 'amazon' ? 'Amazon' : 'AliExpress'}`]}
      />

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, padding: '0 16px 16px' }}>
        <button className="btn bre bsm" style={{ flex: 1 }} onClick={onDelete}>🗑️ Elimina</button>
        <button className="btn bgr bsm" style={{ flex: 1 }} onClick={onPublish}>⚡ Pubblica</button>
        <button className="btn bp bsm" style={{ flex: 2 }} onClick={onQueue}>📬 Aggiungi coda</button>
      </div>
    </div>
  );
}

// ── Post list summary row ─────────────────────────────────────
function PostListItem({ post, isActive, onEdit, onDelete, onQueue, onPublish }: {
  post: CreatedPost;
  isActive: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onQueue: () => void;
  onPublish: () => void;
}) {
  return (
    <div className={`post-list-item ${isActive ? 'post-list-active' : ''}`}>
      <div className="post-list-thumb">{post.emoji}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{post.title}</div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--gr2)', fontFamily: 'Syne, sans-serif' }}>€{post.discountedPrice.toFixed(2)}</span>
          <span style={{ fontSize: 11, color: 'var(--t3)', textDecoration: 'line-through' }}>€{post.originalPrice.toFixed(2)}</span>
          <span className="dbdg">-{post.discountPercent}%</span>
          <SourceBadge platform={post.platform} />
          {post.isHistoricalLow && <span style={{ fontSize: 10, color: '#ef4444' }}>🏆</span>}
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          <button className="btn bgh bsm" style={{ padding: '3px 8px', fontSize: 11, background: isActive ? 'var(--bg4)' : undefined }} onClick={onEdit}>✏️ Modifica</button>
          <button className="btn bgh bsm" style={{ padding: '3px 8px', fontSize: 11, color: 'var(--re)' }} onClick={onDelete}>🗑️</button>
          <button className="btn bgr bsm" style={{ padding: '3px 8px', fontSize: 11 }} onClick={onPublish}>⚡</button>
          <button className="btn bp bsm" style={{ padding: '3px 8px', fontSize: 11 }} onClick={onQueue}>+ Coda</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// DASHBOARD
// ============================================================
export function Dashboard({ nav }: { nav: (p: NavPage) => void }) {
  const { stats, settings, createdPosts } = useApp();
  const items = [
    { id: 'search', ic: '🔍', lb: 'Cerca Offerte', sub: 'Amazon & AliExpress', c: 'var(--bl)' },
    { id: 'newpost', ic: '✏️', lb: 'Nuovo Post', sub: createdPosts.length > 0 ? `${createdPosts.length} bozze in attesa` : 'singolo / multiplo', c: 'var(--a1)' },
    { id: 'queue', ic: '🗓️', lb: 'Coda AutoPost', sub: `${stats.inCoda} in coda`, c: 'var(--or)' },
    { id: 'published', ic: '✅', lb: 'Pubblicati', sub: `${stats.pub} oggi`, c: 'var(--gr)' },
    { id: 'layout', ic: '🎨', lb: 'Layout', sub: 'tag · testo · template', c: 'var(--a2)' },
    { id: 'settings', ic: '⚙️', lb: 'Impostazioni', sub: 'API · canali · orari', c: 'var(--t2)' },
  ];
  return (
    <div className="pg">
      <div className="hero">
        <div className="hero-top">
          <div className="logo">P</div>
          <div>
            <div className="brand">PostDeal<span>Bot</span></div>
            <div style={{ fontSize: 11, color: 'var(--t2)' }}>Gestione post affiliati</div>
          </div>
          {settings.attivo && <div className="hbdg" style={{ marginLeft: 'auto' }}>AUTO ON</div>}
        </div>
        <div className="hero-stats">
          <div className="stat"><div className="sn" style={{ color: 'var(--a3)' }}>{stats.inCoda}</div><div className="sl">In coda</div></div>
          <div className="stat"><div className="sn" style={{ color: 'var(--am2)' }}>{stats.sched}</div><div className="sl">Programmati</div></div>
          <div className="stat"><div className="sn" style={{ color: 'var(--gr2)' }}>{stats.pub}</div><div className="sl">Pubblicati</div></div>
        </div>
      </div>
      <div className="menu-grid">
        {items.map(it => (
          <div key={it.id} className="mc" onClick={() => nav(it.id as NavPage)}>
            <div className="mc-dot" style={{ background: it.c }} />
            <div className="mc-ic">{it.ic}</div>
            <div className="mc-lb">{it.lb}</div>
            <div className="mc-sub">{it.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// SEARCH PAGE
// ============================================================
export function SearchPage({ nav }: { nav: (p: NavPage) => void }) {
  return (
    <div className="pg">
      <PageHeader title="Cerca Offerte" onBack={() => nav('dash')} />
      <EmptyState
        icon="🔍"
        text="La ricerca prodotti non è ancora disponibile."
        action={
          <button className="btn bp" onClick={() => nav('newpost')}>
            ✏️ Crea post da link
          </button>
        }
      />
    </div>
  );
}

// ============================================================
// NEW POST PAGE
// ============================================================
interface LinkItem { id: string; url: string; platform: Platform; }

export function NewPostPage({ nav }: { nav: (p: NavPage) => void }) {
  const { createdPosts, setCreatedPosts, setQueue, setPublished, layouts, templates } = useApp();

  // Start in 'posts' phase if there are pending posts
  const [phase, setPhase] = useState<'input' | 'loading' | 'posts'>(() =>
    createdPosts.length > 0 ? 'posts' : 'input'
  );
  const [mode, setMode] = useState<'single' | 'multi'>('single');
  const [linkInput, setLinkInput] = useState('');
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [err, setErr] = useState('');
  const [feedback, setFeedback] = useState('');
  const [currentIdx, setCurrentIdx] = useState(0);

  const safeIdx = Math.min(currentIdx, Math.max(0, createdPosts.length - 1));

  const showFeedback = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(''), 2500); };

  const sendLink = () => {
    if (!linkInput.trim()) return;
    if (mode === 'multi' && links.length >= 6) { setErr('Massimo 6 link per post multiplo.'); return; }
    const url = linkInput.trim();
    const platform: Platform = detectAmazonLink(url) ? 'amazon' : 'aliexpress';
    setLinks(prev => [...prev, { id: genId(), url, platform }]);
    setLinkInput(''); setErr('');
    showFeedback(`✅ Link ${platform === 'amazon' ? 'Amazon' : 'AliExpress'} rilevato`);
  };

  const creaPost = async () => {
    if (!links.length) return;
    const prevLen = createdPosts.length;
    setPhase('loading');
    setErr('');
    try {
      const defaultNormalTpl = templates.find(t => t.tipo === 'normal')?.id ?? 'tpl1';
      const defaultNormalLay = layouts.find(l => l.tipo === 'normal')?.id ?? 'l1';

      const newPosts: CreatedPost[] = await Promise.all(links.map(async l => {
        const newId = genId();
        if (l.platform === 'amazon') {
          const p = await productApi.fetchAmazon({ url: l.url });
          return { id: newId, platform: 'amazon' as const, sourceUrl: p.affiliateUrl || l.url, productId: p.asin, title: p.title, image: p.image, originalPrice: p.originalPrice, discountedPrice: p.discountedPrice, discountPercent: p.discountPercent, customText: '', isHistoricalLow: false, templateId: defaultNormalTpl, layoutId: defaultNormalLay, emoji: '📦' };
        } else {
          const p = await productApi.fetchAliExpress({ url: l.url });
          return { id: newId, platform: 'aliexpress' as const, sourceUrl: p.affiliateUrl || l.url, productId: p.productId, title: p.title, image: p.image, originalPrice: p.originalPrice, discountedPrice: p.discountedPrice, discountPercent: p.discountPercent, customText: '', isHistoricalLow: false, templateId: defaultNormalTpl, layoutId: defaultNormalLay, emoji: '📦' };
        }
      }));

      // Optimistic local update first, then persist in background
      setCreatedPosts(prev => [...prev, ...newPosts]);
      setCurrentIdx(prevLen);
      setLinks([]);
      setPhase('posts');
      showFeedback(`✅ ${newPosts.length} post creati con successo`);
      newPosts.forEach(p => postsApi.create(p).catch(() => {}));
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Errore durante l\'analisi dei link. Riprova.');
      setPhase('input');
    }
  };

  const deletePost = (id: string) => {
    setCreatedPosts(prev => prev.filter(p => p.id !== id));
    setCurrentIdx(i => Math.max(0, i - 1));
    postsApi.delete(id).catch(() => {});
  };

  const addToQueue = (post: CreatedPost) => {
    const item: QueueItem = { id: genId(), tipo: 'single', posts: [post], sched: 'Auto', status: 'draft', sel: false };
    setQueue(prev => [...prev, item]);
    autopostApi.create(item).catch(() => {});
    deletePost(post.id);
    showFeedback('📬 Post aggiunto alla coda');
  };

  const publishPost = async (post: CreatedPost) => {
    const currentLayout = layouts.find(l => l.id === post.layoutId);
    setErr('');
    setPhase('loading');
    try {
      await postsApi.publish(post.id, {
        post,
        layoutContenuto: currentLayout?.contenuto,
      });
      setPublished(prev => [...prev, { id: genId(), emoji: post.emoji, title: post.title, price: post.discountedPrice.toFixed(2), platform: post.platform, ts: 'ora' }]);
      deletePost(post.id);
      nav('published');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Errore durante la pubblicazione');
      setPhase('posts');
    }
  };

  return (
    <div className="pg">
      <PageHeader title="Nuovo Post" onBack={() => nav('dash')}
        badge={createdPosts.length > 0 ? createdPosts.length : undefined} badgeVariant="purple"
        right={phase === 'posts' && createdPosts.length > 0
          ? <button className="btn bgh bsm" style={{ fontSize: 11 }} onClick={() => setPhase('input')}>+ Link</button>
          : undefined
        }
      />

      {/* ── INPUT PHASE ── */}
      {phase === 'input' && (
        <>
          <div className="cbar">
            <div className="cb">
              <div className="cbnum" style={{ color: 'var(--a3)' }}>{links.length}</div>
              <div className="cblb">Link</div>
            </div>
            <div className="cb">
              <div className="cbnum" style={{ color: 'var(--am2)' }}>{createdPosts.length}</div>
              <div className="cblb">Bozze</div>
            </div>
          </div>

          <SwitchTabs
            options={[['single', 'Singolo'], ['multi', 'Multiplo']]}
            value={mode} onChange={v => { setMode(v as any); setLinks([]); setErr(''); }}
          />

          {mode === 'multi' && <InfoBanner>📦 Modalità multipla — max 6 link. Incolla i link uno alla volta.</InfoBanner>}
          {err && <ErrorBanner>{err}</ErrorBanner>}
          {feedback && <div className="feedback-ok">{feedback}</div>}

          <div className="stit">INSERISCI LINK</div>
          <div style={{ padding: '0 16px 10px' }}>
            <div className="irow">
              <input className="inp" value={linkInput} onChange={e => setLinkInput(e.target.value)}
                placeholder="https://amazon.it/... oppure aliexpress.com/..."
                onKeyDown={e => e.key === 'Enter' && sendLink()} />
              <button className="btn bp" onClick={sendLink} style={{ width: 44, padding: 0, flexShrink: 0 }}>+</button>
            </div>
          </div>

          {links.length > 0 && (
            <>
              <div className="stit">LINK AGGIUNTI ({links.length})</div>
              {links.map(l => (
                <div key={l.id} className="llink">
                  <SourceBadge platform={l.platform} />
                  <span className="llink-url">{l.url}</span>
                  <button className="btn bgh bsm" style={{ color: 'var(--re)', padding: '4px 8px', flexShrink: 0 }}
                    onClick={() => setLinks(prev => prev.filter(x => x.id !== l.id))}>×</button>
                </div>
              ))}
              <div style={{ padding: '8px 16px 16px' }}>
                <button className="btn bp bfull" onClick={creaPost}>🚀 Crea Post ({links.length})</button>
              </div>
            </>
          )}

          {createdPosts.length > 0 && (
            <div style={{ padding: links.length > 0 ? '0 16px 16px' : '8px 16px 16px' }}>
              <button className="btn bs bfull" onClick={() => setPhase('posts')}>
                📋 Visualizza bozze ({createdPosts.length})
              </button>
            </div>
          )}
        </>
      )}

      {/* ── LOADING PHASE ── */}
      {phase === 'loading' && (
        <div className="loading-phase">
          <div style={{ fontSize: 44 }}>⏳</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Analisi in corso...</div>
          <div style={{ fontSize: 13, color: 'var(--t2)', textAlign: 'center' }}>
            Recupero dati da {links.length} {links.length === 1 ? 'link' : 'link'}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {links.map(l => <SourceBadge key={l.id} platform={l.platform} />)}
          </div>
        </div>
      )}

      {/* ── POSTS PHASE ── */}
      {phase === 'posts' && (
        <>
          {createdPosts.length === 0 ? (
            <EmptyState icon="✅" text="Tutti i post aggiunti alla coda!"
              action={<button className="btn bp" onClick={() => setPhase('input')}>+ Crea nuovi post</button>}
            />
          ) : (
            <>
              {feedback && <div className="feedback-ok" style={{ margin: '8px 16px 0' }}>{feedback}</div>}

              {/* Carousel navigation */}
              <div className="carousel-ctrl">
                <button className="btn bgh bsm" disabled={safeIdx === 0} onClick={() => setCurrentIdx(i => i - 1)}>←</button>
                <span style={{ flex: 1, textAlign: 'center', fontSize: 12, color: 'var(--t2)', fontWeight: 600 }}>
                  Post {safeIdx + 1} / {createdPosts.length}
                </span>
                <button className="btn bgh bsm" disabled={safeIdx === createdPosts.length - 1} onClick={() => setCurrentIdx(i => i + 1)}>→</button>
              </div>

              {/* Dot navigator */}
              <div className="dots-row">
                {createdPosts.map((_, i) => (
                  <div key={i} className={`dot ${i === safeIdx ? 'on' : ''}`}
                    style={{ width: i === safeIdx ? 18 : 6 }} onClick={() => setCurrentIdx(i)} />
                ))}
              </div>

              {/* Current post card */}
              <PostCard
                postId={createdPosts[safeIdx].id}
                onDelete={() => deletePost(createdPosts[safeIdx].id)}
                onQueue={() => addToQueue(createdPosts[safeIdx])}
                onPublish={() => publishPost(createdPosts[safeIdx])}
              />

              {/* POST CREATI list overview */}
              {createdPosts.length > 0 && (
                <>
                  <div className="stit">POST CREATI ({createdPosts.length})</div>
                  {createdPosts.map((p, i) => (
                    <PostListItem
                      key={p.id}
                      post={p}
                      isActive={i === safeIdx}
                      onEdit={() => setCurrentIdx(i)}
                      onDelete={() => deletePost(p.id)}
                      onQueue={() => addToQueue(p)}
                      onPublish={() => publishPost(p)}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================
// QUEUE PAGE
// ============================================================
export function QueuePage({ nav }: { nav: (p: NavPage) => void }) {
  const { queue, setQueue, layouts, setPublished } = useApp();
  const [multiSelect, setMultiSelect] = useState(false);
  const [publishErr, setPublishErr] = useState<{ id: string; msg: string } | null>(null);
  const selCount = queue.filter(x => x.sel).length;

  const toggle = (id: string) => setQueue(q => q.map(x => x.id === id ? { ...x, sel: !x.sel } : x));
  const delSelected = () => setQueue(q => q.filter(x => !x.sel));
  const publish = async (id: string) => {
    const item = queue.find(x => x.id === id);
    if (!item) return;
    const post = item.posts[0];
    if (!post) return;
    const layout = layouts.find(l => l.id === post.layoutId);
    setPublishErr(null);
    setQueue(q => q.map(x => x.id === id ? { ...x, status: 'scheduled' } : x));
    try {
      await postsApi.publish(post.id, { post, layoutContenuto: layout?.contenuto });
      setQueue(q => q.map(x => x.id === id ? { ...x, status: 'published' } : x));
      autopostApi.update(id, { status: 'published' }).catch(() => {});
      setPublished(prev => [...prev, { id: post.id, emoji: post.emoji, title: post.title, price: post.discountedPrice.toFixed(2), platform: post.platform, ts: 'ora' }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Errore pubblicazione';
      setQueue(q => q.map(x => x.id === id ? { ...x, status: 'error' } : x));
      autopostApi.update(id, { status: 'error' }).catch(() => {});
      setPublishErr({ id, msg });
    }
  };
  const del = (id: string) => setQueue(q => q.filter(x => x.id !== id));
  const move = (id: string, dir: 'up' | 'down') => setQueue(q => {
    const a = [...q]; const i = a.findIndex(x => x.id === id);
    if (dir === 'up' && i > 0) [a[i - 1], a[i]] = [a[i], a[i - 1]];
    if (dir === 'down' && i < a.length - 1) [a[i], a[i + 1]] = [a[i + 1], a[i]];
    return a;
  });

  const firstPost = (item: QueueItem) => item.posts[0];

  return (
    <div className="pg">
      <PageHeader title="Coda AutoPost" onBack={() => nav('dash')} badge={queue.length}
        right={
          <button className="btn bgh bsm" onClick={() => setMultiSelect(!multiSelect)}
            style={{ color: multiSelect ? 'var(--a3)' : 'var(--t2)' }}>
            {multiSelect ? '✓ Sel.' : '☐ Multi'}
          </button>
        }
      />

      {multiSelect && selCount > 0 && (
        <div style={{ display: 'flex', gap: 8, padding: '10px 16px', background: 'var(--bg2)', borderBottom: '1px solid var(--bd)' }}>
          <span style={{ fontSize: 12, color: 'var(--t2)', flex: 1, alignSelf: 'center' }}>{selCount} selezionati</span>
          <button className="btn bre bsm" onClick={delSelected}>🗑️ Elimina</button>
        </div>
      )}

      {publishErr && <ErrorBanner>{publishErr.msg}</ErrorBanner>}

      {!queue.length ? (
        <EmptyState icon="🗓️" text="Nessun post in coda." action={<button className="btn bp" onClick={() => nav('newpost')}>+ Nuovo post</button>} />
      ) : (
        <>
          <div style={{ height: 10 }} />
          {queue.map((item, idx) => {
            const p = firstPost(item);
            return (
              <div key={item.id} className="qi" style={{ position: 'relative' }}>
                {multiSelect && (
                  <div className={`qsel ${item.sel ? 'on' : ''}`} onClick={() => toggle(item.id)}>
                    {item.sel && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>✓</span>}
                  </div>
                )}
                <div className="qi-h">
                  <span className={`qtype ${item.tipo}`}>{item.tipo === 'single' ? 'Singolo' : 'Multi'}</span>
                  <SourceBadge platform={p?.platform ?? 'amazon'} />
                  <span style={{ fontSize: 13, fontWeight: 600, flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', paddingLeft: 4 }}>
                    {p?.emoji} {p?.title?.slice(0, 22)}
                    {item.posts.length > 1 && ` +${item.posts.length - 1}`}
                  </span>
                  <StatusBadge status={item.status} />
                </div>
                <div className="qmeta">
                  <span>🕐 {item.sched}</span>
                  <span>💰 €{p?.discountedPrice?.toFixed(2)}</span>
                  <span>📦 {item.posts.length} prod.</span>
                  {p?.isHistoricalLow && <span>🏆 Min. Storico</span>}
                </div>
                <div className="qacts">
                  <button className="btn bsm" style={{ background: '#071a38', color: '#60a5fa', border: '1px solid #0e3060' }} onClick={() => move(item.id, 'up')} disabled={idx === 0}>↑</button>
                  <button className="btn bsm" style={{ background: '#071a38', color: '#60a5fa', border: '1px solid #0e3060' }} onClick={() => move(item.id, 'down')} disabled={idx === queue.length - 1}>↓</button>
                  <button className="btn bgr bsm" onClick={() => publish(item.id)}>⚡ Pubblica</button>
                  <button className="btn bre bsm" onClick={() => del(item.id)}>🗑️</button>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ============================================================
// PUBLISHED PAGE
// ============================================================
export function PublishedPage({ nav }: { nav: (p: NavPage) => void }) {
  const { published, setQueue } = useApp();

  const reinsert = (p: typeof published[0]) => {
    const post: CreatedPost = {
      id: genId(), platform: p.platform, sourceUrl: '', productId: '',
      title: p.title, image: '', emoji: p.emoji,
      originalPrice: parseFloat(p.price) * 1.5,
      discountedPrice: parseFloat(p.price),
      discountPercent: 33,
      customText: '', isHistoricalLow: false, templateId: 'tpl1', layoutId: 'l1',
    };
    setQueue(prev => [...prev, { id: genId(), tipo: 'single', posts: [post], sched: 'Auto', status: 'draft', sel: false }]);
    nav('queue');
  };

  return (
    <div className="pg">
      <PageHeader title="Pubblicati" onBack={() => nav('dash')} badge={`${published.length} oggi`} badgeVariant="green" />
      <div style={{ height: 10 }} />
      {!published.length && <EmptyState icon="✅" text="Nessun post pubblicato oggi." />}
      {published.map(p => (
        <div key={p.id} className="pub-card">
          <div className="pub-thumb">{p.emoji}</div>
          <div className="pub-info">
            <div className="pub-tit">{p.title}</div>
            <div className="pub-meta">
              <SourceBadge platform={p.platform} /> {p.ts} · €{p.price}
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              <button className="btn bsm bs">✏️ Modifica</button>
              <button className="btn bsm bs">📋 Duplica</button>
              <button className="btn bsm bbl" onClick={() => reinsert(p)}>↩️ AutoPost</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
