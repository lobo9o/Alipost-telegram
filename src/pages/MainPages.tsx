import React, { useState, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { NavPage, CreatedPost, QueueItem, Platform, Template, Tag, TextLayout, LinkItem, NewPostItem } from '../types';
import { PageHeader, SourceBadge, StatusBadge, SwitchTabs, EmptyState, InfoBanner, ErrorBanner, ToggleRow, TelegramPreview } from '../components/Shared';
import { genId } from '../data/mock';
import { detectAmazonLink } from '../services/amazonService';
import { resolvePostTags, aliCurrencySym, SYSTEM_TAGS } from '../utils/tagUtils';
import { productApi, postsApi, autopostApi, publishedApi, utilsApi } from '../lib/api';
import { generatePostImage, generateMultiPostImage, generateTerminataImage } from '../utils/imageCompose';

// ── Template image preview (reused in PostCard + standalone) ──
const CANVAS_SIZE_PREVIEW = 1024;

function TemplateImagePreview({ post, template }: { post: CreatedPost; template: Template | undefined }) {
  const hasImage = post.image && post.image !== 'placeholder.jpg';
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(340);
  React.useEffect(() => {
    if (containerRef.current) setContainerW(containerRef.current.clientWidth);
  }, []);
  // Stesso calcolo di TemplatePreviewer in LayoutSettings: canvas usa fontSize*2 su 1024px
  const fontScale = (2 * containerW) / CANVAS_SIZE_PREVIEW;

  if (!template) {
    return (
      <div className="tpl-preview" ref={containerRef}>
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
    <div ref={containerRef} style={{
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
      {([
        { el: template.prezzo,          text: `€${post.discountedPrice.toFixed(2)}` },
        { el: template.prezzoPrecedente, text: `€${post.originalPrice.toFixed(2)}` },
        { el: template.sconto,          text: `-${post.discountPercent}%` },
        { el: template.testoCustom,     text: post.customText },
      ] as const).map(({ el, text }, i) =>
        el.enabled && text ? (
          <div key={i} style={{
            position: 'absolute',
            ...(el.textAnchor === 'right'
              ? { right: `${100 - el.x}%`, top: `${el.y}%` }
              : el.textAnchor === 'center'
                ? { left: `${el.x}%`, top: `${el.y}%`, transform: 'translateX(-50%)' }
                : { left: `${el.x}%`, top: `${el.y}%` }),
            fontSize: `${el.fontSize * fontScale}px`,
            lineHeight: 1,
            fontFamily: el.fontFamily, fontWeight: el.bold ? 700 : 400,
            color: el.color,
            textDecoration: (el as any).strikethrough ? `line-through ${(el as any).strikethroughColor || el.color}` : 'none',
            whiteSpace: 'nowrap', pointerEvents: 'none',
            WebkitTextStroke: el.strokeEnabled ? `${el.strokeWidth * fontScale}px ${el.strokeColor}` : undefined,
          }}>{text}</div>
        ) : null
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
  const { createdPosts, setCreatedPosts, layouts, keyboards, templates, tags, settings } = useApp();
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
    const isAli = post.platform === 'aliexpress';
    const layId = v
      ? (layouts.find(l => l.tipo === (isAli ? 'aliexpress_historical_low' : 'historical_low'))?.id ?? post.layoutId)
      : (layouts.find(l => l.tipo === (isAli ? 'aliexpress' : 'normal'))?.id ?? post.layoutId);
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

        {/* 1. Titolo */}
        <div style={{ marginBottom: 10 }}>
          <div className="lbl">TITOLO</div>
          <input className="inp" value={post.title} onChange={e => update({ title: e.target.value })} />
        </div>

        {/* 2. Prezzi */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div className="lbl">PREZZO ORIG.</div>
            <input className="inp" type="number" step="0.01" value={post.originalPrice}
              onChange={e => handlePrice('originalPrice', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="lbl">PREZZO SCONTATO</div>
            <input className="inp" type="number" step="0.01" value={post.discountedPrice}
              onChange={e => handlePrice('discountedPrice', e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '7px 12px', background: '#2a1800', borderRadius: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--t2)', flex: 1 }}>Sconto calcolato automaticamente</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--am2)', fontFamily: 'Syne, sans-serif' }}>-{post.discountPercent}%</span>
        </div>

        {/* 3. Minimo storico */}
        <div style={{ background: 'var(--bg3)', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
          <ToggleRow label="Minimo Storico" sub="Cambia template e layout automaticamente"
            value={post.isHistoricalLow} onChange={handleHistoricalLow} />
        </div>

        {/* 4. Custom text — solo se {custom} è nel layout */}
        {currentLayout?.contenuto.includes('{custom}') && (
          <div style={{ marginBottom: 10 }}>
            <div className="lbl">TESTO PERSONALIZZATO <span style={{ fontSize: 10, color: 'var(--a1)', fontFamily: 'monospace', fontWeight: 400 }}>{'{custom}'}</span></div>
            <textarea className="txta" rows={2} value={post.customText}
              onChange={e => update({ customText: e.target.value })}
              placeholder="Testo aggiuntivo..." />
          </div>
        )}

        {/* 5. Coupon — solo se {coupon}/{boxcoupon} è nel layout */}
        {(currentLayout?.contenuto.includes('{coupon}') || currentLayout?.contenuto.includes('{boxcoupon}')) && (
          <div style={{ marginBottom: 10 }}>
            <div className="lbl">COUPON <span style={{ fontSize: 10, color: 'var(--a1)', fontFamily: 'monospace', fontWeight: 400 }}>{'{coupon}'}</span></div>
            <input className="inp" value={post.coupon || ''} onChange={e => update({ coupon: e.target.value })}
              placeholder="Codice sconto (es. PROMO20)..." />
          </div>
        )}

        {/* 6. Layout testo */}
        <div style={{ marginBottom: 8 }}>
          <div className="lbl">LAYOUT TESTO</div>
          <select className="sel" value={post.layoutId} onChange={e => update({ layoutId: e.target.value })}>
            {layouts.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
        </div>

        {/* 7. Tastiera */}
        <div style={{ marginBottom: 4 }}>
          <div className="lbl">TASTIERA BOTTONI</div>
          <select className="sel" value={post.keyboardId ?? keyboards[0]?.id ?? ''}
            onChange={e => update({ keyboardId: e.target.value })}>
            {keyboards.map(k => <option key={k.id} value={k.id}>{k.nome}</option>)}
          </select>
        </div>
      </div>

      {/* 8. Tag pill: tutti i tag non auto-calcolati presenti nel layout (stelle, recensioni, cat, custom6…) */}
      <TagEditButtons layout={currentLayout} post={post} postTags={tags} onUpdate={update} />

      {/* Preview */}
      <div className="stit">ANTEPRIMA TESTO</div>
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
export function NewPostPage({ nav }: { nav: (p: NavPage) => void }) {
  const {
    createdPosts, queue, setQueue, layouts, keyboards, templates, tags,
    newPostMode: mode, setNewPostMode: setMode,
    newPostItems, setNewPostItems,
    newPostEditingMultiId, setNewPostEditingMultiId,
  } = useApp();

  const [phase, setPhase] = useState<'input' | 'loading'>('input');
  const [progress, setProgress] = useState(0);
  const [loadingTotal, setLoadingTotal] = useState(0);
  const [linkInput, setLinkInput] = useState('');
  const [err, setErr] = useState('');
  const [feedback, setFeedback] = useState('');

  const singleItems = newPostItems.filter((i): i is { id: string; type: 'single'; link: LinkItem } => i.type === 'single');
  const multiItems = newPostItems.filter((i): i is { id: string; type: 'multi'; links: LinkItem[] } => i.type === 'multi');

  // Current multi item being edited
  const currentMultiItem = multiItems.find(i => i.id === newPostEditingMultiId) ?? multiItems[multiItems.length - 1] ?? null;
  const currentMultiIdx = currentMultiItem ? multiItems.findIndex(i => i.id === currentMultiItem.id) : -1;

  const activeLinks: LinkItem[] = mode === 'multi'
    ? (currentMultiItem?.links ?? [])
    : singleItems.map(i => i.link);

  // Items that will actually be created
  const itemsToCreate = newPostItems.filter(item =>
    item.type === 'single' || (item.type === 'multi' && item.links.length >= 2)
  );
  const canCreate = itemsToCreate.length > 0;

  const showFeedback = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(''), 2500); };

  const handleModeChange = (newMode: string) => {
    const m = newMode as 'single' | 'multi';
    setMode(m);
    if (m === 'multi') {
      if (multiItems.length === 0) {
        const newId = genId();
        setNewPostItems(prev => [...prev, { id: newId, type: 'multi', links: [] }]);
        setNewPostEditingMultiId(newId);
      } else if (!newPostEditingMultiId || !multiItems.some(i => i.id === newPostEditingMultiId)) {
        setNewPostEditingMultiId(multiItems[0].id);
      }
    }
    setErr('');
  };

  const sendLink = async () => {
    if (!linkInput.trim()) return;
    let url = linkInput.trim();

    // Se non è un link Amazon/AliExpress riconoscibile, prova a risolvere i redirect (link shortati)
    const isKnown = detectAmazonLink(url) || /aliexpress\.(com|us|ru)/i.test(url);
    if (!isKnown && url.startsWith('http')) {
      try {
        showFeedback('🔍 Risolvo link...');
        const { resolved } = await utilsApi.resolveUrl(url);
        url = resolved;
      } catch {
        // usa url originale in caso di errore
      }
    }

    const platform: Platform = detectAmazonLink(url) ? 'amazon' : 'aliexpress';
    if (mode === 'multi') {
      if (!currentMultiItem) {
        const newId = genId();
        setNewPostItems(prev => [...prev, { id: newId, type: 'multi', links: [{ id: genId(), url, platform }] }]);
        setNewPostEditingMultiId(newId);
      } else if (activeLinks.length >= 6) {
        setErr('Massimo 6 link per post multiplo.'); return;
      } else {
        setNewPostItems(prev => prev.map(item =>
          item.id === currentMultiItem.id
            ? { ...item, links: [...(item as { id: string; type: 'multi'; links: LinkItem[] }).links, { id: genId(), url, platform }] }
            : item
        ));
      }
    } else {
      setNewPostItems(prev => [...prev, { id: genId(), type: 'single', link: { id: genId(), url, platform } }]);
    }
    setLinkInput(''); setErr('');
    showFeedback(`✅ Link ${platform === 'amazon' ? 'Amazon' : 'AliExpress'} rilevato`);
  };

  const removeActiveLink = (id: string) => {
    if (mode === 'multi' && currentMultiItem) {
      const updatedLinks = currentMultiItem.links.filter(l => l.id !== id);
      setNewPostItems(prev => prev.map(item =>
        item.id === currentMultiItem.id ? { ...item, links: updatedLinks } : item
      ));
    } else {
      setNewPostItems(prev => prev.filter(item => !(item.type === 'single' && item.link.id === id)));
    }
  };

  const goToNextGroup = () => {
    if (currentMultiIdx < multiItems.length - 1) {
      setNewPostEditingMultiId(multiItems[currentMultiIdx + 1].id);
    } else {
      const newId = genId();
      setNewPostItems(prev => [...prev, { id: newId, type: 'multi', links: [] }]);
      setNewPostEditingMultiId(newId);
    }
  };
  const goToPrevGroup = () => {
    if (currentMultiIdx > 0) setNewPostEditingMultiId(multiItems[currentMultiIdx - 1].id);
  };

  const creaPost = async () => {
    setErr('');
    try {
      const defaultNormalTpl = templates[0]?.id ?? 'tpl1';
      const defaultNormalLay = layouts.find(l => l.tipo === 'normal')?.id ?? 'l1';
      const defaultAliLay = layouts.find(l => l.tipo === 'aliexpress')?.id ?? defaultNormalLay;
      const defaultMultiLay = layouts.find(l => l.tipo === 'multi')?.id ?? 'l3';
      const defaultKb = keyboards[0]?.id ?? 'kb1';
      const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
      const BATCH = 5;
      const priceWarnings: string[] = [];

      const fetchOne = async (l: LinkItem): Promise<CreatedPost> => {
        const newId = genId();
        if (l.platform === 'amazon') {
          const p = await productApi.fetchAmazon({ url: l.url });
          if (p.priceWarning) priceWarnings.push(`${p.title.slice(0, 30)}… — ${p.priceWarning}`);
          return { id: newId, platform: 'amazon' as const, sourceUrl: p.affiliateUrl || l.url, productId: p.asin, title: p.title, image: p.image, originalPrice: p.originalPrice, discountedPrice: p.discountedPrice, discountPercent: p.discountPercent, customText: '', isHistoricalLow: false, templateId: defaultNormalTpl, layoutId: defaultNormalLay, keyboardId: defaultKb, emoji: '📦', stelle: p.stelle, recensioni: p.recensioni, author: p.author, cat: p.cat, coupon: p.coupon };
        } else {
          const p = await productApi.fetchAliExpress({ url: l.url });
          return { id: newId, platform: 'aliexpress' as const, sourceUrl: p.affiliateUrl || l.url, productId: p.productId, title: p.title, image: p.image, originalPrice: p.originalPrice, discountedPrice: p.discountedPrice, discountPercent: p.discountPercent, customText: '', isHistoricalLow: false, templateId: defaultNormalTpl, layoutId: defaultAliLay, keyboardId: defaultKb, emoji: '📦' };
        }
      };

      if (!itemsToCreate.length) {
        setErr('Aggiungi almeno un link singolo o un gruppo multiplo con almeno 2 link.');
        return;
      }

      // Flatten all links in order
      const allLinks: LinkItem[] = itemsToCreate.flatMap(item =>
        item.type === 'single' ? [item.link] : item.links
      );
      setLoadingTotal(allLinks.length);
      setPhase('loading');
      setProgress(0);

      const allFetched: CreatedPost[] = [];
      for (let i = 0; i < allLinks.length; i += BATCH) {
        if (i > 0) await delay(2000);
        const results = await Promise.all(allLinks.slice(i, i + BATCH).map(fetchOne));
        allFetched.push(...results);
        setProgress(allFetched.length);
      }

      let offset = 0;
      const queueItems: QueueItem[] = [];
      const singlePostsToSave: CreatedPost[] = [];

      for (const item of itemsToCreate) {
        if (item.type === 'single') {
          const post = allFetched[offset++];
          const tpl = templates.find(t => t.id === post.templateId);
          let finalPost = post;
          if (tpl) {
            try {
              const generatedImage = await generatePostImage(tpl, post.image, post.isHistoricalLow, post.platform, {
                prezzo: `€${Number(post.discountedPrice).toFixed(2)}`,
                prezzoPrecedente: `€${Number(post.originalPrice).toFixed(2)}`,
                sconto: `-${post.discountPercent}%`, testoCustom: post.customText,
              });
              finalPost = { ...post, generatedImage };
            } catch {}
          }
          singlePostsToSave.push(finalPost);
          queueItems.push({ id: genId(), tipo: 'single' as const, posts: [finalPost], sched: 'Auto', status: 'draft' as const, sel: false });
        } else {
          const groupLinks = item.links;
          const groupPosts = allFetched.slice(offset, offset + groupLinks.length);
          offset += groupLinks.length;
          const compositeImage = await generateMultiPostImage(groupPosts.map(p => p.image)).catch(() => '');
          const multiPosts = groupPosts.map((p, i) => ({
            ...p, layoutId: defaultMultiLay,
            ...(i === 0 && compositeImage ? { generatedImage: compositeImage } : {}),
          }));
          queueItems.push({ id: genId(), tipo: 'multi' as const, posts: multiPosts, sched: 'Auto', status: 'draft' as const, sel: false });
        }
      }

      singlePostsToSave.forEach(p => postsApi.create(p).catch(() => {}));

      const saved: QueueItem[] = [];
      for (const qi of queueItems) {
        try { await autopostApi.create(qi); saved.push(qi); }
        catch (e) { console.error('[creaPost]', e); }
      }

      if (!saved.length) throw new Error('Nessun post salvato nel DB. Riprova.');

      const firstNewIdx = queue.length;
      sessionStorage.setItem('queueJumpIdx', String(firstNewIdx));
      if (priceWarnings.length > 0) sessionStorage.setItem('queuePriceWarnings', JSON.stringify(priceWarnings));
      setQueue(prev => [...prev, ...saved]);
      setNewPostItems([]);
      setNewPostEditingMultiId(null);
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

      {phase === 'input' && (
        <>
          <div className="cbar">
            <div className="cb">
              <div className="cbnum" style={{ color: 'var(--a3)' }}>{singleItems.length}</div>
              <div className="cblb">Singolo</div>
            </div>
            <div className="cb">
              <div className="cbnum" style={{ color: 'var(--am2)' }}>{multiItems.filter(i => i.links.length > 0).length}</div>
              <div className="cblb">Multiplo</div>
            </div>
          </div>

          <SwitchTabs
            options={[['single', 'Singolo'], ['multi', 'Multiplo']]}
            value={mode} onChange={handleModeChange}
          />

          {err && <ErrorBanner>{err}</ErrorBanner>}

          {mode === 'multi' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 16px 2px' }}>
              <button className="hbk" onClick={goToPrevGroup} disabled={currentMultiIdx <= 0}
                style={{ opacity: currentMultiIdx <= 0 ? 0.25 : 1 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width={16} height={16}>
                  <path d="M19 12H5M12 5l-7 7 7 7" />
                </svg>
              </button>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Multiplo {currentMultiIdx + 1} / {multiItems.length}</div>
                <div style={{ fontSize: 11, color: 'var(--t3)' }}>{activeLinks.length} link in questo gruppo</div>
              </div>
              <button className="hbk" onClick={goToNextGroup}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width={16} height={16}>
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}

          <div className="stit">INSERISCI LINK</div>
          <div style={{ padding: '0 16px 10px' }}>
            <div className="irow">
              <input className="inp" value={linkInput} onChange={e => setLinkInput(e.target.value)}
                placeholder="https://amazon.it/... oppure aliexpress.com/..."
                onKeyDown={e => e.key === 'Enter' && sendLink()} />
              <button className="btn bp" onClick={sendLink} style={{ width: 44, padding: 0, flexShrink: 0 }}>+</button>
            </div>
          </div>

          {activeLinks.length > 0 && (
            <>
              <div className="stit">LINK AGGIUNTI ({activeLinks.length})</div>
              {activeLinks.map(l => (
                <div key={l.id} className="llink">
                  <SourceBadge platform={l.platform} />
                  <span className="llink-url">{l.url}</span>
                  <button className="btn bgh bsm" style={{ color: 'var(--re)', padding: '4px 8px', flexShrink: 0 }}
                    onClick={() => removeActiveLink(l.id)}>×</button>
                </div>
              ))}
            </>
          )}

          {mode === 'multi' && (
            <InfoBanner>Da 2 a 6 link per gruppo → 1 post multiplo. Usa le frecce per creare o cambiare gruppo.</InfoBanner>
          )}

          {canCreate && (
            <div style={{ padding: '8px 16px 16px' }}>
              <button className="btn bp bfull" onClick={creaPost}>
                🚀 Crea Post ({itemsToCreate.length})
              </button>
            </div>
          )}

          {createdPosts.length > 0 && (
            <div style={{ padding: canCreate ? '0 16px 16px' : '8px 16px 16px' }}>
              <button className="btn bs bfull" onClick={() => nav('queue')}>
                📋 Vedi coda ({createdPosts.length} bozze)
              </button>
            </div>
          )}

          <div style={{ padding: '4px 16px 8px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {newPostItems.map(item => (
              item.type === 'single'
                ? <SourceBadge key={item.id} platform={item.link.platform} />
                : item.links.map(l => <SourceBadge key={l.id} platform={l.platform} />)
            ))}
          </div>
        </>
      )}

      {phase === 'loading' && (
        <div style={{ padding: '40px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>⏳</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Analisi in corso...</div>
          <div style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 20 }}>{progress} / {loadingTotal} prodotti</div>
          <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--a1)', borderRadius: 3, width: `${loadingTotal > 0 ? (progress / loadingTotal) * 100 : 0}%`, transition: 'width 0.3s' }} />
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

// Tag auto-calcolati — non mostrati come pill (non ha senso editarli)
const AUTO_COMPUTED_TAGS = new Set([
  '{titolo}', '{titoloup}', '{titoloshort}',
  '{prezzo}', '{prezzo_scontato}', '{oldprezzo}',
  '{sconto}', '{perc}', '{valuta}',
  '{link_affiliato}', '{link}',
  '{minimo_storico}',
  '{store}', '{storeup}', '{countryflag}',
  '{giorno}', '{ora}', '{data}',
  '{checkout}',
  // gestiti da campi dedicati nel PostCard:
  '{custom}', '{coupon}', '{boxcoupon}',
]);

type TagPill =
  | { kind: 'system'; tag: string; label: string; field: keyof CreatedPost; placeholder: string }
  | { kind: 'custom'; tag: string; label: string; globalValue: string };

function TagEditButtons({ layout, post, postTags, onUpdate }: {
  layout: { contenuto: string } | undefined;
  post: CreatedPost;
  postTags: Tag[];
  onUpdate: (ch: Partial<CreatedPost>) => void;
}) {
  const [activeTag, setActiveTag] = React.useState<string | null>(null);
  const [tempVal, setTempVal] = React.useState('');

  if (!layout) return null;

  const layoutTags = extractLayoutTags(layout.contenuto);
  const seenFields = new Set<string>();
  const pills: TagPill[] = [];

  for (const tag of layoutTags) {
    if (AUTO_COMPUTED_TAGS.has(tag)) continue;
    const sys = EDITABLE_SYSTEM_TAG_MAP[tag];
    if (sys) {
      if (!seenFields.has(sys.field as string)) {
        seenFields.add(sys.field as string);
        pills.push({ kind: 'system', tag, label: sys.label, field: sys.field, placeholder: sys.placeholder });
      }
      continue;
    }
    // tag personalizzato
    if (!seenFields.has(tag)) {
      seenFields.add(tag);
      const globalTag = postTags.find(t => t.name === tag);
      pills.push({ kind: 'custom', tag, label: tag.replace(/[{}]/g, ''), globalValue: globalTag?.value ?? '' });
    }
  }

  if (pills.length === 0) return null;

  const getCurrentVal = (p: TagPill) => {
    if (p.kind === 'system') return String((post as any)[p.field] || '');
    return post.tagOverrides?.[p.tag] ?? p.globalValue;
  };

  const save = (p: TagPill, val: string) => {
    if (p.kind === 'system') {
      onUpdate({ [p.field]: val } as Partial<CreatedPost>);
    } else {
      onUpdate({ tagOverrides: { ...post.tagOverrides, [p.tag]: val } });
    }
    setActiveTag(null);
  };

  const activePill = pills.find(p => p.tag === activeTag);

  return (
    <div style={{ padding: '0 16px 10px' }}>
      <div className="stit" style={{ padding: '8px 0 6px', margin: 0 }}>TAG NEL LAYOUT</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: activePill ? 8 : 0 }}>
        {pills.map(p => {
          const val = getCurrentVal(p);
          const active = activeTag === p.tag;
          return (
            <button key={p.tag}
              onClick={() => { setActiveTag(active ? null : p.tag); setTempVal(getCurrentVal(p)); }}
              style={{
                padding: '5px 11px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${active ? 'var(--a1)' : val ? 'var(--am2)' : 'var(--bg4)'}`,
                background: active ? 'var(--bg4)' : val ? '#1a1200' : 'var(--bg3)',
                color: active ? 'var(--a1)' : val ? 'var(--am2)' : 'var(--t3)',
              }}>
              {p.label}{val ? `: ${val.length > 14 ? val.slice(0, 14) + '…' : val}` : ''}
            </button>
          );
        })}
      </div>
      {activePill && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input className="inp" style={{ flex: 1 }} autoFocus
            value={tempVal}
            placeholder={activePill.kind === 'system' ? activePill.placeholder : `Valore per ${activePill.label}...`}
            onChange={e => setTempVal(e.target.value)}
            onBlur={() => save(activePill, tempVal)}
            onKeyDown={e => {
              if (e.key === 'Enter') save(activePill, tempVal);
              if (e.key === 'Escape') setActiveTag(null);
            }}
          />
          <button className="btn bgr bsm" style={{ padding: '6px 12px', flexShrink: 0 }}
            onMouseDown={e => { e.preventDefault(); save(activePill, tempVal); }}>✓</button>
        </div>
      )}
    </div>
  );
}

function DynamicTagFields({ layout, post, postTags, itemId, onUpdate }: {
  layout: { contenuto: string } | undefined;
  post: CreatedPost;
  postTags: Tag[];
  itemId: string;
  onUpdate: (id: string, ch: Partial<CreatedPost>) => void | Promise<void>;
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
          <input className="inp" key={`${itemId}-sys-${field as string}`}
            defaultValue={(post[field] as string) || ''} placeholder={placeholder}
            onBlur={e => onUpdate(itemId, { [field]: e.target.value })} />
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
            <input className="inp" key={`${itemId}-tag-${tag}`}
              defaultValue={currentValue} placeholder={`Valore per ${tag}...`}
              onBlur={e => onUpdate(itemId, {
                tagOverrides: { ...(post.tagOverrides ?? {}), [tag]: e.target.value },
              })} />
          </div>
        );
      })}
    </>
  );
}

function resolveMultiPostText(contenuto: string, posts: CreatedPost[], tags: Tag[], currency: string): string {
  if (contenuto.includes('{lista_prodotti}')) {
    const lista = posts.map((p, i) => {
      const cur = p.platform === 'aliexpress' ? currency : '€';
      const title = p.title.length > 55 ? p.title.slice(0, 55) + '…' : p.title;
      return `${i + 1}. ${p.emoji || '📦'} ${title}\n💰 ${cur}${Number(p.discountedPrice).toFixed(2)} (-${p.discountPercent}%)`;
    }).join('\n\n');
    return resolvePostTags(contenuto.replace('{lista_prodotti}', lista), posts[0], tags, currency);
  }
  // Ripeti il template per ogni prodotto
  return posts.map(p => resolvePostTags(contenuto, p, tags, p.platform === 'aliexpress' ? currency : '€')).join('\n');
}

// Estrae le etichette dei pulsanti dal testo di un layout tastiera
function parseKbButtons(contenuto: string | undefined): string[] {
  if (!contenuto?.trim()) return [];
  return contenuto.trim().split('\n')
    .filter(r => r.trim())
    .flatMap(row => row.split('&&').map(btn => {
      const clean = btn.trim().replace(/^#[grb]\s+/, '');
      const lastDash = clean.lastIndexOf(' - ');
      if (lastDash === -1) return null;
      return clean.slice(0, lastDash).trim();
    }).filter((x): x is string => x !== null && x !== ''));
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
  const [priceWarnings, setPriceWarnings] = useState<string[]>([]);
  const [multiEditSelected, setMultiEditSelected] = useState<Set<string>>(new Set());
  const [splittingId, setSplittingId] = useState<string | null>(null);
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSelected, setMergeSelected] = useState<Set<string>>(new Set());
  const [mergingId, setMergingId] = useState(false);
  const touchStartX = useRef(0);

  const safeIdx = Math.min(currentIdx, Math.max(0, queue.length - 1));

  React.useEffect(() => {
    if (queue.length > 0 && currentIdx >= queue.length) setCurrentIdx(queue.length - 1);
  }, [queue.length, currentIdx]);

  React.useEffect(() => {
    const jumpIdx = sessionStorage.getItem('queueJumpIdx');
    if (jumpIdx !== null) {
      setCurrentIdx(Math.max(0, parseInt(jumpIdx) || 0));
      sessionStorage.removeItem('queueJumpIdx');
    }
    const warnings = sessionStorage.getItem('queuePriceWarnings');
    if (warnings) {
      try { setPriceWarnings(JSON.parse(warnings)); } catch {}
      sessionStorage.removeItem('queuePriceWarnings');
    }
  }, []);

  const updateQueuePost = (itemId: string, changes: Partial<CreatedPost>) => {
    setQueue(q => q.map(x => {
      if (x.id !== itemId) return x;
      if (x.tipo === 'multi') {
        // Per multi-post aggiorna solo posts[0] (campi condivisi come layoutId) mantenendo tutti i post
        return { ...x, posts: x.posts.map((p, i) => i === 0 ? { ...p, ...changes } : p) };
      }
      return { ...x, posts: [{ ...x.posts[0], ...changes }] };
    }));
  };

  // Aggiorna un singolo prodotto dentro un post multiplo + persiste nel DB
  const updateMultiPostProduct = async (itemId: string, postId: string, changes: Partial<CreatedPost>) => {
    const qItem = queue.find(x => x.id === itemId);
    if (!qItem) return;
    const updatedPosts = (qItem.posts as CreatedPost[]).map(p =>
      p.id === postId ? { ...p, ...changes } : p
    );
    setQueue(q => q.map(x => x.id === itemId ? { ...x, posts: updatedPosts } : x));
    await autopostApi.update(itemId, { posts: updatedPosts, status: qItem.status }).catch(() => {});
  };

  // Aggiorna post + persiste subito nel DB + rigenera immagine in background
  const updatePostWithImage = async (itemId: string, changes: Partial<CreatedPost>) => {
    const currentItem = queue.find(x => x.id === itemId);
    if (!currentItem || currentItem.tipo === 'multi') return; // multi-post: usa updateQueuePost direttamente
    const updatedPost: CreatedPost = { ...(currentItem.posts[0] as CreatedPost), ...changes };

    // 1. Aggiorna UI subito
    updateQueuePost(itemId, changes);

    // 2. Salva nel DB subito — così il polling non riporta i valori vecchi
    await autopostApi.update(itemId, { posts: [updatedPost], status: currentItem.status }).catch(() => {});

    // 3. Rigenera immagine in background con i nuovi valori
    const tpl = templates.find(t => t.id === updatedPost.templateId);
    if (!tpl) return;
    try {
      const cur = updatedPost.platform === 'aliexpress' ? aliCurrencySym(settings.aliexpress.targetCountry) : '€';
      const generatedImage = await generatePostImage(tpl, updatedPost.image, updatedPost.isHistoricalLow, updatedPost.platform, {
        prezzo: `${cur}${Number(updatedPost.discountedPrice).toFixed(2)}`,
        prezzoPrecedente: `${cur}${Number(updatedPost.originalPrice).toFixed(2)}`,
        sconto: `-${updatedPost.discountPercent}%`,
        testoCustom: updatedPost.customText,
      });
      pregenImages.current[itemId] = generatedImage;
      updateQueuePost(itemId, { generatedImage });
      autopostApi.update(itemId, { posts: [{ ...updatedPost, generatedImage }], status: currentItem.status }).catch(() => {});
    } catch {}
  };

  // Cache immagini pre-generate: key = queue item id, value = base64 jpeg
  const pregenImages = React.useRef<Record<string, string>>({});

  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  const regenerate = async (itemId: string) => {
    const item = queue.find(x => x.id === itemId);
    if (!item || regeneratingId) return;
    setRegeneratingId(itemId);
    try {
      const posts = item.posts as CreatedPost[];
      const freshPosts = await Promise.all(posts.map(async post => {
        try {
          const freshData = post.platform === 'amazon'
            ? await productApi.fetchAmazon({ url: post.sourceUrl })
            : await productApi.fetchAliExpress({ url: post.sourceUrl });
          return {
            ...post,
            title: freshData.title,
            image: freshData.image,
            originalPrice: freshData.originalPrice,
            discountedPrice: freshData.discountedPrice,
            discountPercent: freshData.discountPercent,
            sourceUrl: (freshData as any).affiliateUrl || post.sourceUrl,
            stelle: (freshData as any).stelle ?? post.stelle,
            recensioni: (freshData as any).recensioni ?? post.recensioni,
            cat: (freshData as any).cat ?? post.cat,
            author: (freshData as any).author ?? post.author,
            coupon: (freshData as any).coupon ?? post.coupon,
          } as CreatedPost;
        } catch { return post; }
      }));
      let finalPosts = freshPosts;
      if (item.tipo === 'single') {
        const post = freshPosts[0];
        const tpl = templates.find(t => t.id === post.templateId);
        if (tpl) {
          try {
            const cur = post.platform === 'aliexpress' ? aliCurrencySym(settings.aliexpress.targetCountry) : '€';
            const generatedImage = await generatePostImage(tpl, post.image, post.isHistoricalLow, post.platform, {
              prezzo: `${cur}${Number(post.discountedPrice).toFixed(2)}`,
              prezzoPrecedente: `${cur}${Number(post.originalPrice).toFixed(2)}`,
              sconto: `-${post.discountPercent}%`, testoCustom: post.customText,
            });
            finalPosts = [{ ...post, generatedImage }];
            pregenImages.current[itemId] = generatedImage;
          } catch {}
        }
      } else {
        const compositeImage = await generateMultiPostImage(freshPosts.map(p => p.image)).catch(() => '');
        finalPosts = freshPosts.map((p, i) => i === 0 && compositeImage ? { ...p, generatedImage: compositeImage } : p);
      }
      setQueue(q => q.map(x => x.id === itemId ? { ...x, posts: finalPosts } : x));
      await autopostApi.update(itemId, { posts: finalPosts, status: item.status }).catch(() => {});
    } catch (e) {
      setPublishErr(`Rigenera: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRegeneratingId(null);
    }
  };

  // Pre-genera l'immagine del post corrente non appena viene visualizzato
  React.useEffect(() => {
    const currentItem = queue[safeIdx];
    if (!currentItem) return;
    const currentPost = currentItem.posts[0] as CreatedPost | undefined;
    if (!currentPost) return;
    const tpl = templates.find(t => t.id === currentPost.templateId);
    if (!tpl || pregenImages.current[currentItem.id]) return;

    generatePostImage(tpl, currentPost.image, currentPost.isHistoricalLow, currentPost.platform, {
      prezzo: `€${Number(currentPost.discountedPrice).toFixed(2)}`,
      prezzoPrecedente: `€${Number(currentPost.originalPrice).toFixed(2)}`,
      sconto: `-${currentPost.discountPercent}%`,
      testoCustom: currentPost.customText,
    }).then(img => { pregenImages.current[currentItem.id] = img; }).catch(() => {});
  }, [safeIdx, queue, templates]);

  // Divide un post multiplo: rimuove i selezionati, rigenera l'originale, crea nuovi post
  const splitMulti = async (sourceItem: QueueItem, selectedIds: Set<string>, mode: 'singles' | 'multi') => {
    const allPosts = sourceItem.posts as CreatedPost[];
    const selectedPosts = allPosts.filter(mp => selectedIds.has(mp.id));
    const remainingPosts = allPosts.filter(mp => !selectedIds.has(mp.id));
    if (selectedPosts.length === 0) return;
    if (mode === 'multi' && selectedPosts.length < 2) return;
    setSplittingId(sourceItem.id);
    try {
      const genSingle = async (mp: CreatedPost): Promise<CreatedPost> => {
        // Assegna il layout/keyboard standard per post singolo (non quello del multiplo)
        const defaultLay = layouts.find(l => l.tipo === (mp.platform === 'aliexpress' ? 'aliexpress' : 'normal'));
        const layoutId = defaultLay?.id ?? mp.layoutId;
        const keyboardId = defaultLay?.keyboardId ?? keyboards[0]?.id ?? mp.keyboardId;
        const mpWithLayout: CreatedPost = { ...mp, layoutId, keyboardId };
        const tpl = templates.find(t => t.id === mpWithLayout.templateId);
        if (!tpl) return mpWithLayout;
        const cur = mpWithLayout.platform === 'aliexpress' ? aliCurrencySym(settings.aliexpress.targetCountry) : '€';
        const generatedImage = await generatePostImage(tpl, mpWithLayout.image, mpWithLayout.isHistoricalLow, mpWithLayout.platform, {
          prezzo: `${cur}${Number(mpWithLayout.discountedPrice).toFixed(2)}`,
          prezzoPrecedente: `${cur}${Number(mpWithLayout.originalPrice).toFixed(2)}`,
          sconto: `-${mpWithLayout.discountPercent}%`, testoCustom: mpWithLayout.customText,
        }).catch(() => undefined);
        return generatedImage ? { ...mpWithLayout, generatedImage } : mpWithLayout;
      };
      const genMultiComposite = async (posts: CreatedPost[]): Promise<CreatedPost[]> => {
        const composite = await generateMultiPostImage(posts.map(p => p.image)).catch(() => '');
        return posts.map((p, i) => i === 0 && composite ? { ...p, generatedImage: composite } : p);
      };

      // 1. Nuovi post da creare
      const newItems: QueueItem[] = [];
      if (mode === 'singles') {
        const readyPosts = await Promise.all(selectedPosts.map(genSingle));
        for (const rp of readyPosts) {
          newItems.push({ id: genId(), tipo: 'single', posts: [rp], sched: sourceItem.sched, status: 'draft', sel: false });
        }
      } else {
        const postsWithImg = await genMultiComposite(selectedPosts);
        newItems.push({ id: genId(), tipo: 'multi', posts: postsWithImg, sched: sourceItem.sched, status: 'draft', sel: false });
      }

      // 2. Aggiorna/elimina il post originale
      const insertAfterIdx = queue.findIndex(x => x.id === sourceItem.id);
      if (remainingPosts.length === 0) {
        // Elimina originale
        autopostApi.delete(sourceItem.id).catch(() => {});
        const newQueue = queue.filter(x => x.id !== sourceItem.id);
        newQueue.splice(Math.max(0, insertAfterIdx), 0, ...newItems);
        setQueue(newQueue);
        setCurrentIdx(i => Math.min(i, newQueue.length - 1));
      } else {
        let updatedItem: QueueItem;
        if (remainingPosts.length === 1) {
          const rp = await genSingle(remainingPosts[0]);
          updatedItem = { ...sourceItem, tipo: 'single', posts: [rp] };
        } else {
          const postsWithImg = await genMultiComposite(remainingPosts);
          updatedItem = { ...sourceItem, posts: postsWithImg };
        }
        // Aggiorna DB prima di aggiornare UI, così il polling non sovrascrive
        await autopostApi.update(sourceItem.id, { posts: updatedItem.posts, status: sourceItem.status }).catch(() => {});
        const newQueue = [...queue];
        newQueue[insertAfterIdx] = updatedItem;
        newQueue.splice(insertAfterIdx + 1, 0, ...newItems);
        setQueue(newQueue);
      }

      await Promise.all(newItems.map(ni => autopostApi.create(ni).catch(() => {})));
      setMultiEditSelected(new Set());
      setExpandedId(null);
    } catch (e) {
      setPublishErr(`Errore split: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSplittingId(null);
    }
  };

  // Unisce i post selezionati in un unico post multiplo
  const mergeIntoMulti = async () => {
    const selectedItems = queue.filter(x => mergeSelected.has(x.id));
    if (selectedItems.length < 2) return;
    const allPosts: CreatedPost[] = selectedItems.flatMap(qi => qi.posts as CreatedPost[]);
    if (allPosts.length > 6) { setPublishErr('Troppi prodotti: massimo 6 per post multiplo'); return; }
    setMergingId(true);
    try {
      const composite = await generateMultiPostImage(allPosts.map(p => p.image)).catch(() => '');
      const mergedPosts: CreatedPost[] = allPosts.map((p, i) =>
        i === 0 && composite ? { ...p, generatedImage: composite } : p
      );
      const firstIdx = queue.findIndex(x => mergeSelected.has(x.id));
      const newItem: QueueItem = {
        id: genId(), tipo: 'multi',
        posts: mergedPosts,
        sched: selectedItems[0].sched,
        status: 'draft', sel: false,
      };
      // DB: crea nuovo, cancella selezionati
      await autopostApi.create(newItem).catch(() => {});
      await Promise.all(selectedItems.map(x => autopostApi.delete(x.id).catch(() => {})));
      // UI: inserisci nuovo al posto del primo selezionato, rimuovi gli altri
      const newQueue = queue.filter(x => !mergeSelected.has(x.id));
      newQueue.splice(firstIdx, 0, newItem);
      setQueue(newQueue);
      setCurrentIdx(Math.max(0, Math.min(firstIdx, newQueue.length - 1)));
      setMergeSelected(new Set());
      setMergeMode(false);
    } catch (e) {
      setPublishErr(`Errore unione: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setMergingId(false);
    }
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

    setPublishingId(id);

    // Rimuovi subito dalla UI + marca come published nel DB (fire-and-forget — non blocca la UI)
    setQueue(q => q.filter(x => x.id !== id));
    setCurrentIdx(i => Math.max(0, Math.min(i, queue.length - 2)));
    autopostApi.update(id, { status: 'published' }).catch(() => {});

    try {
      let generatedImage: string | undefined;

      // ── Post multiplo: usa la griglia composita + testo/tastiera espansi ──
      if (item.tipo === 'multi') {
        const multiPosts = item.posts as CreatedPost[];
        const multiCurrency = multiPosts[0]?.platform === 'aliexpress' ? aliCurrencySym(settings.aliexpress.targetCountry) : '€';
        const layoutContenuto = layout?.contenuto ?? '';
        let expandedLayout: string;
        if (layoutContenuto.includes('{lista_prodotti}')) {
          const lista = multiPosts.map((mp, i) => {
            const cur = mp.platform === 'aliexpress' ? multiCurrency : '€';
            const title = mp.title.length > 55 ? mp.title.slice(0, 55) + '…' : mp.title;
            return `${i + 1}. ${mp.emoji || '📦'} ${title}\n💰 ${cur}${Number(mp.discountedPrice).toFixed(2)} (-${mp.discountPercent}%)`;
          }).join('\n\n');
          expandedLayout = layoutContenuto.replace('{lista_prodotti}', lista);
        } else {
          const defaultMultiLayout = '{_<b>{custom}</b>_}\n<b>{titoloshort}</b>\n💶 A soli: <b>{prezzo}{valuta}</b> invece di: <s>{oldprezzo}€</s>\n{_🎟 <b>Coupon:</b> {coupon}_}\n👉 <a href="{link}">APRI SU AMAZON</a>\n➿➿➿➿➿➿➿➿➿➿➿➿';
          const template = layoutContenuto || defaultMultiLayout;
          expandedLayout = multiPosts.map(mp => {
            const cur = mp.platform === 'aliexpress' ? multiCurrency : '€';
            return resolvePostTags(template, mp, tags, cur);
          }).join('\n');
        }
        const layoutKb = layout?.keyboardId ? keyboards.find(k => k.id === layout.keyboardId) : null;
        const multiKeyboard = layoutKb?.contenuto;
        generatedImage = (post as any).generatedImage;
        if (!generatedImage) {
          generatedImage = await generateMultiPostImage(multiPosts.map(mp => mp.image)).catch(() => undefined);
        }
        const pubResult = await postsApi.publish(post.id, {
          post, layoutContenuto: expandedLayout, keyboardContenuto: multiKeyboard, generatedImage,
        });
        autopostApi.delete(id).catch(() => {});
        const now = new Date().toISOString();
        const pubRecord = {
          id: post.id, emoji: '🗂️', title: `Post multiplo (${multiPosts.length} prodotti)`,
          price: '0.00', originalPrice: 0, discountPercent: 0,
          platform: post.platform, image: post.image,
          sourceUrl: post.sourceUrl, productId: post.productId,
          customText: post.customText, layoutId: post.layoutId,
          isHistoricalLow: false,
          chatId: pubResult.chatId ?? '', messageId: pubResult.messageId ?? 0,
          publishedAt: now, ts: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
        };
        setPublished(prev => [pubRecord, ...prev]);
        publishedApi.save(pubRecord).catch(() => {});
        setPublishingId(null);
        return;
      }

      // ── Post singolo ───────────────────────────────────────────────────────
      if (template) {
        try {
          // Usa l'immagine pre-generata se disponibile (pronta in background da quando il post era visibile)
          generatedImage = pregenImages.current[id] ?? await generatePostImage(
            template, post.image, post.isHistoricalLow, post.platform, {
              prezzo: `€${Number(post.discountedPrice).toFixed(2)}`,
              prezzoPrecedente: `€${Number(post.originalPrice).toFixed(2)}`,
              sconto: `-${post.discountPercent}%`,
              testoCustom: post.customText,
            }
          );
        } catch { /* fall back to URL */ }
      }
      const effectiveKbId = layout?.keyboardId ?? post.keyboardId;
      const keyboard = keyboards.find(k => k.id === effectiveKbId) ?? keyboards[0];
      const pubResult = await postsApi.publish(post.id, { post, layoutContenuto: layout?.contenuto, keyboardContenuto: keyboard?.contenuto, generatedImage });
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
  const isMultiPost = item?.tipo === 'multi';
  const p = item?.posts[0] as CreatedPost | undefined;
  const template = p ? templates.find(t => t.id === p.templateId) : undefined;
  const layout = p ? layouts.find(l => l.id === p.layoutId) : undefined;
  const qCurrency = p?.platform === 'aliexpress' ? aliCurrencySym(settings.aliexpress.targetCountry) : '€';
  const previewText = layout && p
    ? (isMultiPost
        ? resolveMultiPostText(layout.contenuto, item.posts as CreatedPost[], tags, qCurrency)
        : resolvePostTags(layout.contenuto, p, tags, qCurrency))
    : '';
  // Bottoni tastiera reale per la preview
  const effectiveKbId = layout?.keyboardId ?? (isMultiPost ? undefined : p?.keyboardId);
  const effectiveKb = keyboards.find(k => k.id === effectiveKbId);
  const kbButtons: string[] | undefined = effectiveKb
    ? parseKbButtons(effectiveKb.contenuto)
    : (isMultiPost ? undefined : [`🛒 Compra su ${p?.platform === 'amazon' ? 'Amazon' : 'AliExpress'}`]);
  const isEditing = expandedId === item?.id;

  // Post in coda già pubblicati oggi (con posizione aggiornata dinamicamente)
  const publishedIds = new Set(published.map(pub => pub.productId));
  const duplicatesInQueue = queue
    .map((qi, idx) => ({ qi, pos: idx + 1 }))
    .filter(({ qi }) => {
      const post = qi.posts[0] as CreatedPost | undefined;
      return post?.productId && publishedIds.has(post.productId);
    });

  return (
    <div className="pg">
      <PageHeader title="Coda AutoPost" onBack={() => nav('dash')} badge={queue.length}
        right={
          <div style={{ display: 'flex', gap: 5 }}>
            <button className="btn bsm" style={{ background: mergeMode ? 'var(--a1)' : 'var(--bg3)', color: mergeMode ? '#fff' : 'var(--t1)', border: '1px solid var(--bd)' }}
              onClick={() => { setMergeMode(m => !m); setMergeSelected(new Set()); }}>
              ☑️ Combina
            </button>
            <button className="btn bre bsm" onClick={() => { if (window.confirm('Svuotare tutta la coda?')) clearAll(); }}>
              🗑️ Svuota
            </button>
          </div>
        }
      />

      {/* Banner post già pubblicati */}
      {duplicatesInQueue.length > 0 && (
        <div style={{
          margin: '8px 16px 0', padding: '10px 14px', borderRadius: 10,
          background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.35)',
          fontSize: 12, color: '#f59e0b',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            ⚠️ {duplicatesInQueue.length} post {duplicatesInQueue.length === 1 ? 'già pubblicato' : 'già pubblicati'} in coda
          </div>
          {duplicatesInQueue.map(({ qi, pos }) => {
            const qp = qi.posts[0] as CreatedPost;
            const pub = published.find(pb => pb.productId === qp.productId);
            return (
              <div key={qi.id} style={{ color: 'var(--t2)', marginTop: 2 }}>
                · <span style={{ fontWeight: 700, color: '#f59e0b' }}>#{pos}</span>{' '}
                {qp.emoji} {qp.title.slice(0, 38)}{qp.title.length > 38 ? '…' : ''}
                {pub && <span style={{ color: 'var(--t3)', marginLeft: 4 }}>({pub.ts})</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* Banner prezzi zero */}
      {priceWarnings.length > 0 && (
        <div style={{
          margin: '8px 16px 0', padding: '10px 14px', borderRadius: 10,
          background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.35)',
          fontSize: 12, color: '#ef4444',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
            <span>⚠️ {priceWarnings.length} post con prezzo non trovato — modifica manualmente</span>
            <span style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => setPriceWarnings([])}>✕</span>
          </div>
          {priceWarnings.map((w, i) => (
            <div key={i} style={{ color: 'var(--t2)', marginTop: 2 }}>· {w}</div>
          ))}
        </div>
      )}

      {/* Contatore + navigazione frecce */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px 4px', gap: 8 }}>
        <button className="hbk" disabled={safeIdx === 0} style={{ opacity: safeIdx === 0 ? 0.25 : 1 }}
          onClick={() => { setCurrentIdx(i => i - 1); setExpandedId(null); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width={16} height={16}>
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
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
        <button className="hbk" disabled={safeIdx === queue.length - 1} style={{ opacity: safeIdx === queue.length - 1 ? 0.25 : 1 }}
          onClick={() => { setCurrentIdx(i => i + 1); setExpandedId(null); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width={16} height={16}>
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
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

      {/* Pannello Combina — modalità selezione multipla */}
      {mergeMode && (
        <div style={{ margin: '0 16px 8px', background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--a1)', overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--a1)' }}>
              ☑️ COMBINA IN MULTIPLO
            </div>
            <div style={{ fontSize: 11, color: 'var(--t3)' }}>
              {mergeSelected.size > 0 ? `${mergeSelected.size} selezionati` : 'Seleziona ≥ 2 post'}
            </div>
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto', padding: '4px 8px' }}>
            {queue.map((qi, idx) => {
              const qp = qi.posts[0] as CreatedPost;
              const sel = mergeSelected.has(qi.id);
              const totalPosts = (() => {
                const curSelected = [...mergeSelected].filter(id => id !== qi.id);
                const totalIfAdded = [...curSelected, qi.id].reduce((sum, id) => {
                  const qx = queue.find(x => x.id === id);
                  return sum + (qx ? qx.posts.length : 0);
                }, 0);
                return totalIfAdded;
              })();
              const wouldExceed = !sel && totalPosts > 6;
              return (
                <div key={qi.id}
                  onClick={() => {
                    if (wouldExceed) { setPublishErr('Massimo 6 prodotti per post multiplo'); return; }
                    setMergeSelected(prev => { const n = new Set(prev); if (n.has(qi.id)) n.delete(qi.id); else n.add(qi.id); return n; });
                    setPublishErr(null);
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                    borderRadius: 8, marginBottom: 3, cursor: wouldExceed ? 'not-allowed' : 'pointer',
                    background: sel ? 'rgba(99,102,241,0.15)' : 'var(--bg3)',
                    border: `1px solid ${sel ? 'var(--a1)' : 'transparent'}`,
                    opacity: wouldExceed ? 0.4 : 1,
                  }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                    border: `2px solid ${sel ? 'var(--a1)' : 'var(--t3)'}`,
                    background: sel ? 'var(--a1)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {sel && <span style={{ fontSize: 10, color: '#fff', fontWeight: 700 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--t3)', width: 18, flexShrink: 0 }}>#{idx + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {qi.tipo === 'multi' ? `🗂️ Multiplo (${qi.posts.length}) — ` : ''}{qp.title.slice(0, 40)}{qp.title.length > 40 ? '…' : ''}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--t2)' }}>
                      {qi.tipo === 'multi' ? `${qi.posts.length} prodotti` : `${qCurrency}${Number(qp.discountedPrice).toFixed(2)} -${qp.discountPercent}%`}
                    </div>
                  </div>
                  <SourceBadge platform={qp.platform} />
                </div>
              );
            })}
          </div>
          {mergeSelected.size >= 2 && (
            <div style={{ padding: '8px 12px' }}>
              <button className="btn bp bfull" disabled={mergingId}
                onClick={mergeIntoMulti}>
                {mergingId ? '⏳ Elaborazione...' : `🗂️ Crea 1 multiplo da ${[...mergeSelected].reduce((sum, id) => { const qi = queue.find(x => x.id === id); return sum + (qi ? qi.posts.length : 0); }, 0)} prodotti`}
              </button>
            </div>
          )}
        </div>
      )}

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
            <button className="btn bgh bsm" style={{ flexShrink: 0 }}
              onClick={() => regenerate(item.id)}
              disabled={!!regeneratingId}>
              {regeneratingId === item.id ? '⏳' : '🔄'}
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

          {/* Anteprima immagine */}
          {isMultiPost ? (
            <div style={{ margin: '0 16px 8px', borderRadius: 12, overflow: 'hidden', background: 'var(--bg3)' }}>
              {(p as any).generatedImage
                ? <img src={(p as any).generatedImage} alt="multi" style={{ width: '100%', display: 'block' }} />
                : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 8 }}>
                    {(item.posts as CreatedPost[]).slice(0, 6).map(mp => (
                      <img key={mp.id} src={`/api/posts?img=${encodeURIComponent(mp.image)}`}
                        alt="" style={{ width: 'calc(33% - 4px)', aspectRatio: '1', objectFit: 'contain', background: '#fff', borderRadius: 6 }} />
                    ))}
                  </div>
              }
            </div>
          ) : (
            <TemplateImagePreview post={p} template={template} />
          )}

          {/* Testo completo OPPURE form modifica */}
          {!isEditing ? (
            <div style={{ padding: '0 16px 24px' }}>
              <TelegramPreview text={previewText} buttons={kbButtons} />
            </div>
          ) : isMultiPost ? (
            // ── Pannello modifica post multiplo ──
            <div style={{ padding: '12px 16px 28px', borderTop: '1px solid var(--bd)' }}>
              <div className="stit">POST MULTIPLO — {item.posts.length} PRODOTTI</div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8 }}>
                Tocca la riga per selezionare · modifica titolo e prezzi nei campi sotto
              </div>
              {(item.posts as CreatedPost[]).map((mp, idx) => {
                const sel = multiEditSelected.has(mp.id);
                return (
                  <div key={mp.id} style={{ marginBottom: 8 }}>
                    {/* Header selezionabile */}
                    <div
                      onClick={() => setMultiEditSelected(prev => {
                        const n = new Set(prev);
                        if (n.has(mp.id)) n.delete(mp.id); else n.add(mp.id);
                        return n;
                      })}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 10px', borderRadius: sel ? '8px 8px 0 0' : 8, cursor: 'pointer',
                        background: sel ? 'rgba(99,102,241,0.15)' : 'var(--bg3)',
                        border: `1px solid ${sel ? 'var(--a1)' : 'transparent'}`,
                      }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                        border: `2px solid ${sel ? 'var(--a1)' : 'var(--t3)'}`,
                        background: sel ? 'var(--a1)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {sel && <span style={{ fontSize: 11, color: '#fff', fontWeight: 700 }}>✓</span>}
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--t3)', width: 16, flexShrink: 0 }}>{idx + 1}.</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mp.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--t2)' }}>{qCurrency}{Number(mp.discountedPrice).toFixed(2)} (-{mp.discountPercent}%)</div>
                      </div>
                      <SourceBadge platform={mp.platform} />
                    </div>
                    {/* Campi modifica sempre visibili */}
                    <div style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '8px 10px' }}>
                      <input className="inp" style={{ marginBottom: 6, fontSize: 12 }}
                        key={item.id + '-' + mp.id + '-title'} defaultValue={mp.title}
                        placeholder="Titolo"
                        onBlur={e => updateMultiPostProduct(item.id, mp.id, { title: e.target.value })} />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <div style={{ flex: 1 }}>
                          <div className="lbl" style={{ fontSize: 10 }}>PREZZO ORIG.</div>
                          <input className="inp" type="text" inputMode="decimal" style={{ fontSize: 12 }}
                            key={item.id + '-' + mp.id + '-orig'} defaultValue={mp.originalPrice}
                            onBlur={e => {
                              const orig = parseFloat(e.target.value.replace(',', '.')) || 0;
                              const pct = orig > 0 ? Math.round((1 - mp.discountedPrice / orig) * 100) : 0;
                              updateMultiPostProduct(item.id, mp.id, { originalPrice: orig, discountPercent: Math.max(0, pct) });
                            }} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div className="lbl" style={{ fontSize: 10 }}>PREZZO SCONT.</div>
                          <input className="inp" type="text" inputMode="decimal" style={{ fontSize: 12 }}
                            key={item.id + '-' + mp.id + '-disc'} defaultValue={mp.discountedPrice}
                            onBlur={e => {
                              const disc = parseFloat(e.target.value.replace(',', '.')) || 0;
                              const pct = mp.originalPrice > 0 ? Math.round((1 - disc / mp.originalPrice) * 100) : 0;
                              updateMultiPostProduct(item.id, mp.id, { discountedPrice: disc, discountPercent: Math.max(0, pct) });
                            }} />
                        </div>
                      </div>
                      <div className="lbl" style={{ fontSize: 10, marginTop: 6 }}>TESTO PERSONALIZZATO ({'{custom}'})</div>
                      <input className="inp" style={{ marginBottom: 6, fontSize: 12 }}
                        key={item.id + '-' + mp.id + '-custom'} defaultValue={mp.customText}
                        placeholder="Testo personalizzato..."
                        onBlur={e => updateMultiPostProduct(item.id, mp.id, { customText: e.target.value })} />
                      <div className="lbl" style={{ fontSize: 10 }}>COUPON ({'{coupon}'})</div>
                      <input className="inp" style={{ fontSize: 12 }}
                        key={item.id + '-' + mp.id + '-coupon'} defaultValue={mp.coupon ?? ''}
                        placeholder="es. SCONTO10"
                        onBlur={e => updateMultiPostProduct(item.id, mp.id, { coupon: e.target.value || undefined })} />
                    </div>
                  </div>
                );
              })}

              {multiEditSelected.size > 0 && (
                <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                  {/* Elimina selezionati — rigenera immagine dell'originale con i rimanenti */}
                  <button className="btn bre bsm" disabled={!!splittingId}
                    onClick={async () => {
                      const remaining = (item.posts as CreatedPost[]).filter(mp => !multiEditSelected.has(mp.id));
                      if (remaining.length === 0) { del(item.id); setMultiEditSelected(new Set()); return; }
                      setSplittingId(item.id);
                      try {
                        let updatedPosts: CreatedPost[];
                        if (remaining.length === 1) {
                          const tpl = templates.find(t => t.id === remaining[0].templateId);
                          if (tpl) {
                            const cur = remaining[0].platform === 'aliexpress' ? aliCurrencySym(settings.aliexpress.targetCountry) : '€';
                            const gi = await generatePostImage(tpl, remaining[0].image, remaining[0].isHistoricalLow, remaining[0].platform, {
                              prezzo: `${cur}${Number(remaining[0].discountedPrice).toFixed(2)}`,
                              prezzoPrecedente: `${cur}${Number(remaining[0].originalPrice).toFixed(2)}`,
                              sconto: `-${remaining[0].discountPercent}%`, testoCustom: remaining[0].customText,
                            }).catch(() => undefined);
                            updatedPosts = gi ? [{ ...remaining[0], generatedImage: gi }] : remaining;
                          } else { updatedPosts = remaining; }
                        } else {
                          const composite = await generateMultiPostImage(remaining.map(p => p.image)).catch(() => '');
                          updatedPosts = remaining.map((p, i) => i === 0 && composite ? { ...p, generatedImage: composite } : p);
                        }
                        const tipo = remaining.length === 1 ? 'single' as const : 'multi' as const;
                        const updated = { ...item, posts: updatedPosts, tipo };
                        // Aggiorna DB prima di aggiornare UI — evita il reset dal polling
                        await autopostApi.update(item.id, { posts: updatedPosts, status: item.status }).catch(() => {});
                        setQueue(q => q.map(x => x.id === item.id ? updated : x));
                        setMultiEditSelected(new Set());
                      } finally { setSplittingId(null); }
                    }}>
                    {splittingId === item.id ? '⏳' : `🗑️ Rimuovi ${multiEditSelected.size}`}
                  </button>

                  {/* Crea singoli: rimuove i selezionati dall'originale, genera immagini per entrambi */}
                  <button className="btn bsm" disabled={!!splittingId}
                    style={{ background: 'var(--bg3)', color: 'var(--a1)', border: '1px solid var(--a1)' }}
                    onClick={() => splitMulti(item, multiEditSelected, 'singles')}>
                    {splittingId === item.id ? '⏳' : `📦 Crea ${multiEditSelected.size} singoli`}
                  </button>

                  {/* Crea multiplo: rimuove i selezionati dall'originale, genera immagini per entrambi */}
                  {multiEditSelected.size >= 2 && (
                    <button className="btn bsm" disabled={!!splittingId}
                      style={{ background: 'var(--bg3)', color: 'var(--am2)', border: '1px solid var(--am2)' }}
                      onClick={() => splitMulti(item, multiEditSelected, 'multi')}>
                      {splittingId === item.id ? '⏳' : `🗂️ Crea multiplo (${multiEditSelected.size})`}
                    </button>
                  )}
                </div>
              )}

              <div style={{ marginTop: 12, marginBottom: 10 }}>
                <div className="lbl">LAYOUT TESTO</div>
                <select className="sel" value={p.layoutId} onChange={e => updateQueuePost(item.id, { layoutId: e.target.value })}>
                  {layouts.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
                </select>
              </div>
              {previewText && (
                <>
                  <div className="stit">ANTEPRIMA TESTO</div>
                  <TelegramPreview text={previewText} buttons={kbButtons} />
                </>
              )}
            </div>
          ) : (
            // ── Pannello modifica post singolo ──
            <div style={{ padding: '12px 16px 28px', borderTop: '1px solid var(--bd)' }}>
              <div style={{ marginBottom: 10 }}>
                <div className="lbl">TITOLO</div>
                <input className="inp" defaultValue={p.title} key={item.id + '-title'}
                  onBlur={e => updatePostWithImage(item.id, { title: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                <div style={{ flex: 1 }}>
                  <div className="lbl">PREZZO ORIG.</div>
                  <input className="inp" type="text" inputMode="decimal"
                    key={item.id + '-orig'} defaultValue={p.originalPrice}
                    onBlur={e => {
                      const orig = parseFloat(e.target.value.replace(',', '.')) || 0;
                      const pct = orig > 0 ? Math.round((1 - p.discountedPrice / orig) * 100) : 0;
                      updatePostWithImage(item.id, { originalPrice: orig, discountPercent: Math.max(0, pct) });
                    }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="lbl">PREZZO SCONT.</div>
                  <input className="inp" type="text" inputMode="decimal"
                    key={item.id + '-disc'} defaultValue={p.discountedPrice}
                    onBlur={e => {
                      const disc = parseFloat(e.target.value.replace(',', '.')) || 0;
                      const pct = p.originalPrice > 0 ? Math.round((1 - disc / p.originalPrice) * 100) : 0;
                      updatePostWithImage(item.id, { discountedPrice: disc, discountPercent: Math.max(0, pct) });
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
                    const isAli = p.platform === 'aliexpress';
                    const layId = v
                      ? (layouts.find(l => l.tipo === (isAli ? 'aliexpress_historical_low' : 'historical_low'))?.id ?? p.layoutId)
                      : (layouts.find(l => l.tipo === (isAli ? 'aliexpress' : 'normal'))?.id ?? p.layoutId);
                    updatePostWithImage(item.id, { isHistoricalLow: v, layoutId: layId });
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
                <textarea className="txta" rows={2} key={item.id + '-custom'}
                  defaultValue={p.customText}
                  onBlur={e => updatePostWithImage(item.id, { customText: e.target.value })}
                  placeholder="Testo aggiuntivo..." />
              </div>
              <DynamicTagFields
                layout={layout}
                post={p}
                postTags={tags}
                itemId={item.id}
                onUpdate={updatePostWithImage}
              />
              {previewText && (
                <>
                  <div className="stit">ANTEPRIMA TESTO</div>
                  <TelegramPreview text={previewText} buttons={kbButtons} />
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
