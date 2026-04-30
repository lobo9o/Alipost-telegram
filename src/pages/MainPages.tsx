import React, { useState, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { NavPage, CreatedPost, QueueItem, Platform, Template, Tag, TextLayout } from '../types';
import { PageHeader, SourceBadge, StatusBadge, SwitchTabs, EmptyState, InfoBanner, ErrorBanner, ToggleRow, TelegramPreview } from '../components/Shared';
import { genId } from '../data/mock';
import { detectAmazonLink } from '../services/amazonService';
import { resolvePostTags, aliCurrencySym, SYSTEM_TAGS } from '../utils/tagUtils';
import { productApi, postsApi, autopostApi, publishedApi } from '../lib/api';
import { generatePostImage, generateTerminataImage } from '../utils/imageCompose';

// ── Template image preview (reused in PostCard + standalone) ──
const TPL_SCALE = 0.65; // allineato a canvas: fontSize*2 / preview ~340px

function TemplateImagePreview({ post, template }: { post: CreatedPost; template: Template | undefined }) {
  const hasImage = post.image && post.image !== 'placeholder.jpg';

  if (!template) {
    return (
      <div className="tpl-preview">
        <div className="tpl-product">
          {hasImage
            ? <img src={post.image} alt="" style={{ width: '65%', height: '65%', objectFit: 'contain' }} />
            : <span style={{ fontSize: 88 }}>{post.emoji}</span>
          }
        </div>
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

  const pp = template.product;
  return (
    <div style={{
      margin: '0 16px 12px', borderRadius: 10, overflow: 'hidden',
      position: 'relative', aspectRatio: '1/1', background: template.bgColor,
      boxShadow: '0 2px 16px rgba(0,0,0,0.35)', isolation: 'isolate',
    }}>
      {/* Product image at template position */}
      <div style={{
        position: 'absolute', left: `${pp.x}%`, top: `${pp.y}%`,
        width: `${pp.size}%`, height: `${pp.size}%`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {hasImage
          ? <img src={post.image} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          : <span style={{ fontSize: `${pp.size * 0.55}px` }}>{post.emoji}</span>
        }
      </div>

      {/* Overlay */}
      {template.overlay.enabled && template.overlay.src && (
        <img src={template.overlay.src} alt="" style={{
          position: 'absolute', left: `${template.overlay.x}%`, top: `${template.overlay.y}%`,
          width: `${template.overlay.size}%`, height: `${template.overlay.size}%`,
          objectFit: 'contain', pointerEvents: 'none',
        }} />
      )}

      {/* Store */}
      {template.store.enabled && (
        <div style={{
          position: 'absolute', left: `${template.store.x}%`, top: `${template.store.y}%`,
          width: `${template.store.size}%`, aspectRatio: '1/1',
          background: post.platform === 'amazon' ? '#FF9900' : '#E43226',
          borderRadius: '20%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: `${template.store.size * 0.4}px`, pointerEvents: 'none',
        }}>
          {post.platform === 'amazon' ? '🟡' : '🔴'}
        </div>
      )}

      {/* Text elements with actual values */}
      {template.prezzo.enabled && (
        <div style={{
          position: 'absolute',
          ...(template.prezzo.textAnchor === 'right'
            ? { right: `${100 - template.prezzo.x}%` }
            : template.prezzo.textAnchor === 'center'
              ? { left: `${template.prezzo.x}%`, transform: 'translateX(-50%)' }
              : { left: `${template.prezzo.x}%` }),
          top: `${template.prezzo.y}%`,
          fontSize: `${template.prezzo.fontSize * TPL_SCALE}px`,
          fontFamily: template.prezzo.fontFamily, fontWeight: template.prezzo.bold ? 700 : 400,
          color: template.prezzo.color, whiteSpace: 'nowrap', pointerEvents: 'none',
          WebkitTextStroke: template.prezzo.strokeEnabled ? `${template.prezzo.strokeWidth * TPL_SCALE}px ${template.prezzo.strokeColor}` : undefined,
        }}>€{post.discountedPrice.toFixed(2)}</div>
      )}
      {template.prezzoPrecedente.enabled && (
        <div style={{
          position: 'absolute',
          ...(template.prezzoPrecedente.textAnchor === 'right'
            ? { right: `${100 - template.prezzoPrecedente.x}%` }
            : template.prezzoPrecedente.textAnchor === 'center'
              ? { left: `${template.prezzoPrecedente.x}%`, transform: 'translateX(-50%)' }
              : { left: `${template.prezzoPrecedente.x}%` }),
          top: `${template.prezzoPrecedente.y}%`,
          fontSize: `${template.prezzoPrecedente.fontSize * TPL_SCALE}px`,
          fontFamily: template.prezzoPrecedente.fontFamily, fontWeight: template.prezzoPrecedente.bold ? 700 : 400,
          color: template.prezzoPrecedente.color,
          textDecoration: template.prezzoPrecedente.strikethrough ? `line-through ${template.prezzoPrecedente.strikethroughColor || template.prezzoPrecedente.color}` : 'none',
          whiteSpace: 'nowrap', pointerEvents: 'none',
          WebkitTextStroke: template.prezzoPrecedente.strokeEnabled ? `${template.prezzoPrecedente.strokeWidth * TPL_SCALE}px ${template.prezzoPrecedente.strokeColor}` : undefined,
        }}>€{post.originalPrice.toFixed(2)}</div>
      )}
      {template.sconto.enabled && (
        <div style={{
          position: 'absolute',
          ...(template.sconto.textAnchor === 'right'
            ? { right: `${100 - template.sconto.x}%` }
            : template.sconto.textAnchor === 'center'
              ? { left: `${template.sconto.x}%`, transform: 'translateX(-50%)' }
              : { left: `${template.sconto.x}%` }),
          top: `${template.sconto.y}%`,
          fontSize: `${template.sconto.fontSize * TPL_SCALE}px`,
          fontFamily: template.sconto.fontFamily, fontWeight: template.sconto.bold ? 700 : 400,
          color: template.sconto.color, whiteSpace: 'nowrap', pointerEvents: 'none',
          WebkitTextStroke: template.sconto.strokeEnabled ? `${template.sconto.strokeWidth * TPL_SCALE}px ${template.sconto.strokeColor}` : undefined,
        }}>-{post.discountPercent}%</div>
      )}
      {template.testoCustom.enabled && post.customText && (
        <div style={{
          position: 'absolute',
          ...(template.testoCustom.textAnchor === 'right'
            ? { right: `${100 - template.testoCustom.x}%` }
            : template.testoCustom.textAnchor === 'center'
              ? { left: `${template.testoCustom.x}%`, transform: 'translateX(-50%)' }
              : { left: `${template.testoCustom.x}%` }),
          top: `${template.testoCustom.y}%`,
          fontSize: `${template.testoCustom.fontSize * TPL_SCALE}px`,
          fontFamily: template.testoCustom.fontFamily, fontWeight: template.testoCustom.bold ? 700 : 400,
          color: template.testoCustom.color,
          textDecoration: template.testoCustom.strikethrough ? `line-through ${template.testoCustom.strikethroughColor || template.testoCustom.color}` : 'none',
          whiteSpace: 'nowrap', pointerEvents: 'none',
          WebkitTextStroke: template.testoCustom.strokeEnabled ? `${template.testoCustom.strokeWidth * TPL_SCALE}px ${template.testoCustom.strokeColor}` : undefined,
        }}>{post.customText}</div>
      )}

      {/* Badge — sopra tutto, incluso il testo, solo se minimo storico */}
      {template.badge.enabled && post.isHistoricalLow && template.badge.src && (
        <img src={template.badge.src} alt="" style={{
          position: 'absolute', left: `${template.badge.x}%`, top: `${template.badge.y}%`,
          width: `${template.badge.size}%`, objectFit: 'contain', pointerEvents: 'none', zIndex: 5,
        }} />
      )}
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
  const { createdPosts, setCreatedPosts, layouts, templates, tags, settings } = useApp();
  const post = createdPosts.find(p => p.id === postId);
  if (!post) return null;

  const currentTemplate = templates.find(t => t.id === post.templateId);
  const currentLayout = layouts.find(l => l.id === post.layoutId);
  const currency = post.platform === 'aliexpress' ? aliCurrencySym(settings.aliexpress.targetCountry) : '€';
  const previewText = currentLayout ? resolvePostTags(currentLayout.contenuto, post, tags, currency) : '—';

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
    const layId = v
      ? (layouts.find(l => l.tipo === 'historical_low')?.id ?? post.layoutId)
      : (layouts.find(l => l.tipo === 'normal')?.id ?? post.layoutId);
    update({ isHistoricalLow: v, layoutId: layId });
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

        {/* Template selector — single template, show as static label */}
        <div style={{ marginBottom: 8 }}>
          <div className="lbl">TEMPLATE IMMAGINE</div>
          <div style={{ padding: '8px 12px', background: 'var(--bg3)', borderRadius: 8, fontSize: 13, color: 'var(--t2)' }}>
            {templates[0] ? `Template (ID: ${templates[0].id})` : 'Nessun template — configura in Layout'}
          </div>
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
  const { createdPosts, setQueue, layouts, keyboards, templates } = useApp();

  const [phase, setPhase] = useState<'input' | 'loading'>('input');
  const [mode, setMode] = useState<'single' | 'multi'>('single');
  const [linkInput, setLinkInput] = useState('');
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [err, setErr] = useState('');
  const [feedback, setFeedback] = useState('');

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
    setPhase('loading');
    setErr('');
    try {
      const defaultNormalTpl = templates[0]?.id ?? 'tpl1';
      const defaultNormalLay = layouts.find(l => l.tipo === 'normal')?.id ?? 'l1';
      const defaultKb = keyboards[0]?.id ?? 'kb1';

      const newPosts: CreatedPost[] = await Promise.all(links.map(async l => {
        const newId = genId();
        if (l.platform === 'amazon') {
          const p = await productApi.fetchAmazon({ url: l.url });
          return { id: newId, platform: 'amazon' as const, sourceUrl: p.affiliateUrl || l.url, productId: p.asin, title: p.title, image: p.image, originalPrice: p.originalPrice, discountedPrice: p.discountedPrice, discountPercent: p.discountPercent, customText: '', isHistoricalLow: false, templateId: defaultNormalTpl, layoutId: defaultNormalLay, keyboardId: defaultKb, emoji: '📦', stelle: p.stelle, recensioni: p.recensioni, author: p.author, cat: p.cat, coupon: p.coupon };
        } else {
          const p = await productApi.fetchAliExpress({ url: l.url });
          return { id: newId, platform: 'aliexpress' as const, sourceUrl: p.affiliateUrl || l.url, productId: p.productId, title: p.title, image: p.image, originalPrice: p.originalPrice, discountedPrice: p.discountedPrice, discountPercent: p.discountPercent, customText: '', isHistoricalLow: false, templateId: defaultNormalTpl, layoutId: defaultNormalLay, keyboardId: defaultKb, emoji: '📦' };
        }
      }));

      // Aggiungi direttamente alla coda e naviga
      const queueItems: QueueItem[] = newPosts.map(p => ({
        id: genId(), tipo: 'single' as const, posts: [p], sched: 'Auto', status: 'draft' as const, sel: false,
      }));
      setQueue(prev => [...prev, ...queueItems]);
      newPosts.forEach(p => postsApi.create(p).catch(() => {}));
      queueItems.forEach(item => autopostApi.create(item).catch(() => {}));
      setLinks([]);
      nav('queue');
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Errore durante l\'analisi dei link. Riprova.');
      setPhase('input');
    }
  };


  return (
    <div className="pg">
      <PageHeader title="Nuovo Post" onBack={() => nav('dash')}
        badge={createdPosts.length > 0 ? createdPosts.length : undefined} badgeVariant="purple"
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
              <button className="btn bs bfull" onClick={() => nav('queue')}>
                📋 Vai alla coda ({createdPosts.length})
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

    </div>
  );
}

// ── Tag editing helpers ───────────────────────────────────────

// Tag di sistema auto-calcolati o già coperti da altri campi del form (non mostrare nel pannello tag)
const SKIP_IN_TAG_PANEL = new Set([
  '{titolo}', '{titoloup}', '{titoloshort}',
  '{prezzo}', '{prezzo_scontato}', '{oldprezzo}', '{sconto}', '{perc}', '{valuta}',
  '{link}', '{link_affiliato}',
  '{minimo_storico}',
  '{custom}', // già coperto da "TESTO PERSONALIZZATO"
  '{store}', '{storeup}', '{countryflag}',
  '{giorno}', '{ora}', '{data}',
  '{checkout}',
]);

// Tag di sistema che l'utente può editare (mappati a campi di CreatedPost)
type EditableSystemTag = { label: string; field: keyof CreatedPost; placeholder: string };
const EDITABLE_SYSTEM_TAG_MAP: Record<string, EditableSystemTag> = {
  '{coupon}':     { label: 'Coupon',      field: 'coupon',     placeholder: 'Codice sconto...' },
  '{boxcoupon}':  { label: 'Coupon',      field: 'coupon',     placeholder: 'Codice sconto...' },
  '{stelle}':     { label: 'Stelle',      field: 'stelle',     placeholder: '⭐⭐⭐⭐' },
  '{recensioni}': { label: 'Recensioni',  field: 'recensioni', placeholder: 'es. 1.234 recensioni' },
  '{cat}':        { label: 'Categoria',   field: 'cat',        placeholder: 'Categoria prodotto...' },
  '{author}':     { label: 'Autore',      field: 'author',     placeholder: 'Nome autore...' },
};

function extractLayoutTags(contenuto: string): string[] {
  const matches = contenuto.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) ?? [];
  return [...new Set(matches)];
}

function DynamicTagFields({ layout, post, postTags, itemId, onUpdate }: {
  layout: { contenuto: string } | undefined;
  post: CreatedPost;
  postTags: Tag[];
  itemId: string;
  onUpdate: (id: string, ch: Partial<CreatedPost>) => void;
}) {
  if (!layout) return null;

  const layoutTags = extractLayoutTags(layout.contenuto);

  // Tag di sistema editabili presenti nel layout (dedup per campo)
  const shownFields = new Set<string>();
  const systemFields: Array<EditableSystemTag & { tag: string }> = [];
  for (const tag of layoutTags) {
    const m = EDITABLE_SYSTEM_TAG_MAP[tag];
    if (m && !shownFields.has(m.field as string)) {
      shownFields.add(m.field as string);
      systemFields.push({ tag, ...m });
    }
  }

  // Tag personalizzati (non in SYSTEM_TAGS) presenti nel layout
  const customFields: Array<{ tag: string; globalValue: string }> = [];
  for (const tag of layoutTags) {
    if (!SYSTEM_TAGS.has(tag)) {
      const globalTag = postTags.find(t => t.name === tag);
      if (globalTag) customFields.push({ tag, globalValue: globalTag.value });
    }
  }

  if (systemFields.length === 0 && customFields.length === 0) return null;

  const pillStyle = (color: string, bg: string): React.CSSProperties => ({
    fontSize: 10, padding: '1px 7px', borderRadius: 10,
    fontFamily: 'monospace', color, background: bg, flexShrink: 0,
  });

  return (
    <>
      <div className="stit">TAG NEL LAYOUT</div>

      {systemFields.map(({ tag, label, field, placeholder }) => (
        <div key={field as string} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span className="lbl" style={{ marginBottom: 0 }}>{label.toUpperCase()}</span>
            <span style={pillStyle('var(--a1)', 'rgba(6,182,212,0.12)')}>{tag}</span>
          </div>
          <input className="inp" value={(post[field] as string) || ''} placeholder={placeholder}
            onChange={e => onUpdate(itemId, { [field]: e.target.value })} />
        </div>
      ))}

      {customFields.map(({ tag, globalValue }) => {
        const override = post.tagOverrides?.[tag];
        const currentValue = override !== undefined ? override : globalValue;
        const isOverridden = override !== undefined && override !== globalValue;
        return (
          <div key={tag} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <span className="lbl" style={{ marginBottom: 0 }}>TAG PERSONALIZZATO</span>
              <span style={pillStyle('#f59e0b', 'rgba(251,191,36,0.12)')}>{tag}</span>
              {isOverridden && (
                <span style={{ fontSize: 9, color: 'var(--t3)', marginLeft: 'auto' }}>
                  globale: "{globalValue}"
                </span>
              )}
            </div>
            <input className="inp" value={currentValue} placeholder={`Valore per ${tag}...`}
              onChange={e => onUpdate(itemId, {
                tagOverrides: { ...(post.tagOverrides ?? {}), [tag]: e.target.value },
              })} />
          </div>
        );
      })}
    </>
  );
}

// ============================================================
// QUEUE PAGE
// ============================================================
export function QueuePage({ nav }: { nav: (p: NavPage) => void }) {
  const { queue, setQueue, layouts, keyboards, templates, tags, setPublished, published, settings } = useApp();
  const [currentIdx, setCurrentIdx] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [publishErr, setPublishErr] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const touchStartX = useRef(0);

  const safeIdx = Math.min(currentIdx, Math.max(0, queue.length - 1));

  React.useEffect(() => {
    if (queue.length > 0 && currentIdx >= queue.length) setCurrentIdx(queue.length - 1);
  }, [queue.length, currentIdx]);

  const updateQueuePost = (itemId: string, changes: Partial<CreatedPost>) => {
    setQueue(q => q.map(x => x.id === itemId ? { ...x, posts: [{ ...x.posts[0], ...changes }] } : x));
  };

  const publish = async (id: string) => {
    if (publishingId) return;
    const item = queue.find(x => x.id === id);
    if (!item) { setPublishErr('Elemento coda non trovato'); return; }
    const rawPost = item.posts[0];
    if (!rawPost || typeof rawPost !== 'object' || Array.isArray(rawPost)) {
      setPublishErr('Post non valido'); return;
    }
    const post = rawPost as CreatedPost;
    if (!post.id) { setPublishErr('Post senza ID'); return; }
    const layout = layouts.find(l => l.id === post.layoutId);
    const template = templates.find(t => t.id === post.templateId);
    setPublishErr(null);

    // Avviso se già pubblicato oggi
    const dupPub = published.find(p => p.productId === post.productId);
    if (dupPub) {
      const ok = window.confirm(
        `⚠️ Questo prodotto è già stato pubblicato oggi alle ${dupPub.ts}.\n\nVuoi pubblicarlo di nuovo?`
      );
      if (!ok) return;
    }

    setPublishingId(id);

    // Rimuovi subito dalla UI + marca come published nel DB (fire-and-forget — non blocca la UI)
    setQueue(q => q.filter(x => x.id !== id));
    setCurrentIdx(i => Math.max(0, Math.min(i, queue.length - 2)));
    autopostApi.update(id, { status: 'published' }).catch(() => {});

    try {
      let generatedImage: string | undefined;
      if (template) {
        try {
          generatedImage = await generatePostImage(template, post.image, post.isHistoricalLow, post.platform, {
            prezzo: `€${Number(post.discountedPrice).toFixed(2)}`,
            prezzoPrecedente: `€${Number(post.originalPrice).toFixed(2)}`,
            sconto: `-${post.discountPercent}%`,
            testoCustom: post.customText,
          });
        } catch { /* fall back to URL */ }
      }
      const keyboard = keyboards.find(k => k.id === post.keyboardId) ?? keyboards[0];
      const pubResult = await postsApi.publish(post.id, { post, layoutContenuto: layout?.contenuto, keyboardContenuto: keyboard?.contenuto, generatedImage }) as { ok: boolean; messageId?: number; chatId?: string };
      autopostApi.delete(id).catch(() => {}); // cleanup finale, fire-and-forget OK (status già aggiornato)
      const now = new Date().toISOString();
      const pubRecord = {
        id: post.id, emoji: post.emoji, title: post.title,
        price: Number(post.discountedPrice).toFixed(2),
        originalPrice: post.originalPrice, discountPercent: post.discountPercent,
        platform: post.platform, image: post.image,
        sourceUrl: post.sourceUrl, productId: post.productId,
        customText: post.customText, layoutId: post.layoutId,
        isHistoricalLow: post.isHistoricalLow,
        chatId: pubResult.chatId ?? '', messageId: pubResult.messageId ?? 0,
        publishedAt: now, ts: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
      };
      setPublished(prev => [pubRecord, ...prev]);
      publishedApi.save(pubRecord).catch(() => {});
      setPublishingId(null);
    } catch (e) {
      const msg = e instanceof Error ? (e.message || 'Errore sconosciuto') : String(e) || 'Errore sconosciuto';
      autopostApi.update(id, { status: 'draft' }).catch(() => {});
      setQueue(q => [item, ...q]);
      setPublishErr(msg);
      setPublishingId(null);
    }
  };

  const del = (id: string) => { autopostApi.delete(id).catch(() => {}); setQueue(q => q.filter(x => x.id !== id)); };

  const move = (id: string, dir: 'up' | 'down') => setQueue(q => {
    const a = [...q]; const i = a.findIndex(x => x.id === id);
    if (dir === 'up' && i > 0) [a[i - 1], a[i]] = [a[i], a[i - 1]];
    if (dir === 'down' && i < a.length - 1) [a[i], a[i + 1]] = [a[i + 1], a[i]];
    return a;
  });

  const clearAll = async () => {
    try { await autopostApi.deleteAll(); } catch (e) {
      window.alert('Errore: ' + (e instanceof Error ? e.message : String(e)));
    }
    setQueue([]);
  };

  const handleTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) < 40) return;
    if (dx < 0 && safeIdx < queue.length - 1) { setCurrentIdx(i => i + 1); setExpandedId(null); }
    if (dx > 0 && safeIdx > 0) { setCurrentIdx(i => i - 1); setExpandedId(null); }
  };

  if (!queue.length) {
    return (
      <div className="pg">
        <PageHeader title="Coda AutoPost" onBack={() => nav('dash')} badge={0} />
        <EmptyState icon="🗓️" text="Nessun post in coda."
          action={<button className="btn bp" onClick={() => nav('newpost')}>+ Nuovo post</button>} />
      </div>
    );
  }

  const item = queue[safeIdx];
  const p = item?.posts[0] as CreatedPost | undefined;
  const template = p ? templates.find(t => t.id === p.templateId) : undefined;
  const layout = p ? layouts.find(l => l.id === p.layoutId) : undefined;
  const qCurrency = p?.platform === 'aliexpress' ? aliCurrencySym(settings.aliexpress.targetCountry) : '€';
  const previewText = (layout && p) ? resolvePostTags(layout.contenuto, p, tags, qCurrency) : '';
  const isEditing = expandedId === item?.id;

  return (
    <div className="pg">
      <PageHeader title="Coda AutoPost" onBack={() => nav('dash')} badge={queue.length}
        right={
          <button className="btn bre bsm" onClick={() => { if (window.confirm('Svuotare tutta la coda?')) clearAll(); }}>
            🗑️ Svuota
          </button>
        }
      />

      {/* Contatore + navigazione frecce */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px 4px', gap: 8 }}>
        <button className="btn bgh bsm" disabled={safeIdx === 0}
          onClick={() => { setCurrentIdx(i => i - 1); setExpandedId(null); }}>←</button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--a1)' }}>{safeIdx + 1}</span>
          <span style={{ fontSize: 13, color: 'var(--t3)' }}> / {queue.length}</span>
          {safeIdx === 0 && (
            <span style={{ fontSize: 9, color: 'var(--gr2)', marginLeft: 8, fontWeight: 700,
                           background: '#0a2a0a', padding: '2px 7px', borderRadius: 8, letterSpacing: 0.5 }}>
              ● PROSSIMO
            </span>
          )}
        </div>
        <button className="btn bgh bsm" disabled={safeIdx === queue.length - 1}
          onClick={() => { setCurrentIdx(i => i + 1); setExpandedId(null); }}>→</button>
      </div>

      {/* Dot indicator */}
      {queue.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 4, paddingBottom: 6 }}>
          {queue.map((_, i) => (
            <div key={i} onClick={() => { setCurrentIdx(i); setExpandedId(null); }}
              style={{ width: i === safeIdx ? 18 : 6, height: 6, borderRadius: 3,
                       background: i === safeIdx ? 'var(--a1)' : 'var(--bg4)',
                       cursor: 'pointer', transition: 'width 0.2s, background 0.2s', flexShrink: 0 }} />
          ))}
        </div>
      )}

      {publishErr && <ErrorBanner>{publishErr}</ErrorBanner>}

      {/* Post corrente — area swipeable */}
      {item && p && (
        <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>

          {/* Azioni SOPRA l'immagine */}
          <div style={{ display: 'flex', gap: 5, padding: '2px 16px 8px', overflowX: 'auto', alignItems: 'center' }}>
            <button className="btn bsm" style={{ background: '#071a38', color: '#60a5fa', border: '1px solid #0e3060', flexShrink: 0 }}
              onClick={() => { move(item.id, 'up'); setCurrentIdx(i => Math.max(0, i - 1)); }}
              disabled={safeIdx === 0}>↑ Su</button>
            <button className="btn bsm" style={{ background: '#071a38', color: '#60a5fa', border: '1px solid #0e3060', flexShrink: 0 }}
              onClick={() => { move(item.id, 'down'); setCurrentIdx(i => Math.min(queue.length - 1, i + 1)); }}
              disabled={safeIdx === queue.length - 1}>↓ Giù</button>
            <div style={{ flex: 1 }} />
            <button className="btn bsm bgh" style={{ flexShrink: 0 }}
              onClick={() => setExpandedId(isEditing ? null : item.id)}>
              {isEditing ? '✕ Chiudi' : '✏️ Modifica'}
            </button>
            <button
              className="btn bgr bsm"
              style={{ flexShrink: 0, minWidth: 90, opacity: publishingId ? 0.6 : 1 }}
              onClick={() => publish(item.id)}
              disabled={!!publishingId}
            >
              {publishingId === item.id ? '⏳ Invio...' : '⚡ Pubblica'}
            </button>
            <button className="btn bre bsm" style={{ flexShrink: 0 }} onClick={() => del(item.id)}>🗑️</button>
          </div>

          {/* Anteprima immagine template */}
          <TemplateImagePreview post={p} template={template} />

          {/* Testo completo OPPURE form modifica */}
          {!isEditing ? (
            <div style={{ padding: '0 16px 24px' }}>
              <TelegramPreview
                text={previewText}
                buttons={[`🛒 Compra su ${p.platform === 'amazon' ? 'Amazon' : 'AliExpress'}`]}
              />
            </div>
          ) : (
            <div style={{ padding: '12px 16px 28px', borderTop: '1px solid var(--bd)' }}>
              <div style={{ marginBottom: 10 }}>
                <div className="lbl">TITOLO</div>
                <input className="inp" value={p.title} onChange={e => updateQueuePost(item.id, { title: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                <div style={{ flex: 1 }}>
                  <div className="lbl">PREZZO ORIG.</div>
                  <input className="inp" type="number" step="0.01" value={p.originalPrice}
                    onChange={e => {
                      const orig = parseFloat(e.target.value) || 0;
                      const pct = orig > 0 ? Math.round((1 - p.discountedPrice / orig) * 100) : 0;
                      updateQueuePost(item.id, { originalPrice: orig, discountPercent: Math.max(0, pct) });
                    }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="lbl">PREZZO SCONT.</div>
                  <input className="inp" type="number" step="0.01" value={p.discountedPrice}
                    onChange={e => {
                      const disc = parseFloat(e.target.value) || 0;
                      const pct = p.originalPrice > 0 ? Math.round((1 - disc / p.originalPrice) * 100) : 0;
                      updateQueuePost(item.id, { discountedPrice: disc, discountPercent: Math.max(0, pct) });
                    }} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '6px 12px', background: '#2a1800', borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--t2)', flex: 1 }}>Sconto calcolato</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--am2)' }}>-{p.discountPercent}%</span>
              </div>
              <div style={{ background: 'var(--bg3)', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
                <ToggleRow label="Minimo Storico" value={p.isHistoricalLow}
                  onChange={v => {
                    const layId = v
                      ? (layouts.find(l => l.tipo === 'historical_low')?.id ?? p.layoutId)
                      : (layouts.find(l => l.tipo === 'normal')?.id ?? p.layoutId);
                    updateQueuePost(item.id, { isHistoricalLow: v, layoutId: layId });
                  }} />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div className="lbl">LAYOUT TESTO</div>
                <select className="sel" value={p.layoutId} onChange={e => updateQueuePost(item.id, { layoutId: e.target.value })}>
                  {layouts.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 10 }}>
                <div className="lbl">TASTIERA BOTTONI</div>
                <select className="sel" value={p.keyboardId ?? keyboards[0]?.id ?? ''} onChange={e => updateQueuePost(item.id, { keyboardId: e.target.value })}>
                  {keyboards.map(k => <option key={k.id} value={k.id}>{k.nome}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 10 }}>
                <div className="lbl">TESTO PERSONALIZZATO <span style={{ fontSize: 10, color: 'var(--a1)', fontFamily: 'monospace', fontWeight: 400 }}>{'{custom}'}</span></div>
                <textarea className="txta" rows={2} value={p.customText}
                  onChange={e => updateQueuePost(item.id, { customText: e.target.value })}
                  placeholder="Testo aggiuntivo..." />
              </div>
              <DynamicTagFields
                layout={layout}
                post={p}
                postTags={tags}
                itemId={item.id}
                onUpdate={updateQueuePost}
              />
              {previewText && (
                <>
                  <div className="stit">ANTEPRIMA TESTO</div>
                  <TelegramPreview text={previewText} buttons={[`🛒 Compra su ${p.platform === 'amazon' ? 'Amazon' : 'AliExpress'}`]} />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// PUBLISHED PAGE
// ============================================================
export function PublishedPage({ nav }: { nav: (p: NavPage) => void }) {
  const { published, setPublished, setQueue, layouts, tags, settings, templates } = useApp();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editErr, setEditErr] = useState('');
  const [saving, setSaving] = useState(false);

  const reinsert = (p: typeof published[0]) => {
    const post: CreatedPost = {
      id: genId(), platform: p.platform, sourceUrl: p.sourceUrl, productId: p.productId,
      title: p.title, image: p.image, emoji: p.emoji,
      originalPrice: p.originalPrice,
      discountedPrice: parseFloat(p.price),
      discountPercent: p.discountPercent,
      customText: p.customText, isHistoricalLow: p.isHistoricalLow,
      templateId: 'tpl1', layoutId: p.layoutId, keyboardId: 'kb1',
    };
    setQueue(prev => [...prev, { id: genId(), tipo: 'single', posts: [post], sched: 'Auto', status: 'draft', sel: false }]);
    nav('queue');
  };

  const startEdit = (p: typeof published[0]) => {
    setEditingId(p.id);
    setEditText(p.customText || '');
    setEditErr('');
  };

  const saveEdit = async (p: typeof published[0]) => {
    if (!p.chatId || !p.messageId) {
      setEditErr('message_id Telegram non disponibile — il post è stato pubblicato con una versione precedente del bot.');
      return;
    }
    setSaving(true); setEditErr('');
    try {
      const layout = layouts.find(l => l.id === p.layoutId);
      const updatedPost = { ...p, customText: editText };
      const pCurrency = p.platform === 'aliexpress' ? aliCurrencySym(settings.aliexpress.targetCountry) : '€';
      const newCaption = layout
        ? resolvePostTags(layout.contenuto, {
            id: p.id, platform: p.platform, sourceUrl: p.sourceUrl, productId: p.productId,
            title: p.title, image: p.image, emoji: p.emoji,
            originalPrice: p.originalPrice, discountedPrice: parseFloat(p.price),
            discountPercent: p.discountPercent, customText: editText,
            isHistoricalLow: p.isHistoricalLow, templateId: 'tpl1', layoutId: p.layoutId, keyboardId: 'kb1',
          }, tags, pCurrency)
        : editText;
      await publishedApi.editTelegram(p.id, { chatId: p.chatId, messageId: p.messageId, newCaption } as any);
      setPublished(prev => prev.map(x => x.id === p.id ? { ...x, customText: editText } : x));
      setEditingId(null);
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : 'Errore durante la modifica');
    } finally {
      setSaving(false);
    }
  };

  const markTerminata = async (p: typeof published[0]) => {
    if (!p.chatId || !p.messageId) { alert('message_id non disponibile'); return; }
    if (!window.confirm(`Segnare "${p.title.slice(0, 30)}..." come TERMINATA?`)) return;

    const terminataCfg = settings.terminata;
    const tmpl = templates[0];
    const terminataLayout = layouts.find(l => l.id === terminataCfg.layoutId);

    let newImage: string | undefined;
    if (tmpl && p.image && p.image.startsWith('http')) {
      try {
        newImage = await generateTerminataImage(tmpl, p.image, p.platform, terminataCfg, {
          prezzo: `€${Number(p.price).toFixed(2)}`,
          prezzoPrecedente: `€${p.originalPrice.toFixed(2)}`,
          sconto: `-${p.discountPercent}%`,
          testoCustom: p.customText,
        });
      } catch { /* fallback: solo testo */ }
    }

    try {
      await publishedApi.editTelegram(p.id, {
        chatId: p.chatId, messageId: p.messageId,
        terminata: true,
        newCaption: terminataLayout?.contenuto,
        newImage,
      } as any);
      setPublished(prev => prev.map(x => x.id === p.id ? { ...x, terminata: true } : x));
    } catch (e) {
      alert('Errore: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div className="pg">
      <PageHeader title="Pubblicati oggi" onBack={() => nav('dash')} badge={`${published.length}`} badgeVariant="green" />
      <div style={{ height: 8 }} />
      {!published.length && (
        <EmptyState icon="✅" text="Nessun post pubblicato oggi."
          action={<button className="btn bp" onClick={() => nav('queue')}>Vai alla coda</button>} />
      )}
      {published.map(p => (
        <div key={p.id} className="card" style={{ margin: '0 16px 12px', padding: 0, overflow: 'hidden' }}>
          {/* Mini image */}
          {p.image && p.image.startsWith('http') && (
            <img src={p.image} alt="" style={{ width: '100%', aspectRatio: '2/1', objectFit: 'cover', display: 'block' }} />
          )}
          <div style={{ padding: '10px 12px 12px' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <SourceBadge platform={p.platform} />
              <span style={{ fontSize: 10, color: 'var(--t3)' }}>{p.ts}</span>
              {p.isHistoricalLow && <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 700 }}>🏆 MIN</span>}
              {p.terminata && <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 700, background: '#2a0808', padding: '2px 7px', borderRadius: 10, border: '1px solid #5a1515' }}>❌ TERMINATA</span>}
              {p.messageId > 0 && <span style={{ fontSize: 9, color: 'var(--gr2)', marginLeft: 'auto' }}>✓ ID:{p.messageId}</span>}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, lineHeight: 1.3 }}>{p.title}</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: p.terminata ? 'var(--t3)' : 'var(--gr2)', textDecoration: p.terminata ? 'line-through' : 'none' }}>€{p.price}</span>
              <span style={{ fontSize: 11, color: 'var(--t3)', alignSelf: 'center' }}>-{p.discountPercent}%</span>
            </div>

            {/* Edit form */}
            {editingId === p.id ? (
              <>
                <div className="lbl">TESTO PERSONALIZZATO</div>
                <textarea className="txta" rows={2} value={editText}
                  onChange={e => setEditText(e.target.value)} style={{ marginBottom: 8 }} />
                {editErr && <ErrorBanner>{editErr}</ErrorBanner>}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn bs bsm" style={{ flex: 1 }} onClick={() => setEditingId(null)}>Annulla</button>
                  <button className="btn bp bsm" style={{ flex: 2 }} disabled={saving}
                    onClick={() => saveEdit(p)}>{saving ? '...' : '💾 Salva su Telegram'}</button>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                <button className="btn bsm bgh" disabled={p.terminata} onClick={() => startEdit(p)}>✏️ Modifica</button>
                <button className="btn bsm bgh" style={{ color: '#ef4444' }} disabled={p.terminata} onClick={() => markTerminata(p)}>❌ Terminata</button>
                <button className="btn bsm bbl" disabled={p.terminata} onClick={() => reinsert(p)}>↩️ Ri-accoda</button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
