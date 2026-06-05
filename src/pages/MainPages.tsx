import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { NavPage, CreatedPost, QueueItem, Platform, Template, Tag, TextLayout, LinkItem, NewPostItem, PublishedMultiItem } from '../types';
import { PageHeader, SourceBadge, StatusBadge, SwitchTabs, EmptyState, InfoBanner, ErrorBanner, ToggleRow, TelegramPreview } from '../components/Shared';
import { genId } from '../data/mock';
import { detectAmazonLink } from '../services/amazonService';
import { resolvePostTags, aliCurrencySym, SYSTEM_TAGS } from '../utils/tagUtils';
import { productApi, postsApi, autopostApi, publishedApi, utilsApi, dealsApi, dealsCacheApi, settingsApi, channelInfoApi, DealProduct } from '../lib/api';
import { generatePostImage, generateMultiPostImage, generateTerminataImage, generateMultiTerminataImage, applyCurrPos, applyDecimalSep, applySconto } from '../utils/imageCompose';
import { getProductEmoji, shortenTitle } from '../lib/titleFormat';

// ── Channel Switcher ──────────────────────────────────────────────────────────
function ChannelSwitcher() {
  const { allChannels, activeProfileId, setActiveProfileId } = useApp();
  const [infoCache, setInfoCache] = useState<Record<string, { photoUrl: string | null; title: string } | null>>({});

  const getBaseUserId = (): string => {
    try { return String((window as any).Telegram?.WebApp?.initDataUnsafe?.user?.id ?? ''); } catch { return ''; }
  };
  const baseUserId = getBaseUserId();
  const channels = allChannels.filter(Boolean);
  const activeChannel = activeProfileId.includes(':')
    ? activeProfileId.split(':').slice(1).join(':')
    : (channels[0] ?? '');

  useEffect(() => {
    channels.forEach(ch => {
      if (infoCache[ch] !== undefined) return; // già in cache (anche null = già tentato)
      setInfoCache(prev => ({ ...prev, [ch]: null })); // segna "in corso"
      channelInfoApi.get(ch)
        .then(info => setInfoCache(prev => ({ ...prev, [ch]: info })))
        .catch(() => setInfoCache(prev => ({ ...prev, [ch]: { photoUrl: null, title: '' } })));
    });
  }, [channels.join(',')]); // dipendenza derivata, join è stabile

  if (channels.length < 1) return null;

  const canSwitch = channels.length >= 2;
  const switchToNext = () => {
    if (!canSwitch) return;
    const idx = channels.indexOf(activeChannel);
    const next = channels[(idx + 1) % channels.length];
    const newProfile = (next === channels[0]) ? baseUserId : `${baseUserId}:${next}`;
    setActiveProfileId(newProfile);
  };

  const info = infoCache[activeChannel];
  // Usa il nome del canale solo se è una stringa non-numerica (non l'ID)
  const rawTitle = info?.title ?? '';
  const isNumericId = /^-?\d+$/.test(rawTitle.trim());
  const displayName = (!isNumericId && rawTitle) ? rawTitle : activeChannel;
  const shortName = displayName.length > 15 ? displayName.slice(0, 14) + '…' : displayName;

  // Avatar: foto se disponibile, altrimenti icona 📢
  const hasPhoto = !!info?.photoUrl;

  return (
    <div
      onClick={switchToNext}
      title={canSwitch ? 'Clicca per cambiare canale' : ''}
      className="stat"
      style={{
        cursor: canSwitch ? 'pointer' : 'default', userSelect: 'none',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 4, padding: '6px 8px',
      }}
    >
      {/* Avatar circolare grande */}
      <div style={{
        width: 46, height: 46, borderRadius: '50%',
        overflow: 'hidden', flexShrink: 0,
        background: 'var(--bg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22,
        border: '2px solid var(--a1)',
        boxSizing: 'border-box',
      }}>
        {hasPhoto
          ? <img
              src={info!.photoUrl!}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              onError={e => {
                const el = e.target as HTMLImageElement;
                el.style.display = 'none';
                el.parentElement!.textContent = '📢';
              }}
            />
          : '📢'
        }
      </div>
      {canSwitch && (
        <div style={{ fontSize: 10, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.5px', lineHeight: 1 }}>
          ↻ canale
        </div>
      )}
    </div>
  );
}
function CustomTextEditor({ initialValue, onSave, rows = 2 }: { initialValue: string; onSave: (v: string) => void; rows?: number }) {
  const [val, setVal] = useState(initialValue);
  const taRef = useRef<HTMLTextAreaElement>(null);
  return (
    <textarea ref={taRef} className="txta" rows={rows} value={val}
      onChange={e => { setVal(e.target.value); onSave(e.target.value); }}
      onBlur={e => onSave(e.target.value)}
      placeholder="Testo aggiuntivo..." />
  );
}

// ── Template image preview (reused in PostCard + standalone) ──
function TemplateImagePreview({ post, template }: { post: CreatedPost; template: Template | undefined }) {
  const hasImage = post.image && post.image !== 'placeholder.jpg';
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(340);
  React.useEffect(() => {
    if (containerRef.current) setContainerW(containerRef.current.clientWidth);
  }, []);

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

  const canvasW = template.canvasW ?? 1024;
  const canvasH = template.canvasH ?? 1024;
  const containerH = containerW * canvasH / canvasW;
  const previewRef = Math.min(containerW, containerH); // lato quadrato riferimento = imageCompose canvasRef
  const fontScale = (2 * containerW) / canvasW;

  const pp = template.product;
  const ppBoxPx = (pp.size / 100) * previewRef; // box quadrato in pixel
  return (
    <div ref={containerRef} style={{
      margin: '0 16px 12px', borderRadius: 10, overflow: 'hidden',
      position: 'relative', aspectRatio: `${canvasW}/${canvasH}`, background: template.bgColor,
      boxShadow: '0 2px 16px rgba(0,0,0,0.35)', isolation: 'isolate',
    }}>
      {/* Product image at template position — box quadrato come imageCompose */}
      <div style={{
        position: 'absolute', left: `${pp.x}%`, top: `${pp.y}%`,
        width: ppBoxPx, height: ppBoxPx,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {hasImage
          ? <img src={post.image} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          : <span style={{ fontSize: `${ppBoxPx * 0.55}px` }}>{post.emoji}</span>
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
      {(() => {
        const storeEl = post.platform === 'amazon' ? template.storeAmazon : template.storeAliexpress;
        if (!storeEl?.enabled) return null;
        const scale = post.platform === 'amazon' ? 1 : 5 / 11;
        return (
          <img
            src={post.platform === 'amazon' ? '/store-amazon.png' : '/store-aliexpress.png'}
            alt="store"
            style={{
              position: 'absolute', left: `${storeEl.x}%`, top: `${storeEl.y}%`,
              height: `${storeEl.size * scale}%`, width: 'auto', pointerEvents: 'none',
            }}
          />
        );
      })()}

      {/* Text elements with actual values */}
      {([
        { el: template.prezzo,          text: applyDecimalSep(applyCurrPos(`€${post.discountedPrice.toFixed(2)}`, template.prezzo.currencyPos), template.prezzo.decimalSep) },
        { el: template.prezzoPrecedente, text: applyDecimalSep(applyCurrPos(`€${post.originalPrice.toFixed(2)}`, template.prezzoPrecedente.currencyPos), template.prezzoPrecedente.decimalSep) },
        { el: template.sconto,          text: applySconto(`-${post.discountPercent}%`, template.sconto.hidePercent, template.sconto.hideMinus) },
        { el: template.testoCustom,     text: post.customText },
      ] as const).map(({ el, text }, i) => {
        if (!el.enabled || !text) return null;
        const displayFs = el.fontSize * fontScale;
        const decScale = (el as any).decimalFontScale != null && (el as any).decimalFontScale < 1 ? (el as any).decimalFontScale : 1;
        const decMatch = decScale < 1 ? text.match(/^(.*?)([.,]\d{1,3})([\D]*)$/) : null;
        const renderedText = decMatch
          ? <>{decMatch[1]}<span style={{ fontSize: `${displayFs * decScale}px`, verticalAlign: 'bottom' }}>{decMatch[2]}</span>{decMatch[3]}</>
          : text;
        return (
          <div key={i} style={{
            position: 'absolute',
            ...(el.textAnchor === 'right'
              ? { right: `${100 - el.x}%`, top: `${el.y}%` }
              : el.textAnchor === 'center'
                ? { left: `${el.x}%`, top: `${el.y}%`, transform: 'translateX(-50%)' }
                : { left: `${el.x}%`, top: `${el.y}%` }),
            fontSize: `${displayFs}px`,
            lineHeight: 1,
            fontFamily: el.fontFamily, fontWeight: el.bold ? 700 : 400,
            color: el.color,
            textDecoration: (el as any).strikethrough ? `line-through ${(el as any).strikethroughColor || el.color}` : 'none',
            whiteSpace: 'nowrap', pointerEvents: 'none',
            WebkitTextStroke: el.strokeEnabled ? `${el.strokeWidth * fontScale}px ${el.strokeColor}` : undefined,
          }}>{renderedText}</div>
        );
      })}

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
              placeholder="Valore coupon (es. -10€, -15%)..." style={{ marginBottom: 6 }} />
            {currentLayout?.contenuto.includes('{boxcoupon}') && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--t2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!post.boxcoupon}
                  onChange={e => {
                    const val = e.target.checked
                      ? (tags.find(t => t.name === '{boxcoupon}')?.value || 'Abilita il coupon prima di acquistare')
                      : undefined;
                    update({ boxcoupon: val } as any);
                  }} />
                C'è un coupon da spuntare sulla pagina Amazon <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{'{boxcoupon}'}</span>
                {post.boxcoupon && <span style={{ color: 'var(--gre)', fontSize: 10 }}>✓ attivo</span>}
              </label>
            )}
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
  const { stats, settings, createdPosts, activeProfileId, allChannels } = useApp();

  // Nome canale attivo per mostrarlo nell'header
  const activeChannel = activeProfileId.includes(':')
    ? activeProfileId.split(':').slice(1).join(':')
    : (allChannels[0] ?? '');
  const items = [
    { id: 'search', ic: '🔍', lb: 'Cerca Offerte', sub: 'Amazon & AliExpress', c: 'var(--bl)' },
    { id: 'newpost', ic: '✏️', lb: 'Nuovo Post', sub: createdPosts.length > 0 ? `${createdPosts.length} bozze in attesa` : 'singolo / multiplo', c: 'var(--a1)' },
    { id: 'queue', ic: '🗓️', lb: 'Coda AutoPost', sub: `${stats.inCoda} in coda`, c: 'var(--or)' },
    { id: 'published', ic: '✅', lb: 'Pubblicati', sub: `${stats.pub} oggi`, c: 'var(--gr)' },
    { id: 'monitor', ic: '📡', lb: 'Monitor Canali', sub: 'copia link da altri canali', c: 'var(--a3)' },
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
          {settings.attivo && <div className="hbdg">AUTO ON</div>}
        </div>
        <div className="hero-stats">
          <div className="stat"><div className="sn" style={{ color: 'var(--a3)' }}>{stats.inCoda}</div><div className="sl">In coda</div></div>
          <div className="stat"><div className="sn" style={{ color: 'var(--gr2)' }}>{stats.pub}</div><div className="sl">Pubblicati</div></div>
          <ChannelSwitcher />
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
const ALI_SORT_OPTIONS = [
  { value: 'DEFAULT_SORT',      label: 'Rilevanza' },
  { value: 'LAST_VOLUME_DESC',  label: 'Più venduti' },
  { value: 'RATING_DESC',       label: 'Valutazione ↓' },
  { value: 'SALE_PRICE_ASC',    label: 'Prezzo ↑' },
  { value: 'SALE_PRICE_DESC',   label: 'Prezzo ↓' },
];

const DELIVERY_OPTIONS = [
  { value: 0,  label: '🌍 Tutti' },
  { value: 7,  label: '⚡ Consegna rapida (≤7 gg)' },
  { value: 15, label: '⚡ Veloce (≤15 gg)' },
];

const MIN_RATING_OPTIONS = [
  { value: 0,  label: 'Qualsiasi' },
  { value: 80, label: '≥ 80%' },
  { value: 85, label: '≥ 85%' },
  { value: 90, label: '≥ 90%' },
  { value: 95, label: '≥ 95% (solo top)' },
];

const CAT_PRESETS = [
  { id: '44',          label: '📱 Elettronica' },
  { id: '509',         label: '📱 Telefoni' },
  { id: '7',           label: '💻 Computer' },
  { id: '200000783',   label: '⌚ Wearable' },
  { id: '18',          label: '⚽ Sport' },
  { id: '2',           label: '🏠 Casa' },
  { id: '66',          label: '🎮 Gaming' },
  { id: '1511',        label: '🎧 Audio' },
  { id: '200001075',   label: '🏡 Smart Home' },
  { id: '200003498',   label: '📷 Foto' },
];

const EU_COUNTRIES = new Set([
  'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GB','GR',
  'HR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE',
  'SI','SK','UK',
]);

function codeToFlag(code: string): string {
  if (!code || code.length !== 2) return '';
  return [...code.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');
}

const AMZ_SORT_OPTIONS = [
  { value: 'Featured',           label: 'In evidenza' },
  { value: 'Price:LowToHigh',    label: 'Prezzo ↑' },
  { value: 'Price:HighToLow',    label: 'Prezzo ↓' },
  { value: 'AvgCustomerReviews', label: 'Recensioni ↓' },
  { value: 'NewestArrivals',     label: 'Più recenti' },
];

const AMZ_SEARCH_INDEXES = [
  { value: '',                         label: 'Tutte le categorie' },
  { value: 'Electronics',              label: '📱 Elettronica' },
  { value: 'Computers',                label: '💻 Computer' },
  { value: 'VideoGames',               label: '🎮 Videogiochi' },
  { value: 'HomeAndKitchen',           label: '🏠 Casa e cucina' },
  { value: 'Apparel',                  label: '👕 Abbigliamento' },
  { value: 'Shoes',                    label: '👟 Scarpe' },
  { value: 'SportsAndOutdoors',        label: '⚽ Sport e outdoor' },
  { value: 'Books',                    label: '📚 Libri' },
  { value: 'Beauty',                   label: '💄 Bellezza' },
  { value: 'HealthPersonalCare',       label: '💊 Salute' },
  { value: 'Baby',                     label: '👶 Neonati' },
  { value: 'Automotive',               label: '🚗 Auto' },
  { value: 'ToolsAndHomeImprovement',  label: '🔧 Fai da te' },
  { value: 'GardenAndOutdoor',         label: '🌿 Giardino' },
  { value: 'Watches',                  label: '⌚ Orologi' },
  { value: 'Jewelry',                  label: '💍 Gioielli' },
  { value: 'Luggage',                  label: '🧳 Borse e valigie' },
  { value: 'MusicalInstruments',       label: '🎸 Strumenti musicali' },
  { value: 'OfficeProducts',           label: '🖊️ Ufficio' },
  { value: 'PetSupplies',              label: '🐾 Animali' },
  { value: 'EverythingElse',           label: '📦 Altro' },
];

function DealCard({ p, selected, onToggle }: { p: DealProduct; selected: boolean; onToggle: () => void }) {
  const sym = p.currency === 'EUR' ? '€' : p.currency === 'GBP' ? '£' : '$';
  return (
    <div
      onClick={onToggle}
      style={{
        background: 'var(--card)',
        border: `2px solid ${selected ? 'var(--a1)' : 'var(--bdr)'}`,
        borderRadius: 10, overflow: 'hidden', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', height: 210,
        transition: 'border-color .15s',
      }}
    >
      <div style={{ position: 'relative', height: 110, background: 'var(--bg3)', flexShrink: 0 }}>
        {p.image
          ? <img src={p.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 36 }}>📦</div>
        }
        {/* Checkbox */}
        <div style={{
          position: 'absolute', top: 5, left: 5,
          width: 22, height: 22, borderRadius: '50%',
          background: selected ? 'var(--a1)' : 'rgba(0,0,0,0.45)',
          border: `2px solid ${selected ? 'var(--a1)' : 'rgba(255,255,255,0.5)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, color: '#fff', fontWeight: 700,
        }}>{selected ? '✓' : ''}</div>
        {p.discountPercent > 0 && (
          <div style={{
            position: 'absolute', top: 5, right: 5,
            background: '#ef4444', color: '#fff',
            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 20,
          }}>-{p.discountPercent}%</div>
        )}
        {p.shipFromCountry && (
          <div style={{
            position: 'absolute', bottom: 4, right: 4,
            background: EU_COUNTRIES.has(p.shipFromCountry) ? 'rgba(34,197,94,0.85)' : 'rgba(0,0,0,0.55)',
            color: '#fff', fontSize: 9, fontWeight: 600,
            padding: '1px 5px', borderRadius: 10,
          }}>{codeToFlag(p.shipFromCountry)} {p.shipFromCountry}</div>
        )}
      </div>
      <div style={{ padding: '6px 8px', flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minHeight: 0 }}>
        <div style={{
          fontSize: 11, color: 'var(--t1)', lineHeight: 1.3, flex: 1,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{p.title}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 'auto' }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: '#22c55e' }}>{sym}{p.discountedPrice.toFixed(2)}</span>
          {p.originalPrice > p.discountedPrice && (
            <span style={{ fontSize: 10, color: 'var(--t3)', textDecoration: 'line-through' }}>{sym}{p.originalPrice.toFixed(2)}</span>
          )}
        </div>
        {(p.rating || p.category) && (
          <div style={{ fontSize: 9, color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {p.rating ? `⭐ ${p.rating}` : ''}{p.rating && p.category ? ' · ' : ''}{p.category}
          </div>
        )}
      </div>
    </div>
  );
}

const AMZ_DEFAULT_BRANDS = [
  'samsung','apple','mulino bianco','philips','gillette','acer','lenovo','blink','nespresso',
  'bialetti','borbone',"kellogg's",'nescafé','kinder','peroni','misura','echo show','huawei',
  'msi','pavesi','adidas','echo dot','braun','sandisk','pringles','kimbo','nestlé','tuborg',
  "m&m's",'pan di stelle','aukey','pellini','honor','gran cereale','epson','lg','san carlo',
  'lavazza','nike',"jack daniel's",'wd','jbl','galbusera','starbucks','riso scotti','xiaomi',
  'fitbit','realme','fire tv','diadora','twinings','coca-cola','lipton','lindor','ferrero',
  'kitkat','benq','hp','perugina','poretti','panasonic','kingston','crucial','paco rabanne',
  'netac','amazfit','vergnano','chupa chups','bottega verde','calvin klein','tuc','microsoft',
  'collistar','lexar','toshiba','fila','remington','sony','motta','belkin','fire hd','wilkinson',
  "levi's",'diesel','hugo boss','nero giardini','laura biagiotti','bauli','snickers','dell',
  'hisense','puma','amazon','oneplus','oppo','nutella','fossil','canon','google','garnier',
  'nivea','logitech','tp-link','whirlpool','bosch','netgear','revlon','pantene','olaz','armani',
  'hoover','imetec',"de'longhi",'rowenta','vileda','durex','seagate','irobot','illy','kenwood',
  'sharp','geox','electrolux','ariete','veet','moulinex','spigen','candy','sennheiser',
  'indesit','haier','pedigree','razer','asus','bayer','aigostar','gucci','dior','anker',
  'eero','garmin','casio','dove','lacoste','vans','western digital','amuchina','cocolino',
  'dash','dixan','fairy','finish','haribo','lenor','lindt','loacker','motorola','nintendo',
  'corsair','ubisoft','steelseries','capcom','oreo','playstation','schwarzkopf','sodastream',
  'timberland','vanish','xbox','chicco','disney','barilla',"l'oréal paris",'maybelline',
  'morellato','oral-b','clementoni','kipling','colgate','brita','borotalco','de cecco',
  'doritos','milka','olay','lego','marvel','pokémon','ray-ban','reolink','roborock','scholl',
  'tena','gigabyte','govee','hasbro','hyperx','kodak','panini','converse','knorr','la molisana',
  'garofalo','head & shoulders','hotpoint','lagostina','tapo','alpro','airwick','bacardi',
  'cif','emporio armani','levoit','granarolo','tcl','konami','crocs','intex','superga','sonoff',
  'hugo','labello','jabra','varta','eufy','intel','amd','ugreen','aoc','cerave','under armour',
  'aperol','bandai','barbie','black+decker','renpho',"rubik's",'nzxt','pioneer','trust',
  'swarovski','duracell','frontline','dreame','ecovacs','the north face','versace',
  'oral-b','ticwatch','nothing','asrock','cooler master','tineco','thun','voiello','sacla',
  'olimpia splendid','severin','cecotec','eureka','thermalright','narwal','laica','sunsilk',
  "tesori d'oriente",'vagisil','vidal','vivident','ciarra','dreo','patriot memory','equilibra',
  'aeg','united colors of benetton','creative','mars gaming','arctic','evga','powera','calgon',
  "l'oréal professionnel",'russel hobbs','cuisinart','merross','forno bonomi','baileys',
  'boss','gigabyte','maalox','tristar','lamborghini','bellissima','der-franz','breil',
  'electronic arts','sega','thq nordic','namco','nacon','warner bros','activision',
  'milestones','codemasters','roblox','ring','bethesda','carrera','champion','chanteclair',
  'herbal essence','amaro montenegro','daniel wellington','listerine','absolut','astro gaming',
  'govee','hyperx','kodak','roscenic','scholl','tennent\'s','converse','raid','delicius',
  'granbest','jaotto','la cafetiere','lydevo','v-tac','ultenic','versuni','calvé','polti',
  'swiffer','scottex','red bull','san benedetto','purina','whiskas','biffi','levoit',
  'granarolo','foppapedretti','protein works','goleador','vigorsol','vitalcare','citrosodina',
  'magic the gathering','maserati','roblox','sbs','yoga','ace','act','antica erboristeria',
  'bonomelli','brekkies','carrera','chanteclair','wasw','wc net','barilla','morellato',
  "l'oréal paris",'maybelline','clementoni','kipling','brita','de cecco','doritos','gallo',
  'grisbi','milka','olay','ticwatch','nothing','avalon hill','az','baileys','bombay','cameo',
  'david jones','funk','lego','marvel','pokémon','quasar','ray-ban','tena','thun','voiello',
  'knorr','la molisana','garofalo','girmi','armando','bionsen','costa d\'oro','deconovo',
  'delicius','felix','granbest','olimpia splendid','severin','fabuloso','hotpoint',
  'lagostina','maxijin','nettura','tapo','teehon','ultenic','versuni','alpro','airwick',
  'calvé','cif','der-franz','biffi','emporio armani','levoit','merross','granarolo',
  'forno bonomi','tcl','konami','crocs','intex','superga','sonoff','hugo','labello',
  'ambi pur','lines','tigullio','bistefani','aeg','ubena','united colors of benetton',
  'creative','amia chips','mars gaming','arctic','aoc','narwal','be-total','calgon',
  'cerave','deox','friskies','foppapedretti','goleador','laica','oregon','protein works',
  'sunsilk','under armour','vagisil','vidal','vigorsol','vitalcare','vivident','eureka',
  'thermalright','aperol','bandai','barbie','black+decker','citrosodina','ciarra','dreo',
  'magic the gathering','renpho',"rubik's",'nzxt','fm london','aukeypower','defacto',
  'cavo per diffusori','enterogermina','felce azzurra','jack & jones','kappa','urban classics',
  'advantage','napisan','nelsen','neutro robers','omino bianco','purina felix','purina friskies',
  'spuma di sciampagna','svelto','tempo fazzoletti','tommy jeans','eastpak','microids',
  'meridiem games','mag','mastro lindo','regina','citrosil','joopin','malfy','relevo',
  'sabrent','transcend','vernel','gourmet','zzzquil','rockstar','dc comics','ea',
  'square enix','skybound','codemasters','brooklyn','sbs','xbox','yoga','ring',
  'bonomelli','buscofen premestruale','ecovacs','wc net','disney','hasbro gaming',
  'roscenic','reolink','roborock','loacker','lysoform','mr muscle','napisan','sole',
  'swiffer','scottex','seresto','spuma di sciampagna','svelto','tempo fazzoletti',
  'daygum','pépé jeans','rimmel london','trust','chloe','zuegg','doria','nesquik',
  'indesit','haier','swarovski','frontline','advantix','franck provost','tommy hilfiger',
  'aigostar','gucci','dior','anker','jack & jones','purina one','urban classics',
  'cocolino','dixan','fairy','finish','foxy','gimoka','lenor','lysoform','motorola',
  'mastro lindo','capcom','oreo','schwarzkopf','vanish','vernel','rockstar','ubi soft',
  'activision','milestones','maserati','roblox','yoga','act','antica erboristeria',
];

export function SearchPage({ nav }: { nav: (p: NavPage) => void }) {
  const { settings, setSettings, templates, layouts, setQueue } = useApp();
  const [tab, setTab] = useState('amazon');

  const ds = settings.dealSearch?.ali ?? { keywords: '', minDiscount: 0, minPrice: 0, maxPrice: 0, sort: 'DEFAULT_SORT', deliveryDays: 0, categoryIds: '' };
  const [keywords, setKeywords]         = useState(ds.keywords);
  const [minDiscount, setMinDiscount]   = useState(ds.minDiscount);
  const [minPrice, setMinPrice]         = useState(ds.minPrice);
  const [maxPrice, setMaxPrice]         = useState(ds.maxPrice);
  const [sort, setSort]                 = useState(ds.sort);
  const [deliveryDays, setDeliveryDays] = useState(ds.deliveryDays ?? 0);
  const [categoryIds, setCategoryIds]   = useState(ds.categoryIds ?? '');
  const [minRating, setMinRating]       = useState(0);

  // Multi-categoria: toggle una pill aggiunge/rimuove dall'elenco separato da virgola
  const toggleCat = (id: string) => {
    const ids = categoryIds.split(',').map(s => s.trim()).filter(Boolean);
    setCategoryIds(ids.includes(id) ? ids.filter(x => x !== id).join(',') : [...ids, id].join(','));
  };
  const activeCats = new Set(categoryIds.split(',').map(s => s.trim()).filter(Boolean));

  const [results, setResults]         = useState<DealProduct[]>([]);
  const [total, setTotal]             = useState(0);
  const [page, setPage]               = useState(1);
  const [loading, setLoading]         = useState(false);
  const [err, setErr]                 = useState('');
  const [searched, setSearched]       = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [adding, setAdding]           = useState(false);
  const [feedback, setFeedback]       = useState('');
  const [showAliFilters, setShowAliFilters] = useState(false);
  const [euOnly, setEuOnly]           = useState(false);

  // euOnly forza delivery_days=7 lato server: non serve filtrare ulteriormente client-side
  // (product_country è spesso CN anche per venditori con magazzino EU, quindi sarebbe esclusivo)
  const visibleResults = results;

  // ── Stato Amazon ────────────────────────────────────────────────────────────
  const dsAmz = settings.dealSearch?.amazon ?? { keywords: '', minDiscount: 0, maxDiscount: 0, minPrice: 0, maxPrice: 0, sort: 'Featured', searchIndexes: '' };
  const [amzKeywords, setAmzKeywords]         = useState(dsAmz.keywords ?? '');
  const [amzMinDiscount, setAmzMinDiscount]   = useState(dsAmz.minDiscount ?? 0);
  const [amzMaxDiscount, setAmzMaxDiscount]   = useState(dsAmz.maxDiscount ?? 0);
  const [amzMinPrice, setAmzMinPrice]         = useState(dsAmz.minPrice ?? 0);
  const [amzMaxPrice, setAmzMaxPrice]         = useState(dsAmz.maxPrice ?? 0);
  const [amzSort, setAmzSort]                 = useState(dsAmz.sort ?? 'Featured');
  const [amzMinRating, setAmzMinRating]       = useState(dsAmz.minRating ?? 0);
  const [amzMinReviews, setAmzMinReviews]     = useState(dsAmz.minReviews ?? 0);
  const [amzMerchantFilter, setAmzMerchantFilter] = useState(dsAmz.merchantFilter ?? 'all');
  const [amzBrandKeywords, setAmzBrandKeywords] = useState<string[]>(
    dsAmz.brandKeywords
      ? dsAmz.brandKeywords.split(',').map((s: string) => s.trim()).filter(Boolean)
      : AMZ_DEFAULT_BRANDS
  );
  const [newBrandKw, setNewBrandKw]           = useState('');
  const [showFilters, setShowFilters]         = useState(false);
  const [brandSearch, setBrandSearch]         = useState('');
  // Multi-categoria: Set di SearchIndex selezionati (vuoto = tutte)
  const [amzSearchIndexes, setAmzSearchIndexes] = useState<Set<string>>(
    new Set((dsAmz.searchIndexes ?? '').split(',').map((s: string) => s.trim()).filter(Boolean))
  );
  const toggleAmzCat = (v: string) =>
    setAmzSearchIndexes(prev => { const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n; });
  const [amzResults, setAmzResults]           = useState<DealProduct[]>([]);
  const [amzTotal, setAmzTotal]               = useState(0);
  const [amzPage, setAmzPage]                 = useState(1);
  const [amzLoading, setAmzLoading]           = useState(false);
  const [amzRefreshing, setAmzRefreshing]     = useState(false);
  const [amzErr, setAmzErr]                   = useState('');
  const [amzSearched, setAmzSearched]         = useState(false);
  const [amzRefreshedAt, setAmzRefreshedAt]   = useState<string | null>(null);
  const [amzSelectedIds, setAmzSelectedIds]   = useState<Set<string>>(new Set());
  const [amzAdding, setAmzAdding]             = useState(false);
  const [amzIsKeywordSearch, setAmzIsKeywordSearch] = useState(false);

  // Carica cache Amazon quando si apre il tab
  useEffect(() => {
    if (tab === 'amazon' && !amzSearched) { loadAmzCache(); }
  }, [tab]); // eslint-disable-line

  const showFb = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(''), 3000); };

  const doSearch = async (resetPage = true) => {
    setErr('');
    setLoading(true);
    const p = resetPage ? 1 : page;
    if (resetPage) { setPage(1); setSelectedIds(new Set()); }
    try {
      // Quando EU-only è attivo, forza delivery_days=7 (magazzino vicino = EU in pratica)
      const effectiveDeliveryDays = euOnly ? Math.max(deliveryDays, 7) : deliveryDays;
      const data = await dealsApi.searchAli({ keywords: keywords.trim(), minDiscount, minPrice, maxPrice, sort, deliveryDays: effectiveDeliveryDays, categoryIds: categoryIds.trim(), page: p, minRating });
      setResults(resetPage ? data.products : prev => [...prev, ...data.products]);
      setTotal(data.total);
      setSearched(true);
    } catch (e: any) {
      setErr(e.message ?? 'Errore durante la ricerca');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: string) =>
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleAll = () =>
    setSelectedIds(selectedIds.size === visibleResults.length ? new Set() : new Set(visibleResults.map(r => r.productId)));

  const addSelectedToQueue = async () => {
    if (!selectedIds.size || adding) return;
    setAdding(true);
    const defaultNormalLayout = layouts.find(l => l.tipo === 'normal')?.id ?? '';
    const defaultAliLayout = layouts.find(l => l.tipo === 'aliexpress')?.id ?? defaultNormalLayout;
    const tpl = templates[0];
    const aliCurr = aliCurrencySym(settings.aliexpress?.targetCountry ?? 'IT');
    const addedItems: QueueItem[] = [];
    let expiredCount = 0;
    for (const pid of Array.from(selectedIds)) {
      const p = results.find(r => r.productId === pid);
      if (!p) continue;

      // Recupera dettagli prodotto (shipFromCountry reale + link affiliato verificato)
      let shipFromCountry: string | undefined = p.shipFromCountry;
      let sourceUrl = p.affiliateUrl || p.url;
      try {
        const productUrl = `https://www.aliexpress.com/item/${p.productId}.html`;
        const detail = await productApi.fetchAliExpress({ url: productUrl });
        if (detail.shipFromCountry) shipFromCountry = detail.shipFromCountry;
        if (detail.affiliateUrl) sourceUrl = detail.affiliateUrl;
      } catch {}

      let post: CreatedPost = {
        id: genId(), platform: 'aliexpress',
        sourceUrl,
        productId: p.productId, title: shortenTitle(p.title), image: p.image,
        originalPrice: p.originalPrice, discountedPrice: p.discountedPrice,
        discountPercent: p.discountPercent,
        customText: '', isHistoricalLow: false,
        templateId: tpl?.id || 'tpl1',
        layoutId: defaultAliLayout, keyboardId: '', emoji: getProductEmoji(p.title, p.category),
        shipFromCountry,
      };
      // Genera immagine template (come NewPost) così il cron la usa direttamente
      if (tpl && post.image) {
        const gi = await generatePostImage(tpl, post.image, false, 'aliexpress', {
          prezzo: `${aliCurr}${p.discountedPrice.toFixed(2)}`,
          prezzoPrecedente: `${aliCurr}${p.originalPrice.toFixed(2)}`,
          sconto: `-${p.discountPercent}%`,
        }).catch(() => '');
        if (gi) post = { ...post, generatedImage: gi };
      }
      const qItem: QueueItem = { id: genId(), tipo: 'single', sched: 'Auto', status: 'draft', sel: false, posts: [post] };
      try {
        const resp = await autopostApi.create(qItem);
        const sp = (resp?.posts as any)?.[0];
        const mergedItem: QueueItem = sp?.isHistoricalLow
          ? { ...qItem, posts: [{ ...post, isHistoricalLow: true, layoutId: sp.layoutId ?? post.layoutId }] }
          : qItem;
        addedItems.push(mergedItem);
      } catch (e: any) {
        if (e?.message?.includes('scadut') || e?.message?.includes('Offerta')) expiredCount++;
      }
    }
    if (addedItems.length) setQueue(prev => [...prev, ...addedItems]);
    setSelectedIds(new Set());
    setAdding(false);
    const expiredPart = expiredCount > 0 ? `, ${expiredCount} offerta${expiredCount === 1 ? '' : 'e'} scaduta${expiredCount === 1 ? '' : 'e'}` : '';
    showFb(`✅ ${addedItems.length} prodotto${addedItems.length === 1 ? '' : 'i'} aggiunto${addedItems.length === 1 ? '' : 'i'} in coda${expiredPart}`);
  };

  const saveFilters = async () => {
    const newSettings = {
      ...settings,
      dealSearch: {
        ...(settings.dealSearch ?? { autoPublishAliexpress: false, autoPublishAmazon: false, publishPattern: '1:1' }),
        ali: { keywords, minDiscount, minPrice, maxPrice, sort, deliveryDays, categoryIds },
      },
    };
    try {
      await settingsApi.save(newSettings);
      setSettings(newSettings);
      showFb('✅ Filtri salvati per auto-ricerca');
    } catch { showFb('⚠️ Errore nel salvataggio'); }
  };

  // Carica dalla cache DB (istantaneo)
  const loadAmzCache = async () => {
    setAmzErr('');
    setAmzLoading(true);
    setAmzIsKeywordSearch(false);
    try {
      const data = await dealsCacheApi.listAmazon({
        minDiscount: amzMinDiscount, maxDiscount: amzMaxDiscount,
        searchIndexes: Array.from(amzSearchIndexes).join(',') || undefined,
        minRating: amzMinRating || undefined,
        minReviews: amzMinReviews || undefined,
        merchantFilter: amzMerchantFilter !== 'all' ? amzMerchantFilter : undefined,
      });
      setAmzResults(data.products);
      setAmzTotal(data.total);
      setAmzRefreshedAt(data.refreshedAt);
      setAmzSearched(true);
    } catch (e: any) {
      setAmzErr(e.message ?? 'Errore nel caricamento');
    } finally {
      setAmzLoading(false);
    }
  };

  // Avvia refresh in background (chiama API Amazon → aggiorna cache → ricarica)
  const doRefreshAmazon = async () => {
    if (amzRefreshing) return;
    setAmzRefreshing(true);
    setAmzErr('');
    try {
      await dealsCacheApi.refresh();
      // Polling finché refreshedAt cambia (max 240s — incluse chiamate GetItems per le stelle)
      const start = Date.now();
      const prevAt = amzRefreshedAt;
      let updated = false;
      while (Date.now() - start < 240000) {
        await new Promise(r => setTimeout(r, 5000));
        const data = await dealsCacheApi.listAmazon({
          minDiscount: amzMinDiscount, maxDiscount: amzMaxDiscount,
          searchIndexes: Array.from(amzSearchIndexes).join(',') || undefined,
          minRating: amzMinRating || undefined,
          minReviews: amzMinReviews || undefined,
          merchantFilter: amzMerchantFilter !== 'all' ? amzMerchantFilter : undefined,
        });
        if (data.refreshedAt && data.refreshedAt !== prevAt) {
          setAmzResults(data.products);
          setAmzTotal(data.total);
          setAmzRefreshedAt(data.refreshedAt);
          setAmzSearched(true);
          updated = true;
          break;
        }
      }
      // Se scaduto il timeout ricarica comunque (il refresh potrebbe aver finito dopo)
      if (!updated) await loadAmzCache();
    } catch (e: any) {
      setAmzErr(e.message ?? 'Errore durante l\'aggiornamento');
    } finally {
      setAmzRefreshing(false);
    }
  };

  const doSearchAmazon = async (resetPage = true, pageOverride?: number) => {
    setAmzErr('');
    setAmzLoading(true);
    setAmzIsKeywordSearch(true);
    const p = pageOverride ?? (resetPage ? 1 : amzPage);
    if (resetPage) { setAmzPage(1); setAmzSelectedIds(new Set()); }
    try {
      const data = await dealsApi.searchAmazon({
        keywords: amzKeywords.trim(), minDiscount: amzMinDiscount, maxDiscount: amzMaxDiscount,
        minPrice: amzMinPrice, maxPrice: amzMaxPrice,
        sort: amzSort, searchIndexes: Array.from(amzSearchIndexes).join(','), page: p,
      });
      setAmzResults(resetPage ? data.products : prev => {
        const combined = [...prev, ...data.products];
        combined.sort((a, b) => b.discountPercent - a.discountPercent);
        return combined;
      });
      setAmzTotal(data.total);
      setAmzSearched(true);
    } catch (e: any) {
      setAmzErr(e.message ?? 'Errore durante la ricerca');
    } finally {
      setAmzLoading(false);
    }
  };

  const addSelectedAmazonToQueue = async () => {
    if (!amzSelectedIds.size || amzAdding) return;
    setAmzAdding(true);
    const defaultAmazonLayout = layouts.find(l => l.tipo === 'amazon')?.id ?? layouts.find(l => l.tipo === 'normal')?.id ?? layouts.find(l => l.tipo === 'historical_low')?.id ?? '';
    const tpl = templates[0];
    const addedItems: QueueItem[] = [];
    let expiredCount = 0;
    for (const pid of Array.from(amzSelectedIds)) {
      const p = amzResults.find(r => r.productId === pid);
      if (!p) continue;
      let post: CreatedPost = {
        id: genId(), platform: 'amazon',
        sourceUrl: p.affiliateUrl || p.url,
        productId: p.productId, title: shortenTitle(p.title), image: p.image,
        originalPrice: p.originalPrice, discountedPrice: p.discountedPrice,
        discountPercent: p.discountPercent,
        customText: '', isHistoricalLow: false,
        templateId: tpl?.id || 'tpl1',
        layoutId: defaultAmazonLayout, keyboardId: '', emoji: getProductEmoji(p.title, p.category),
      };
      if (tpl && post.image) {
        const gi = await generatePostImage(tpl, post.image, false, 'amazon', {
          prezzo: `€${p.discountedPrice.toFixed(2)}`,
          prezzoPrecedente: `€${p.originalPrice.toFixed(2)}`,
          sconto: `-${p.discountPercent}%`,
        }).catch(() => '');
        if (gi) post = { ...post, generatedImage: gi };
      }
      const qItem: QueueItem = { id: genId(), tipo: 'single', sched: 'Auto', status: 'draft', sel: false, posts: [post] };
      try {
        const resp = await autopostApi.create(qItem);
        const sp = (resp?.posts as any)?.[0];
        const mergedItem: QueueItem = sp?.isHistoricalLow
          ? { ...qItem, posts: [{ ...post, isHistoricalLow: true, layoutId: sp.layoutId ?? post.layoutId }] }
          : qItem;
        addedItems.push(mergedItem);
      } catch (e: any) {
        if (e?.message?.includes('scadut') || e?.message?.includes('Offerta')) expiredCount++;
      }
    }
    if (addedItems.length) setQueue(prev => [...prev, ...addedItems]);
    setAmzSelectedIds(new Set());
    setAmzAdding(false);
    const expiredPartAmz = expiredCount > 0 ? `, ${expiredCount} offerta${expiredCount === 1 ? '' : 'e'} scaduta${expiredCount === 1 ? '' : 'e'}` : '';
    showFb(`✅ ${addedItems.length} prodotto${addedItems.length === 1 ? '' : 'i'} aggiunto${addedItems.length === 1 ? '' : 'i'} in coda${expiredPartAmz}`);
  };

  const saveFiltersAmazon = async () => {
    const newSettings = {
      ...settings,
      dealSearch: {
        ...(settings.dealSearch ?? { autoPublishAliexpress: false, autoPublishAmazon: false, publishPattern: '1:1' }),
        amazon: {
          keywords: amzKeywords,
          minDiscount: amzMinDiscount, maxDiscount: amzMaxDiscount,
          minPrice: amzMinPrice, maxPrice: amzMaxPrice,
          sort: amzSort,
          searchIndexes: Array.from(amzSearchIndexes).join(','),
          brandKeywords: amzBrandKeywords.join(','),
          minRating: amzMinRating,
          minReviews: amzMinReviews,
          merchantFilter: amzMerchantFilter,
        },
      },
    };
    try {
      await settingsApi.save(newSettings);
      setSettings(newSettings);
      showFb('✅ Filtri salvati');
    } catch { showFb('⚠️ Errore nel salvataggio'); }
  };

  const hasMore = results.length < total;

  return (
    <div className="pg">
      <PageHeader title="Cerca Offerte" onBack={() => nav('dash')} />
      <SwitchTabs
        options={[['amazon', '🟡 Amazon'], ['aliexpress', '🔴 AliExpress']]}
        value={tab} onChange={setTab}
      />

      {tab === 'amazon' && (
        <>
          {/* Barra ricerca + filtri */}
          <div style={{ padding: '10px 16px 6px', display: 'flex', gap: 8 }}>
            <input className="inp" placeholder="Cerca un prodotto specifico..."
              value={amzKeywords} onChange={e => setAmzKeywords(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSearchAmazon()} style={{ flex: 1 }} />
            <button className="btn bp" style={{ flexShrink: 0, padding: '0 14px' }}
              onClick={() => doSearchAmazon()} disabled={amzLoading}>
              {amzLoading && amzIsKeywordSearch ? '⏳' : '🔍'}
            </button>
            <button className="btn bgh" style={{ flexShrink: 0, padding: '0 12px', position: 'relative' }}
              onClick={() => setShowFilters(true)}>
              ⚙️
              {(amzMinDiscount > 0 || amzMaxDiscount > 0 || amzMinPrice > 0 || amzMaxPrice > 0 ||
                amzSearchIndexes.size > 0 || amzMinRating > 0 || amzMinReviews > 0 || amzMerchantFilter !== 'all') && (
                <span style={{ position: 'absolute', top: 3, right: 3, width: 6, height: 6, borderRadius: '50%', background: 'var(--a1)' }} />
              )}
            </button>
          </div>

          {!settings.amazon?.credentialId && (
            <div style={{ margin: '0 16px 6px', padding: '6px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, fontSize: 12, color: '#ef4444' }}>
              ⚠️ Credenziali Amazon non configurate.{' '}
              <button className="btn bgh" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => nav('settings')}>Impostazioni →</button>
            </div>
          )}

          {/* Barra cache: timestamp + pulsanti aggiorna */}
          {!amzIsKeywordSearch && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 16px 8px' }}>
              <span style={{ fontSize: 11, color: 'var(--t3)', flex: 1 }}>
                {amzRefreshedAt
                  ? `🕐 ${new Date(amzRefreshedAt).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                  : '📦 Cache vuota'}
              </span>
              <button className="btn bgh bsm" style={{ fontSize: 11 }}
                onClick={doRefreshAmazon} disabled={amzRefreshing || amzLoading}>
                {amzRefreshing ? '⏳' : '🔄 Aggiorna'}
              </button>
              <button className="btn bgh bsm" style={{ fontSize: 11 }}
                onClick={loadAmzCache} disabled={amzLoading || amzRefreshing}>
                ↺
              </button>
            </div>
          )}

          {/* Modale filtri (bottom sheet) */}
          {showFilters && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowFilters(false)} />
              <div style={{ position: 'relative', background: 'var(--bg)', borderRadius: '18px 18px 0 0', maxHeight: '90vh', overflowY: 'auto', padding: '0 0 24px' }}>
                {/* Handle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 8px' }}>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>Filtri offerte Amazon</span>
                  <button className="btn bgh bsm" onClick={() => setShowFilters(false)}>✕</button>
                </div>

                <div style={{ padding: '0 16px' }}>
                  {/* Sconto */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 4 }}>
                      SCONTO {amzMinDiscount > 0 || amzMaxDiscount > 0
                        ? <span style={{ color: 'var(--a1)' }}>{amzMinDiscount}% → {amzMaxDiscount > 0 ? `${amzMaxDiscount}%` : '∞'}</span>
                        : <span>qualsiasi</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--t3)', minWidth: 22 }}>min</span>
                      <input type="range" min={0} max={90} step={5} value={amzMinDiscount}
                        style={{ flex: 1, accentColor: 'var(--a1)' }}
                        onChange={e => { const v = Number(e.target.value); setAmzMinDiscount(v); if (amzMaxDiscount > 0 && v >= amzMaxDiscount) setAmzMaxDiscount(0); }} />
                      <span style={{ fontSize: 11, color: 'var(--t2)', minWidth: 28 }}>{amzMinDiscount}%</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      <span style={{ fontSize: 11, color: 'var(--t3)', minWidth: 22 }}>max</span>
                      <input type="range" min={0} max={90} step={5} value={amzMaxDiscount}
                        style={{ flex: 1, accentColor: 'var(--a1)' }}
                        onChange={e => setAmzMaxDiscount(Number(e.target.value))} />
                      <span style={{ fontSize: 11, color: 'var(--t2)', minWidth: 28 }}>{amzMaxDiscount > 0 ? `${amzMaxDiscount}%` : '—'}</span>
                    </div>
                  </div>

                  {/* Prezzo */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 3 }}>PREZZO MIN (€)</div>
                      <input className="inp" type="number" min={0} placeholder="0"
                        value={amzMinPrice || ''} onChange={e => setAmzMinPrice(Number(e.target.value))} style={{ fontSize: 13 }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 3 }}>PREZZO MAX (€)</div>
                      <input className="inp" type="number" min={0} placeholder="illimitato"
                        value={amzMaxPrice || ''} onChange={e => setAmzMaxPrice(Number(e.target.value))} style={{ fontSize: 13 }} />
                    </div>
                  </div>

                  {/* Stelle */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 6 }}>STELLE MINIME</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {[0, 1, 2, 3, 4, 5].map(s => (
                        <button key={s} className={`btn bsm ${amzMinRating === s ? 'bp' : 'bgh'}`}
                          style={{ fontSize: 12, padding: '4px 10px' }}
                          onClick={() => setAmzMinRating(s)}>
                          {s === 0 ? 'Tutte' : `${s}★`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Recensioni minime */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 3 }}>RECENSIONI MINIME</div>
                    <input className="inp" type="number" min={0} placeholder="0 = nessun filtro"
                      value={amzMinReviews || ''} onChange={e => setAmzMinReviews(Number(e.target.value))} style={{ fontSize: 13 }} />
                  </div>

                  {/* Venditore */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 6 }}>VENDITORE</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {[['all','Tutti'],['amazon','Solo Amazon']].map(([v,l]) => (
                        <button key={v} className={`btn bsm ${amzMerchantFilter === v ? 'bp' : 'bgh'}`}
                          style={{ fontSize: 12, padding: '4px 10px' }}
                          onClick={() => setAmzMerchantFilter(v)}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Ordinamento */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 3 }}>ORDINAMENTO</div>
                    <select className="sel" style={{ fontSize: 12 }} value={amzSort} onChange={e => setAmzSort(e.target.value)}>
                      {AMZ_SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>

                  {/* Categorie */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 4 }}>
                      CATEGORIE {amzSearchIndexes.size > 0
                        ? <span style={{ color: 'var(--a1)' }}>({amzSearchIndexes.size} sel.)</span>
                        : <span>(tutte)</span>}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {AMZ_SEARCH_INDEXES.filter(o => o.value).map(o => (
                        <button key={o.value} className={`btn bsm ${amzSearchIndexes.has(o.value) ? 'bp' : 'bgh'}`}
                          style={{ fontSize: 10, padding: '3px 8px' }}
                          onClick={() => toggleAmzCat(o.value)}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Brand keyword */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 10, color: 'var(--t3)' }}>
                        BRAND / PAROLE CHIAVE ({amzBrandKeywords.length}) — aggiornati ad ogni refresh cache
                      </span>
                      <button className="btn bgh bsm" style={{ fontSize: 9 }}
                        onClick={() => setAmzBrandKeywords(AMZ_DEFAULT_BRANDS)}>
                        Reset
                      </button>
                    </div>
                    {/* Aggiungi keyword */}
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <input className="inp" placeholder="Aggiungi brand..."
                        value={newBrandKw} onChange={e => setNewBrandKw(e.target.value)}
                        style={{ flex: 1, fontSize: 12 }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && newBrandKw.trim()) {
                            const kw = newBrandKw.trim().toLowerCase();
                            if (!amzBrandKeywords.includes(kw)) setAmzBrandKeywords(prev => [...prev, kw]);
                            setNewBrandKw('');
                          }
                        }} />
                      <button className="btn bp bsm" style={{ fontSize: 12 }}
                        onClick={() => {
                          const kw = newBrandKw.trim().toLowerCase();
                          if (kw && !amzBrandKeywords.includes(kw)) setAmzBrandKeywords(prev => [...prev, kw]);
                          setNewBrandKw('');
                        }}>+</button>
                    </div>
                    {/* Cerca nella lista */}
                    <input className="inp" placeholder="Filtra lista brand..." value={brandSearch}
                      onChange={e => setBrandSearch(e.target.value)}
                      style={{ fontSize: 11, marginBottom: 6 }} />
                    {/* Lista brand come pill rimuovibili */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 180, overflowY: 'auto', padding: '4px 0' }}>
                      {amzBrandKeywords
                        .filter(k => !brandSearch || k.includes(brandSearch.toLowerCase()))
                        .map(kw => (
                          <span key={kw} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 3,
                            background: 'var(--bg2)', borderRadius: 12,
                            padding: '2px 6px', fontSize: 10, color: 'var(--t2)',
                          }}>
                            {kw}
                            <button onClick={() => setAmzBrandKeywords(prev => prev.filter(x => x !== kw))}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 10, padding: 0, lineHeight: 1 }}>✕</button>
                          </span>
                        ))}
                    </div>
                  </div>

                  {/* Salva + Applica */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn bs" style={{ flex: 1, fontSize: 13 }}
                      onClick={async () => { await saveFiltersAmazon(); setShowFilters(false); loadAmzCache(); }}>
                      💾 Salva e applica
                    </button>
                    <button className="btn bgh" style={{ flex: 1, fontSize: 13 }}
                      onClick={() => { setShowFilters(false); loadAmzCache(); }}>
                      Applica
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {amzErr && <div style={{ margin: '0 16px 8px' }}><ErrorBanner>{amzErr}</ErrorBanner></div>}
          {feedback && <div style={{ margin: '0 16px 8px', padding: '8px 12px', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 8, fontSize: 12, color: '#4ade80' }}>{feedback}</div>}

          {amzResults.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 16px 8px' }}>
              <button className="btn bgh bsm" style={{ fontSize: 11 }}
                onClick={() => setAmzSelectedIds(amzSelectedIds.size === amzResults.length ? new Set() : new Set(amzResults.map(r => r.productId)))}>
                {amzSelectedIds.size === amzResults.length ? '☑ Deseleziona' : '☐ Seleziona tutto'}
              </button>
              <span style={{ fontSize: 11, color: 'var(--t3)', flex: 1 }}>
                {amzResults.length}{amzIsKeywordSearch ? ` di ${amzTotal}` : ''} · {amzSelectedIds.size > 0 ? `${amzSelectedIds.size} selezionati` : 'tocca per selezionare'}
              </span>
            </div>
          )}

          {amzSearched && !amzLoading && amzResults.length === 0 && !amzErr && (
            <EmptyState icon="🔍" text={amzIsKeywordSearch ? "Nessun risultato. Cambia parole chiave o riduci i filtri." : "Cache vuota. Clicca Aggiorna per caricare le offerte."} />
          )}

          {amzResults.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '0 16px', paddingBottom: amzSelectedIds.size > 0 ? 90 : 16 }}>
              {amzResults.map(p => (
                <DealCard key={p.productId} p={p} selected={amzSelectedIds.has(p.productId)} onToggle={() => {
                  setAmzSelectedIds(prev => { const n = new Set(prev); n.has(p.productId) ? n.delete(p.productId) : n.add(p.productId); return n; });
                }} />
              ))}
              {amzIsKeywordSearch && amzResults.length < amzTotal && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <button className="btn bs bfull" onClick={() => { const next = amzPage + 1; setAmzPage(next); doSearchAmazon(false, next); }} disabled={amzLoading}>
                    {amzLoading ? '⏳ Caricamento...' : '⬇️ Carica altri'}
                  </button>
                </div>
              )}
            </div>
          )}

          {!amzSearched && !amzLoading && (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--t3)', fontSize: 13 }}>⏳ Caricamento cache...</div>
          )}
          {amzLoading && amzResults.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--t3)', fontSize: 13 }}>⏳ {amzIsKeywordSearch ? 'Ricerca in corso...' : 'Caricamento cache...'}</div>
          )}
        </>
      )}

      {tab === 'aliexpress' && (
        <>
          {/* Barra ricerca + filtri */}
          <div style={{ padding: '10px 16px 6px', display: 'flex', gap: 8 }}>
            <input className="inp" placeholder="Parole chiave · usa | per più termini (es: cuffie | auricolari)"
              value={keywords} onChange={e => setKeywords(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSearch()} style={{ flex: 1 }} />
            <button className="btn bp" style={{ flexShrink: 0, padding: '0 14px' }}
              onClick={() => doSearch()} disabled={loading}>
              {loading ? '⏳' : '🔍'}
            </button>
            <button className="btn bgh" style={{ flexShrink: 0, padding: '0 12px', position: 'relative' }}
              onClick={() => setShowAliFilters(true)}>
              ⚙️
              {(minDiscount > 0 || minPrice > 0 || maxPrice > 0 || deliveryDays > 0 ||
                activeCats.size > 0 || minRating > 0 || sort !== 'DEFAULT_SORT' || euOnly) && (
                <span style={{ position: 'absolute', top: 3, right: 3, width: 6, height: 6, borderRadius: '50%', background: 'var(--a1)' }} />
              )}
            </button>
          </div>

          {!settings.aliexpress.appKey && (
            <div style={{ margin: '0 16px 6px', padding: '6px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, fontSize: 12, color: '#ef4444' }}>
              ⚠️ Credenziali AliExpress non configurate.{' '}
              <button className="btn bgh" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => nav('settings')}>Impostazioni →</button>
            </div>
          )}

          {/* Modale filtri (bottom sheet) */}
          {showAliFilters && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowAliFilters(false)} />
              <div style={{ position: 'relative', background: 'var(--bg)', borderRadius: '18px 18px 0 0', maxHeight: '90vh', overflowY: 'auto', padding: '0 0 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 8px' }}>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>Filtri offerte AliExpress</span>
                  <button className="btn bgh bsm" onClick={() => setShowAliFilters(false)}>✕</button>
                </div>

                <div style={{ padding: '0 16px' }}>
                  {/* Sconto min */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 4 }}>
                      SCONTO MIN {minDiscount > 0
                        ? <span style={{ color: 'var(--a1)' }}>≥ {minDiscount}%</span>
                        : <span>qualsiasi</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input type="range" min={0} max={90} step={5} value={minDiscount}
                        style={{ flex: 1, accentColor: 'var(--a1)' }}
                        onChange={e => setMinDiscount(Number(e.target.value))} />
                      <span style={{ fontSize: 11, color: 'var(--t2)', minWidth: 28 }}>{minDiscount}%</span>
                    </div>
                  </div>

                  {/* Prezzo */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 3 }}>PREZZO MIN</div>
                      <input className="inp" type="number" min={0} placeholder="0"
                        value={minPrice || ''} onChange={e => setMinPrice(Number(e.target.value))} style={{ fontSize: 13 }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 3 }}>PREZZO MAX</div>
                      <input className="inp" type="number" min={0} placeholder="illimitato"
                        value={maxPrice || ''} onChange={e => setMaxPrice(Number(e.target.value))} style={{ fontSize: 13 }} />
                    </div>
                  </div>

                  {/* Stelle minime */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 6 }}>STELLE MINIME</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {[0, 1, 2, 3, 4, 5].map(s => (
                        <button key={s} className={`btn bsm ${minRating === s ? 'bp' : 'bgh'}`}
                          style={{ fontSize: 12, padding: '4px 10px' }}
                          onClick={() => setMinRating(s)}>
                          {s === 0 ? 'Tutte' : `${s}★`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Spedizione */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 3 }}>SPEDIZIONE</div>
                    <select className="sel" style={{ fontSize: 12 }} value={deliveryDays} onChange={e => setDeliveryDays(Number(e.target.value))}>
                      {DELIVERY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>

                  {/* Magazzino EU */}
                  <div style={{ marginBottom: 12 }}>
                    <button
                      className={`btn bfull ${euOnly ? 'bp' : 'bgh'}`}
                      style={{ fontSize: 13, padding: '10px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                      onClick={() => setEuOnly(v => !v)}
                    >
                      <span style={{ fontSize: 16 }}>🇪🇺</span>
                      Solo magazzino europeo
                      {euOnly && <span style={{ marginLeft: 4, fontSize: 11, background: 'rgba(255,255,255,0.25)', padding: '1px 6px', borderRadius: 10 }}>ATTIVO</span>}
                    </button>
                    <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4, textAlign: 'center' }}>
                      Filtra i risultati mostrando solo prodotti con magazzino in UE o UK
                    </div>
                  </div>

                  {/* Ordinamento */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 3 }}>ORDINAMENTO</div>
                    <select className="sel" style={{ fontSize: 12 }} value={sort} onChange={e => setSort(e.target.value)}>
                      {ALI_SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>

                  {/* Categorie */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 4 }}>
                      CATEGORIE {activeCats.size > 0
                        ? <span style={{ color: 'var(--a1)' }}>({activeCats.size} sel.)</span>
                        : <span>(tutte)</span>}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                      {CAT_PRESETS.map(c => (
                        <button key={c.id} className={`btn bsm ${activeCats.has(c.id) ? 'bp' : 'bgh'}`}
                          style={{ fontSize: 10, padding: '3px 8px' }}
                          onClick={() => toggleCat(c.id)}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                    <input className="inp" placeholder="ID aggiuntivi (es: 44,509)" value={categoryIds}
                      onChange={e => setCategoryIds(e.target.value)} style={{ fontSize: 12 }} />
                  </div>

                  {/* Salva + Applica */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn bs" style={{ flex: 1, fontSize: 13 }}
                      onClick={async () => { await saveFilters(); setShowAliFilters(false); doSearch(); }}>
                      💾 Salva e applica
                    </button>
                    <button className="btn bgh" style={{ flex: 1, fontSize: 13 }}
                      onClick={() => { setShowAliFilters(false); doSearch(); }}>
                      Applica
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {err && <div style={{ margin: '0 16px 8px' }}><ErrorBanner>{err}</ErrorBanner></div>}
          {feedback && <div style={{ margin: '0 16px 8px', padding: '8px 12px', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 8, fontSize: 12, color: '#4ade80' }}>{feedback}</div>}

          {/* Barra selezione */}
          {visibleResults.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 16px 8px' }}>
              <button className="btn bgh bsm" style={{ fontSize: 11 }} onClick={toggleAll}>
                {selectedIds.size === visibleResults.length ? '☑ Deseleziona' : '☐ Seleziona tutto'}
              </button>
              <span style={{ fontSize: 11, color: 'var(--t3)', flex: 1 }}>
                {results.length} di {total} · {selectedIds.size > 0 ? `${selectedIds.size} selezionati` : 'tocca per selezionare'}
              </span>
            </div>
          )}

          {/* Griglia risultati */}
          {searched && !loading && visibleResults.length === 0 && !err && (
            <EmptyState icon="🔍" text="Nessun risultato. Cambia parole chiave o riduci i filtri." />
          )}

          {visibleResults.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '0 16px', paddingBottom: selectedIds.size > 0 ? 90 : 16 }}>
              {visibleResults.map(p => (
                <DealCard key={p.productId} p={p} selected={selectedIds.has(p.productId)} onToggle={() => toggleSelect(p.productId)} />
              ))}
              {hasMore && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <button className="btn bs bfull" onClick={() => { setPage(p => p + 1); doSearch(false); }} disabled={loading}>
                    {loading ? '⏳ Caricamento...' : '⬇️ Carica altri'}
                  </button>
                </div>
              )}
            </div>
          )}

          {!searched && !loading && (
            <EmptyState icon="🔴" text="Cerca prodotti AliExpress in offerta."
              action={<button className="btn bp" onClick={() => doSearch()}>🔍 Cerca ora</button>} />
          )}
          {loading && results.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--t3)', fontSize: 13 }}>⏳ Ricerca in corso...</div>
          )}
        </>
      )}

      {/* Bottone fisso in fondo — solo quando ci sono selezioni */}
      {((tab === 'aliexpress' && selectedIds.size > 0) || (tab === 'amazon' && amzSelectedIds.size > 0)) && (
        <div style={{ position: 'fixed', bottom: 60, left: 0, right: 0, padding: '0 16px', zIndex: 50 }}>
          <button
            className="btn bp"
            style={{ width: '100%', padding: 13, fontSize: 14, fontWeight: 700, boxShadow: '0 4px 24px rgba(0,0,0,0.5)', borderRadius: 12 }}
            onClick={tab === 'aliexpress' ? addSelectedToQueue : addSelectedAmazonToQueue}
            disabled={adding || amzAdding}
          >
            {(adding || amzAdding)
              ? '⏳ Aggiungendo...'
              : `➕ Aggiungi ${tab === 'aliexpress' ? selectedIds.size : amzSelectedIds.size} in coda autopost`}
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// NEW POST PAGE
// ============================================================
export function NewPostPage({ nav }: { nav: (p: NavPage) => void }) {
  const {
    createdPosts, queue, setQueue, layouts, keyboards, templates, tags, settings,
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
    const isKnown = detectAmazonLink(url) || /aliexpress\.(com|us|ru)/i.test(url) || /s\.click\.aliexpress|a\.aliexpress\.com|ali\.ski|aliexpress\.page\.link/i.test(url);
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
      const defaultNormalTpl = templates[0]?.id || 'tpl1';
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
          const boxcouponText = p.couponBox
            ? (tags.find(t => t.name === '{boxcoupon}')?.value || 'Abilita il coupon prima di acquistare')
            : '';
          return { id: newId, platform: 'amazon' as const, sourceUrl: p.affiliateUrl || l.url, productId: p.asin, title: p.title, image: p.image, originalPrice: p.originalPrice, discountedPrice: p.discountedPrice, discountPercent: p.discountPercent, customText: '', isHistoricalLow: false, templateId: defaultNormalTpl, layoutId: defaultNormalLay, keyboardId: defaultKb, emoji: p.emoji || '📦', stelle: p.stelle, recensioni: p.recensioni, author: p.author, cat: p.cat, coupon: p.coupon, boxcoupon: boxcouponText || undefined, checkout: p.checkout };
        } else {
          const p = await productApi.fetchAliExpress({ url: l.url });
          return { id: newId, platform: 'aliexpress' as const, sourceUrl: p.affiliateUrl || l.url, productId: p.productId, title: p.title, image: p.image, originalPrice: p.originalPrice, discountedPrice: p.discountedPrice, discountPercent: p.discountPercent, customText: '', isHistoricalLow: false, templateId: defaultNormalTpl, layoutId: defaultAliLay, keyboardId: defaultKb, emoji: p.emoji || '📦', shipFromCountry: p.shipFromCountry };
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
      let lastCreateError: string | null = null;
      for (const qi of queueItems) {
        try {
          const resp = await autopostApi.create(qi);
          if (qi.tipo === 'single') {
            const sp = (resp?.posts as any)?.[0];
            const mergedItem: QueueItem = sp?.isHistoricalLow
              ? { ...qi, posts: [{ ...(qi.posts[0] as CreatedPost), isHistoricalLow: true, layoutId: sp.layoutId ?? (qi.posts[0] as CreatedPost).layoutId }] }
              : qi;
            saved.push(mergedItem);
          } else {
            saved.push(qi);
          }
        }
        catch (e) {
          lastCreateError = e instanceof Error ? e.message : String(e);
          console.error('[creaPost]', e);
        }
      }

      if (!saved.length) throw new Error(lastCreateError ?? 'Nessun post salvato nel DB. Riprova.');

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

          {canCreate && (
            <div style={{ padding: '0 16px 8px' }}>
              <button className="btn bp bfull" onClick={creaPost}>
                🚀 Crea Post ({itemsToCreate.length})
              </button>
            </div>
          )}

          {createdPosts.length > 0 && (
            <div style={{ padding: '0 16px 8px' }}>
              <button className="btn bs bfull" onClick={() => nav('queue')}>
                📋 Vedi coda ({createdPosts.length} bozze)
              </button>
            </div>
          )}

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
  '{store}', '{storeup}', '{countryflag}', '{country}', '{countryup}',
  '{giorno}', '{ora}', '{data}',
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
  '{store}', '{storeup}',
  '{giorno}', '{ora}', '{data}',
  // gestiti da campi dedicati nel PostCard:
  '{custom}', '{coupon}', '{boxcoupon}',
]);

// Gestiti separatamente: auto-calcolati se shipFromCountry è noto, editabili altrimenti
const COUNTRY_TAGS = new Set(['{country}', '{countryflag}', '{countryup}']);

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
    // Country tag: auto-calcolato se shipFromCountry è noto, altrimenti mostra un'unica pill editabile
    if (COUNTRY_TAGS.has(tag)) {
      if (!post.shipFromCountry && !seenFields.has('shipFromCountry')) {
        seenFields.add('shipFromCountry');
        pills.push({ kind: 'system', tag, label: 'Paese spedizione', field: 'shipFromCountry', placeholder: 'Codice ISO: FR, DE, IT, CN...' });
      }
      continue;
    }
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
  // Inizializza dal dest_channel salvato nel DB (persiste ai reload di pagina)
  const [itemChannels, setItemChannels] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const qi of queue) {
      const ch = (qi as any).destChannel;
      if (ch) init[qi.id] = ch;
    }
    return init;
  });
  const [priceWarnings, setPriceWarnings] = useState<string[]>([]);
  const [multiEditSelected, setMultiEditSelected] = useState<Set<string>>(new Set());
  const [splittingId, setSplittingId] = useState<string | null>(null);
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSelected, setMergeSelected] = useState<Set<string>>(new Set());
  const [mergingId, setMergingId] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const [dedupNotice, setDedupNotice] = useState<string | null>(null);
  const dedupDone = useRef(false);

  // Dedup: rimuove articoli duplicati (stesso productId) al caricamento della coda
  React.useEffect(() => {
    if (dedupDone.current || queue.length === 0) return;
    dedupDone.current = true;
    const seen = new Map<string, string>();
    const toRemove: string[] = [];
    for (const item of queue) {
      const posts = item.posts as any[];
      const pids = posts.map((p: any) => p.productId).filter(Boolean);
      if (pids.some((pid: string) => seen.has(pid))) {
        toRemove.push(item.id);
      } else {
        pids.forEach((pid: string) => seen.set(pid, item.id));
      }
    }
    if (toRemove.length > 0) {
      toRemove.forEach(id => autopostApi.delete(id).catch(() => {}));
      setQueue(q => q.filter(x => !toRemove.includes(x.id)));
      setDedupNotice(`${toRemove.length} articol${toRemove.length === 1 ? 'o duplicato rimosso' : 'i duplicati rimossi'} dalla coda`);
    }
  }, [queue]);

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

  // Aggiorna stato locale + persiste nel DB (senza rigenerare immagine)
  const saveQueueField = (item: QueueItem, changes: Partial<CreatedPost>) => {
    updateQueuePost(item.id, changes);
    const updatedPost = { ...(item.posts[0] as CreatedPost), ...changes };
    autopostApi.update(item.id, { posts: [updatedPost], status: item.status }).catch(() => {});
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

    const tpl = templates.find(t => t.id === updatedPost.templateId);
    const cur = updatedPost.platform === 'aliexpress' ? aliCurrencySym(settings.aliexpress.targetCountry) : '€';
    const priceData = {
      prezzo: `${cur}${Number(updatedPost.discountedPrice).toFixed(2)}`,
      prezzoPrecedente: `${cur}${Number(updatedPost.originalPrice).toFixed(2)}`,
      sconto: `-${updatedPost.discountPercent}%`,
      testoCustom: updatedPost.customText,
    };

    // 2. Salva nel DB + genera immagine in parallelo (non aspettare uno per l'altro)
    const savePromise = autopostApi.update(itemId, { posts: [updatedPost], status: currentItem.status }).catch(() => null);
    const imgPromise = tpl
      ? generatePostImage(tpl, updatedPost.image, updatedPost.isHistoricalLow ?? false, updatedPost.platform, priceData)
          .then(gi => { pregenImages.current[itemId] = gi; updateQueuePost(itemId, { generatedImage: gi }); return gi; })
          .catch(() => null)
      : Promise.resolve(null);

    const [, gi] = await Promise.all([savePromise, imgPromise]);

    if (gi) {
      // Salva immagine nel DB (fire-and-forget)
      autopostApi.update(itemId, { posts: [{ ...updatedPost, generatedImage: gi }], status: currentItem.status }).catch(() => {});
    }
  };

  // Cache immagini pre-generate: key = queue item id, value = base64 jpeg
  const pregenImages = React.useRef<Record<string, string>>({});

  // Svuota il cache quando i template cambiano (salvataggio template): forza rigenera col nuovo template
  React.useEffect(() => { pregenImages.current = {}; }, [templates]);

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
            checkout: (freshData as any).checkout ?? post.checkout,
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
      const defaultMultiLay = layouts.find(l => l.tipo === 'multi')?.id ?? 'l3';
      const mergedPosts: CreatedPost[] = allPosts.map((p, i) =>
        i === 0 && composite
          ? { ...p, generatedImage: composite, layoutId: defaultMultiLay }
          : { ...p, layoutId: defaultMultiLay }
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
    const channelOverride = itemChannels[id] || undefined;
    const rawPost = item.posts[0];
    if (!rawPost || typeof rawPost !== 'object' || Array.isArray(rawPost)) {
      setPublishErr('Post non valido'); return;
    }
    const post = rawPost as CreatedPost;
    if (!post.id) { setPublishErr('Post senza ID'); return; }
    const layout = item.tipo === 'multi'
      ? (layouts.find(l => l.tipo === 'multi') ?? layouts.find(l => l.id === post.layoutId))
      : layouts.find(l => l.id === post.layoutId);
    const template = templates.find(t => t.id === post.templateId);
    setPublishErr(null);

    setPublishingId(id);

    // Calcola disable_notification in base a silenzioso per-post e soglia globale
    const sil = item.silenzioso;
    const threshold = settings.notifThreshold;
    let disableNotification: boolean;
    if (sil === true) disableNotification = true;
    else if (sil === false) disableNotification = false;
    else disableNotification = threshold === undefined || (post.discountPercent ?? 0) < threshold;

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
        const perItemTexts: string[] = [];
        if (layoutContenuto.includes('{lista_prodotti}')) {
          const lista = multiPosts.map((mp, i) => {
            const cur = mp.platform === 'aliexpress' ? multiCurrency : '€';
            const title = mp.title.length > 55 ? mp.title.slice(0, 55) + '…' : mp.title;
            const line = `${i + 1}. ${mp.emoji || '📦'} ${title}\n💰 ${cur}${Number(mp.discountedPrice).toFixed(2)} (-${mp.discountPercent}%)`;
            perItemTexts.push(line);
            return line;
          }).join('\n\n');
          expandedLayout = layoutContenuto.replace('{lista_prodotti}', lista);
        } else {
          const defaultMultiLayout = '{_<b>{custom}</b>_}\n<b>{titoloshort}</b>\n💶 A soli: <b>{prezzo}{valuta}</b> invece di: <s>{oldprezzo}€</s>\n{_🎟 <b>Coupon:</b> {coupon}_}\n👉 <a href="{link}">APRI SU AMAZON</a>\n➿➿➿➿➿➿➿➿➿➿➿➿';
          const layoutTpl = layoutContenuto || defaultMultiLayout;
          multiPosts.forEach(mp => {
            const cur = mp.platform === 'aliexpress' ? multiCurrency : '€';
            perItemTexts.push(resolvePostTags(layoutTpl, mp, tags, cur));
          });
          expandedLayout = perItemTexts.join('\n');
        }
        const layoutKb = layout?.keyboardId ? keyboards.find(k => k.id === layout.keyboardId) : null;
        const multiKeyboard = layoutKb?.contenuto;
        generatedImage = (post as any).generatedImage;
        if (!generatedImage) {
          generatedImage = await generateMultiPostImage(multiPosts.map(mp => mp.image)).catch(() => undefined);
        }
        const pubResult = await postsApi.publish(post.id, {
          post, layoutContenuto: expandedLayout, keyboardContenuto: multiKeyboard, generatedImage, disableNotification, channelOverride,
        });
        autopostApi.delete(id).catch(() => {});
        const now = new Date().toISOString();
        const multiItems = multiPosts.map((mp, idx) => ({
          id: mp.id,
          title: mp.title,
          emoji: mp.emoji || '📦',
          image: mp.image || '',
          price: Number(mp.discountedPrice).toFixed(2),
          originalPrice: mp.originalPrice,
          discountPercent: mp.discountPercent,
          platform: mp.platform,
          sourceUrl: mp.sourceUrl || '',
          productId: mp.productId || '',
          customText: mp.customText || '',
          layoutId: mp.layoutId || '',
          isHistoricalLow: mp.isHistoricalLow || false,
          coupon: (mp as any).coupon || '',
          terminata: false,
          resolvedText: perItemTexts[idx] ?? '',
        }));
        const pubRecord = {
          id: post.id, emoji: '🗂️', title: `Post multiplo (${multiPosts.length} prodotti)`,
          price: '0.00', originalPrice: 0, discountPercent: 0,
          platform: post.platform, image: post.image,
          sourceUrl: post.sourceUrl, productId: post.productId,
          customText: post.customText, layoutId: post.layoutId,
          isHistoricalLow: false, isMulti: true, multiItems, terminata: false,
          chatId: pubResult.chatId ?? '', messageId: pubResult.messageId ?? 0,
          publishedAt: now, ts: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
        };
        setPublished(prev => [pubRecord, ...prev]);
        publishedApi.save(pubRecord).catch(() => {});
        setPublishingId(null);
        return;
      }

      // ── Post singolo ───────────────────────────────────────────────────────
      const effectiveTemplate = template;
      if (effectiveTemplate) {
        try {
          generatedImage = await generatePostImage(
            effectiveTemplate, post.image, post.isHistoricalLow, post.platform, {
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
      const pubResult = await postsApi.publish(post.id, { post, layoutContenuto: layout?.contenuto, keyboardContenuto: keyboard?.contenuto, generatedImage, disableNotification, channelOverride });
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

  const moveToEdge = (id: string, edge: 'first' | 'last') => setQueue(q => {
    const a = [...q]; const i = a.findIndex(x => x.id === id);
    if (i < 0) return a;
    const [item] = a.splice(i, 1);
    if (edge === 'first') a.unshift(item); else a.push(item);
    return a;
  });

  const clearAll = async () => {
    try { await autopostApi.deleteAll(); } catch (e) {
      window.alert('Errore: ' + (e instanceof Error ? e.message : String(e)));
    }
    setQueue([]);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dx) < 40) return;
    if (Math.abs(dy) > Math.abs(dx)) return; // ignora scroll verticale
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
  const queueItemChannel = item ? (itemChannels[item.id] ?? '') : '';
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
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px 4px', gap: 6 }}>
        <button className="hbk" disabled={safeIdx === 0} style={{ opacity: safeIdx === 0 ? 0.25 : 1 }}
          onClick={() => { setCurrentIdx(0); setExpandedId(null); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width={16} height={16}>
            <path d="M19 12H5M5 12l5-5M5 12l5 5" /><line x1="5" y1="5" x2="5" y2="19" strokeWidth="2.5"/>
          </svg>
        </button>
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
        <button className="hbk" disabled={safeIdx === queue.length - 1} style={{ opacity: safeIdx === queue.length - 1 ? 0.25 : 1 }}
          onClick={() => { setCurrentIdx(queue.length - 1); setExpandedId(null); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width={16} height={16}>
            <path d="M5 12h14M14 7l5 5-5 5" /><line x1="19" y1="5" x2="19" y2="19" strokeWidth="2.5"/>
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

      {dedupNotice && (
        <div style={{ margin: '0 0 8px', padding: '8px 12px', background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.35)', borderRadius: 8, fontSize: 12, color: 'var(--t1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>⚠️ {dedupNotice}</span>
          <button onClick={() => setDedupNotice(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t2)', fontSize: 14 }}>✕</button>
        </div>
      )}

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
          {(() => {
            const sil = item.silenzioso;
            const notifLabel = sil === false ? '🔔' : sil === true ? '🔕' : '🔔';
            const notifBg = sil === false ? 'rgba(74,222,128,0.15)' : sil === true ? 'rgba(100,100,100,0.15)' : 'var(--bg3)';
            const notifColor = sil === false ? '#4ade80' : sil === true ? 'var(--t3)' : 'var(--t2)';
            const notifBorder = sil === false ? '1px solid #4ade80' : sil === true ? '1px solid var(--bd)' : '1px solid var(--bd)';
            const btnBase: React.CSSProperties = { height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: '1px solid var(--bd)', background: 'var(--bg3)', color: 'var(--t2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '0 10px', gap: 4, flexShrink: 0 };
            const toggleSil = () => {
              const next = sil === undefined ? false : sil === false ? true : undefined;
              setQueue(q => q.map(x => x.id === item.id ? { ...x, silenzioso: next } : x));
              autopostApi.update(item.id, { silenzioso: next ?? null } as any).catch(() => {});
            };
            return (
              <div style={{ padding: '4px 16px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* Riga secondaria: posizione + notifica + modifica + refresh + elimina */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button style={{ ...btnBase, opacity: safeIdx === 0 ? 0.3 : 1 }}
                    onClick={() => { moveToEdge(item.id, 'first'); setCurrentIdx(0); }}
                    disabled={safeIdx === 0} title="Porta in cima alla coda">⇈</button>
                  <button style={{ ...btnBase, opacity: safeIdx === 0 ? 0.3 : 1 }}
                    onClick={() => { move(item.id, 'up'); setCurrentIdx(i => Math.max(0, i - 1)); }}
                    disabled={safeIdx === 0} title="Sposta su">↑</button>
                  <button style={{ ...btnBase, opacity: safeIdx === queue.length - 1 ? 0.3 : 1 }}
                    onClick={() => { move(item.id, 'down'); setCurrentIdx(i => Math.min(queue.length - 1, i + 1)); }}
                    disabled={safeIdx === queue.length - 1} title="Sposta giù">↓</button>
                  <button style={{ ...btnBase, opacity: safeIdx === queue.length - 1 ? 0.3 : 1 }}
                    onClick={() => { moveToEdge(item.id, 'last'); setCurrentIdx(queue.length - 1); }}
                    disabled={safeIdx === queue.length - 1} title="Porta in fondo alla coda">⇊</button>
                  <button style={{ ...btnBase, background: notifBg, color: notifColor, border: notifBorder }} onClick={toggleSil}
                    title={sil === false ? 'Con notifica' : sil === true ? 'Silenzioso' : 'Notifica automatica'}>
                    {notifLabel}
                  </button>
                  <div style={{ flex: 1 }} />
                  <button style={{ ...btnBase }} onClick={() => setExpandedId(isEditing ? null : item.id)}>
                    {isEditing ? '✕' : '✏️'}
                  </button>
                  <button style={{ ...btnBase, opacity: regeneratingId ? 0.5 : 1 }}
                    onClick={() => regenerate(item.id)} disabled={!!regeneratingId}>
                    {regeneratingId === item.id ? '⏳' : '🔄'}
                  </button>
                  <button style={{ ...btnBase, background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
                    onClick={() => del(item.id)}>🗑️</button>
                </div>
                {/* Riga primaria: pubblica (full width, prominente) */}
                <button
                  style={{ height: 42, borderRadius: 10, border: 'none', background: publishingId ? 'var(--bg3)' : 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#fff', fontSize: 15, fontWeight: 800, cursor: publishingId ? 'not-allowed' : 'pointer', opacity: publishingId ? 0.6 : 1, letterSpacing: 0.3, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  onClick={() => publish(item.id)} disabled={!!publishingId}>
                  {publishingId === item.id ? '⏳ Invio...' : '⚡ Pubblica ora'}
                </button>
              </div>
            );
          })()}

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
                <select className="sel" value={p.layoutId} onChange={e => saveQueueField(item, { layoutId: e.target.value })}>
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
              {/* 1. Titolo */}
              <div style={{ marginBottom: 10 }}>
                <div className="lbl">TITOLO</div>
                <input className="inp" defaultValue={p.title} key={item.id + '-title'}
                  onBlur={e => updatePostWithImage(item.id, { title: e.target.value })} />
              </div>
              {/* 2. Prezzi */}
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
              {/* 3. Minimo storico */}
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
              {/* 4. Custom text — solo se {custom} è nel layout */}
              {layout?.contenuto.includes('{custom}') && (
                <div style={{ marginBottom: 10 }}>
                  <div className="lbl">TESTO PERSONALIZZATO <span style={{ fontSize: 10, color: 'var(--a1)', fontFamily: 'monospace', fontWeight: 400 }}>{'{custom}'}</span></div>
                  <CustomTextEditor key={item.id + '-custom'} initialValue={p.customText || ''}
                    onSave={v => updatePostWithImage(item.id, { customText: v })} />
                </div>
              )}
              {/* 5. Coupon — solo se {coupon}/{boxcoupon} è nel layout */}
              {(layout?.contenuto.includes('{coupon}') || layout?.contenuto.includes('{boxcoupon}')) && (
                <div style={{ marginBottom: 10 }}>
                  <div className="lbl">COUPON <span style={{ fontSize: 10, color: 'var(--a1)', fontFamily: 'monospace', fontWeight: 400 }}>{'{coupon}'}</span></div>
                  <input className="inp" key={item.id + '-coupon'} defaultValue={p.coupon || ''}
                    onBlur={e => updatePostWithImage(item.id, { coupon: e.target.value })}
                    placeholder="Codice sconto (es. PROMO20)..." />
                </div>
              )}
              {/* 6. Layout testo */}
              <div style={{ marginBottom: 10 }}>
                <div className="lbl">LAYOUT TESTO</div>
                <select className="sel" value={p.layoutId} onChange={e => saveQueueField(item, { layoutId: e.target.value })}>
                  {layouts.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
                </select>
              </div>
              {/* 7. Tastiera */}
              <div style={{ marginBottom: 4 }}>
                <div className="lbl">TASTIERA BOTTONI</div>
                <select className="sel" value={p.keyboardId ?? keyboards[0]?.id ?? ''} onChange={e => saveQueueField(item, { keyboardId: e.target.value })}>
                  {keyboards.map(k => <option key={k.id} value={k.id}>{k.nome}</option>)}
                </select>
              </div>
              {/* 8. Pill tag: tutti i tag non auto-calcolati nel layout */}
              <TagEditButtons
                layout={layout}
                post={p}
                postTags={tags}
                onUpdate={ch => updatePostWithImage(item.id, ch)}
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

function MultiThumbnailGrid({
  items, terminataText, terminataColor,
}: {
  items: { image?: string; emoji?: string; title?: string; terminata?: boolean }[];
  terminataText?: string;
  terminataColor?: string;
}) {
  if (items.length === 0) return null;
  const cols = items.length <= 3 ? items.length : items.length <= 4 ? 2 : 3;
  const cellSize = 120;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 10px 0' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`, gap: 3, background: 'var(--bg3)', borderRadius: 8, overflow: 'hidden' }}>
        {items.map((item, i) => (
          <div key={i} style={{ width: cellSize, height: cellSize, position: 'relative', background: '#f5f5f5', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {item.image
              ? <img
                  src={item.image.startsWith('http') ? `/api/posts?img=${encodeURIComponent(item.image)}` : item.image}
                  alt={item.title ?? ''}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', filter: item.terminata ? 'grayscale(1)' : 'none' }}
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              : <span style={{ fontSize: 32, filter: item.terminata ? 'grayscale(1)' : 'none' }}>{item.emoji || '📦'}</span>
            }
            {item.terminata && terminataText && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 4, pointerEvents: 'none' }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: terminataColor || '#ff0000', textShadow: '0 0 3px #000, 0 0 6px #000', textAlign: 'center', lineHeight: 1.2 }}>
                  {terminataText}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type EditFields = { title: string; originalPrice: string; discountedPrice: string; discountPercent: number; customText: string; coupon: string; isHistoricalLow: boolean; tagOverrides: Record<string, string> };
type MultiEditMap = Record<number, EditFields>;

export function PublishedPage({ nav }: { nav: (p: NavPage) => void }) {
  const { published, setPublished, setQueue, layouts, keyboards, tags, settings, templates } = useApp();
  // editingKey: "postId" per singolo, "postId:multi" per multi-post
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<EditFields>({ title: '', originalPrice: '', discountedPrice: '', discountPercent: 0, customText: '', coupon: '', isHistoricalLow: false, tagOverrides: {} });
  const [activeTagPill, setActiveTagPill] = useState<string | null>(null);
  const [tagPillVal, setTagPillVal] = useState('');
  const [multiEditMap, setMultiEditMap] = useState<MultiEditMap>({});
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

  const startEditSingle = (p: typeof published[0]) => {
    setEditingKey(p.id);
    setEditFields({
      title: p.title, originalPrice: String(p.originalPrice),
      discountedPrice: p.price, discountPercent: p.discountPercent,
      customText: p.customText || '', coupon: '',
      isHistoricalLow: p.isHistoricalLow ?? false,
      tagOverrides: p.tagOverrides ?? {},
    });
    setActiveTagPill(null);
    setEditErr('');
  };

  const startEditMulti = (p: typeof published[0]) => {
    const map: MultiEditMap = {};
    (p.multiItems ?? []).forEach((item, idx) => {
      map[idx] = {
        title: item.title, originalPrice: String(item.originalPrice),
        discountedPrice: item.price, discountPercent: item.discountPercent,
        customText: item.customText || '', coupon: item.coupon || '',
        isHistoricalLow: item.isHistoricalLow ?? false, tagOverrides: {},
      };
    });
    setMultiEditMap(map);
    setEditingKey(`${p.id}:multi`);
    setEditErr('');
  };

  const startEditItem = (p: typeof published[0], idx: number) => {
    const item = p.multiItems?.[idx];
    if (!item) return;
    setEditFields({
      title: item.title, originalPrice: String(item.originalPrice),
      discountedPrice: item.price, discountPercent: item.discountPercent,
      customText: item.customText || '', coupon: item.coupon || '',
      isHistoricalLow: item.isHistoricalLow ?? false,
      tagOverrides: {},
    });
    setActiveTagPill(null);
    setEditingKey(`${p.id}:item:${idx}`);
    setEditErr('');
  };

  const handlePriceChange = (field: 'originalPrice' | 'discountedPrice', val: string) => {
    const orig = field === 'originalPrice' ? parseFloat(val) || 0 : parseFloat(editFields.originalPrice) || 0;
    const disc = field === 'discountedPrice' ? parseFloat(val) || 0 : parseFloat(editFields.discountedPrice) || 0;
    const pct = orig > 0 ? Math.max(0, Math.round((1 - disc / orig) * 100)) : 0;
    setEditFields(prev => ({ ...prev, [field]: val, discountPercent: pct }));
  };

  const saveEdit = async (p: typeof published[0]) => {
    if (!p.chatId || !p.messageId) { setEditErr('message_id Telegram non disponibile.'); return; }
    setSaving(true); setEditErr('');
    try {
      // ── Modifica singolo articolo di un multi-post ──
      const itemMatch = editingKey?.match(new RegExp(`^${p.id}:item:(\\d+)$`));
      if (itemMatch && p.multiItems) {
        const idx = parseInt(itemMatch[1]);
        const origItem = p.multiItems[idx];
        if (!origItem) { setEditErr('Articolo non trovato'); return; }
        const origP = parseFloat(editFields.originalPrice) || 0;
        const discP = parseFloat(editFields.discountedPrice) || 0;
        const pct = origP > 0 ? Math.max(0, Math.round((1 - discP / origP) * 100)) : editFields.discountPercent;
        const cur = origItem.platform === 'aliexpress' ? aliCurrencySym(settings.aliexpress.targetCountry) : '€';
        const layout = layouts.find(l => l.id === origItem.layoutId) ?? layouts.find(l => l.tipo === 'multi');
        const updPost = { id: origItem.id, platform: origItem.platform as Platform, sourceUrl: origItem.sourceUrl, productId: origItem.productId, title: editFields.title, image: origItem.image, emoji: origItem.emoji, originalPrice: origP, discountedPrice: discP, discountPercent: pct, customText: editFields.customText, coupon: editFields.coupon, isHistoricalLow: editFields.isHistoricalLow, tagOverrides: editFields.tagOverrides, templateId: 'tpl1', layoutId: origItem.layoutId, keyboardId: 'kb1' } as CreatedPost;
        const newText = layout ? resolvePostTags(layout.contenuto, updPost, tags, cur) : '';
        const newItems = p.multiItems.map((it, i) => i === idx ? { ...it, title: editFields.title, price: discP.toFixed(2), originalPrice: origP, discountPercent: pct, customText: editFields.customText, coupon: editFields.coupon, isHistoricalLow: editFields.isHistoricalLow, resolvedText: newText } : it);
        const newCaption = newItems.map(it => it.resolvedText ?? '').filter(Boolean).join('\n');
        setPublished(prev => prev.map(x => x.id !== p.id ? x : { ...x, multiItems: newItems }));
        setEditingKey(null);
        await publishedApi.editTelegram(p.id, { action: 'editPublished', chatId: p.chatId, messageId: p.messageId, newCaption, updatedFields: { multiItems: newItems } } as any);
        return;
      }

      const isMultiEdit = editingKey === `${p.id}:multi`;
      let newCaption: string | undefined;

      if (isMultiEdit && p.multiItems) {
        // Ricostruisce tutte le sezioni con i valori modificati
        const defaultMultiLayout = '{_<b>{custom}</b>_}\n<b>{titoloshort}</b>\n💶 A soli: <b>{prezzo}{valuta}</b> invece di: <s>{oldprezzo}€</s>\n{_🎟 <b>Coupon:</b> {coupon}_}\n👉 <a href="{link}">APRI SU AMAZON</a>\n➿➿➿➿➿➿➿➿➿➿➿➿';
        const newItemTexts: string[] = [];
        const newItems = p.multiItems.map((item, idx) => {
          const ef = multiEditMap[idx] ?? { title: item.title, originalPrice: String(item.originalPrice), discountedPrice: item.price, discountPercent: item.discountPercent, customText: item.customText || '', coupon: item.coupon || '' };
          const origP = parseFloat(ef.originalPrice) || 0;
          const discP = parseFloat(ef.discountedPrice) || 0;
          const cur = item.platform === 'aliexpress' ? aliCurrencySym(settings.aliexpress.targetCountry) : '€';
          const layout = layouts.find(l => l.id === item.layoutId);
          const updPost = {
            id: item.id, platform: item.platform as Platform, sourceUrl: item.sourceUrl, productId: item.productId,
            title: ef.title, image: item.image, emoji: item.emoji,
            originalPrice: origP, discountedPrice: discP, discountPercent: ef.discountPercent,
            customText: ef.customText, coupon: ef.coupon,
            isHistoricalLow: item.isHistoricalLow, templateId: 'tpl1', layoutId: item.layoutId, keyboardId: 'kb1',
          } as CreatedPost;
          const txt = layout ? resolvePostTags(layout.contenuto, updPost, tags, cur) : resolvePostTags(defaultMultiLayout, updPost, tags, cur);
          newItemTexts.push(txt);
          return { ...item, title: ef.title, price: discP.toFixed(2), originalPrice: origP, discountPercent: ef.discountPercent, customText: ef.customText, coupon: ef.coupon, resolvedText: txt };
        });
        newCaption = newItemTexts.join('\n');
        setPublished(prev => prev.map(x => x.id !== p.id ? x : { ...x, multiItems: newItems }));
        await publishedApi.editTelegram(p.id, { action: 'editPublished', chatId: p.chatId, messageId: p.messageId, newCaption, updatedFields: { multiItems: newItems } } as any);
      } else {
        // Post singolo
        const origPrice = parseFloat(editFields.originalPrice) || 0;
        const discPrice = parseFloat(editFields.discountedPrice) || 0;
        const layout = layouts.find(l => l.id === p.layoutId);
        const cur = p.platform === 'aliexpress' ? aliCurrencySym(settings.aliexpress.targetCountry) : '€';
        const updatedPost = {
          id: p.id, platform: p.platform as Platform, sourceUrl: p.sourceUrl, productId: p.productId,
          title: editFields.title, image: p.image, emoji: p.emoji,
          originalPrice: origPrice, discountedPrice: discPrice,
          discountPercent: editFields.discountPercent, customText: editFields.customText,
          isHistoricalLow: editFields.isHistoricalLow, tagOverrides: editFields.tagOverrides,
          templateId: 'tpl1', layoutId: p.layoutId, keyboardId: 'kb1',
        } as CreatedPost;
        newCaption = layout ? resolvePostTags(layout.contenuto, updatedPost, tags, cur) : editFields.customText;
        setPublished(prev => prev.map(x => x.id !== p.id ? x : {
          ...x, title: editFields.title, originalPrice: origPrice,
          price: discPrice.toFixed(2), discountPercent: editFields.discountPercent,
          customText: editFields.customText,
          isHistoricalLow: editFields.isHistoricalLow,
          tagOverrides: editFields.tagOverrides,
        }));
        await publishedApi.editTelegram(p.id, {
          action: 'editPublished', chatId: p.chatId, messageId: p.messageId, newCaption,
          updatedFields: { title: editFields.title, originalPrice: origPrice, discountedPrice: discPrice, discountPercent: editFields.discountPercent, customText: editFields.customText, isHistoricalLow: editFields.isHistoricalLow },
        } as any);
      }
      setEditingKey(null);
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : 'Errore durante la modifica');
    } finally {
      setSaving(false);
    }
  };

  const markTerminataSingle = async (p: typeof published[0]) => {
    if (!p.chatId || !p.messageId) { alert('message_id non disponibile'); return; }
    if (!window.confirm(`Segnare "${p.title.slice(0, 30)}..." come TERMINATA?`)) return;

    const terminataCfg = settings.terminata;
    const tmpl = templates[0];
    const telegramMode = terminataCfg.telegramMode ?? 'keep';
    const telegramText = terminataCfg.telegramText ?? '❌ Offerta terminata';

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

    const body: Record<string, any> = { chatId: p.chatId, messageId: p.messageId, terminata: true, newImage, telegramMode };
    if (telegramMode === 'only') {
      body.telegramText = telegramText;
    } else if (telegramMode === 'append') {
      body.telegramText = telegramText;
      const postLayout = layouts.find(l => l.id === p.layoutId);
      body.layoutContenuto = postLayout?.contenuto ?? '';
      body.postData = {
        title: p.title, discountedPrice: Number(p.price), originalPrice: p.originalPrice,
        discountPercent: p.discountPercent, customText: p.customText,
        isHistoricalLow: p.isHistoricalLow, platform: p.platform, sourceUrl: p.sourceUrl,
        productId: p.productId,
      };
    }

    try {
      await publishedApi.editTelegram(p.id, body as any);
      setPublished(prev => prev.map(x => x.id === p.id ? { ...x, terminata: true } : x));
    } catch (e) {
      alert('Errore: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const markTerminataItem = async (p: typeof published[0], idx: number) => {
    if (!p.chatId || !p.messageId) { alert('message_id non disponibile'); return; }
    const item = p.multiItems?.[idx];
    if (!item) return;
    if (!window.confirm(`Terminare "${item.title.slice(0, 30)}..."?`)) return;

    const terminataCfg = settings.terminata;
    const telegramMode = terminataCfg.telegramMode ?? 'keep';
    const telegramText = terminataCfg.telegramText ?? '❌ Offerta terminata';

    // Genera immagine composita con solo quella cella in grigio
    let newImage: string | undefined;
    const allImages = (p.multiItems ?? []).map(it => it.image);
    const alreadyTerminated = (p.multiItems ?? []).map((it, i) => i !== idx && !!it.terminata ? i : -1).filter(i => i >= 0);
    const terminatedNow = [...alreadyTerminated, idx];
    try {
      newImage = await generateMultiTerminataImage(allImages, terminatedNow, terminataCfg);
    } catch { /* usa immagine originale */ }

    // Ricostruisce il testo completo con terminata per questa sezione
    let newCaption: string | undefined;
    if (telegramMode !== 'keep' && p.multiItems) {
      const sections = p.multiItems.map((it, i) => {
        const base = it.resolvedText ?? '';
        const isTerminata = i === idx || !!it.terminata;
        if (isTerminata) {
          if (telegramMode === 'only') return telegramText;
          if (telegramMode === 'append') return `${telegramText}\n${base}`;
        }
        return base;
      });
      newCaption = sections.join('\n');
    }

    const body: Record<string, any> = {
      chatId: p.chatId, messageId: p.messageId, terminata: true,
      newImage, telegramMode, multiItemIndex: idx,
      ...(newCaption !== undefined ? { newCaption } : {}),
    };

    try {
      await publishedApi.editTelegram(p.id, body as any);
      setPublished(prev => prev.map(x => {
        if (x.id !== p.id) return x;
        const newItems = (x.multiItems ?? []).map((it, i) => i === idx ? { ...it, terminata: true } : it);
        const allDone = newItems.every(it => it.terminata);
        return { ...x, multiItems: newItems, terminata: allDone };
      }));
    } catch (e) {
      alert('Errore: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const renderEditForm = (p: typeof published[0], isMultiItem: boolean) => {
    // Determina il layout da cui estrarre i tag
    let layoutForTags: typeof layouts[0] | undefined;
    if (isMultiItem) {
      const idxM = editingKey?.match(new RegExp(`^${p.id}:item:(\\d+)$`));
      if (idxM) {
        const it = p.multiItems?.[parseInt(idxM[1])];
        layoutForTags = layouts.find(l => l.id === it?.layoutId);
      }
    } else {
      layoutForTags = layouts.find(l => l.id === p.layoutId);
    }

    const tagPills: { tag: string; label: string }[] = [];
    if (layoutForTags) {
      const seen = new Set<string>();
      for (const tag of extractLayoutTags(layoutForTags.contenuto)) {
        if (AUTO_COMPUTED_TAGS.has(tag) || COUNTRY_TAGS.has(tag)) continue;
        if (seen.has(tag)) continue;
        seen.add(tag);
        const sys = EDITABLE_SYSTEM_TAG_MAP[tag];
        tagPills.push({ tag, label: sys ? sys.label : tag.replace(/[{}]/g, '') });
      }
    }

    const saveTagPill = (tag: string, val: string) => {
      setEditFields(prev => ({ ...prev, tagOverrides: { ...prev.tagOverrides, [tag]: val } }));
      setActiveTagPill(null);
    };

    return (
      <>
        <div style={{ marginBottom: 8 }}>
          <div className="lbl">TITOLO</div>
          <input className="inp" value={editFields.title} onChange={e => setEditFields(prev => ({ ...prev, title: e.target.value }))} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
          <div style={{ flex: 1 }}>
            <div className="lbl">PREZZO ORIG.</div>
            <input className="inp" type="number" step="0.01" value={editFields.originalPrice}
              onChange={e => handlePriceChange('originalPrice', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="lbl">PREZZO SCONTATO</div>
            <input className="inp" type="number" step="0.01" value={editFields.discountedPrice}
              onChange={e => handlePriceChange('discountedPrice', e.target.value)} />
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--am2)', fontWeight: 700, marginBottom: 8, textAlign: 'right' }}>
          -{editFields.discountPercent}%
        </div>
        <div className="lbl">TESTO PERSONALIZZATO</div>
        <textarea className="txta" rows={2} value={editFields.customText}
          onChange={e => setEditFields(prev => ({ ...prev, customText: e.target.value }))}
          style={{ marginBottom: 8 }} />
        {/* Toggle minimo storico */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: tagPills.length ? 8 : 6 }}>
          <span style={{ fontSize: 12, color: 'var(--t2)', flex: 1 }}>🏆 Minimo storico</span>
          <button
            className={`btn bsm ${editFields.isHistoricalLow ? 'bgr' : 'bs'}`}
            style={{ minWidth: 52, fontWeight: 700 }}
            onClick={() => setEditFields(prev => ({ ...prev, isHistoricalLow: !prev.isHistoricalLow }))}>
            {editFields.isHistoricalLow ? '✓ ON' : 'OFF'}
          </button>
        </div>
        {/* Tag pills */}
        {tagPills.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div className="lbl">TAG NEL LAYOUT</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: activeTagPill ? 6 : 0 }}>
              {tagPills.map(tp => {
                const val = editFields.tagOverrides[tp.tag] ?? '';
                const active = activeTagPill === tp.tag;
                return (
                  <button key={tp.tag}
                    onClick={() => { setActiveTagPill(active ? null : tp.tag); setTagPillVal(editFields.tagOverrides[tp.tag] ?? ''); }}
                    style={{
                      padding: '5px 11px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: `1px solid ${active ? 'var(--a1)' : val ? 'var(--am2)' : 'var(--bg4)'}`,
                      background: active ? 'var(--bg4)' : val ? '#1a1200' : 'var(--bg3)',
                      color: active ? 'var(--a1)' : val ? 'var(--am2)' : 'var(--t3)',
                    }}>
                    {tp.label}{val ? `: ${val.length > 14 ? val.slice(0, 14) + '…' : val}` : ''}
                  </button>
                );
              })}
            </div>
            {activeTagPill && tagPills.find(tp => tp.tag === activeTagPill) && (
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <input className="inp" style={{ flex: 1 }} autoFocus value={tagPillVal}
                  placeholder={`Valore per {${activeTagPill.replace(/[{}]/g, '')}}...`}
                  onChange={e => setTagPillVal(e.target.value)}
                  onBlur={() => saveTagPill(activeTagPill, tagPillVal)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveTagPill(activeTagPill, tagPillVal);
                    if (e.key === 'Escape') setActiveTagPill(null);
                  }} />
                <button className="btn bgr bsm" style={{ padding: '6px 12px', flexShrink: 0 }}
                  onMouseDown={e => { e.preventDefault(); saveTagPill(activeTagPill, tagPillVal); }}>✓</button>
              </div>
            )}
          </div>
        )}
        {editErr && <ErrorBanner>{editErr}</ErrorBanner>}
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn bs bsm" style={{ flex: 1 }} onClick={() => { setEditingKey(null); setActiveTagPill(null); }}>Annulla</button>
          <button className="btn bp bsm" style={{ flex: 2 }} disabled={saving}
            onClick={() => saveEdit(p)}>{saving ? '...' : '💾 Salva su Telegram'}</button>
        </div>
      </>
    );
  };

  const renderMultiEditForm = (p: typeof published[0]) => (
    <div style={{ borderTop: '1px solid var(--bd)', padding: '12px 0 4px' }}>
      <div className="stit">MODIFICA POST MULTIPLO — {p.multiItems?.length ?? 0} PRODOTTI</div>
      {(p.multiItems ?? []).map((item, idx) => {
        const ef = multiEditMap[idx] ?? { title: item.title, originalPrice: String(item.originalPrice), discountedPrice: item.price, discountPercent: item.discountPercent, customText: item.customText || '', coupon: item.coupon || '' };
        const setEf = (changes: Partial<EditFields>) => setMultiEditMap(prev => ({ ...prev, [idx]: { ...ef, ...changes } }));
        const origN = parseFloat(ef.originalPrice) || 0;
        const discN = parseFloat(ef.discountedPrice) || 0;
        const handleMPrice = (field: 'originalPrice' | 'discountedPrice', val: string) => {
          const o = field === 'originalPrice' ? parseFloat(val) || 0 : origN;
          const d = field === 'discountedPrice' ? parseFloat(val) || 0 : discN;
          setEf({ [field]: val, discountPercent: o > 0 ? Math.max(0, Math.round((1 - d / o) * 100)) : 0 });
        };
        return (
          <div key={item.id || idx} style={{ marginBottom: 10, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 6, fontWeight: 600 }}>{idx + 1}. {item.emoji} {item.title.slice(0, 40)}</div>
            <input className="inp" style={{ marginBottom: 6, fontSize: 12 }} value={ef.title}
              onChange={e => setEf({ title: e.target.value })} placeholder="Titolo" />
            <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              <div style={{ flex: 1 }}>
                <div className="lbl" style={{ fontSize: 10 }}>PREZZO ORIG.</div>
                <input className="inp" type="text" inputMode="decimal" style={{ fontSize: 12 }} value={ef.originalPrice}
                  onChange={e => handleMPrice('originalPrice', e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="lbl" style={{ fontSize: 10 }}>PREZZO SCONT.</div>
                <input className="inp" type="text" inputMode="decimal" style={{ fontSize: 12 }} value={ef.discountedPrice}
                  onChange={e => handleMPrice('discountedPrice', e.target.value)} />
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--am2)', fontWeight: 700, marginBottom: 6, textAlign: 'right' }}>-{ef.discountPercent}%</div>
            <input className="inp" style={{ marginBottom: 4, fontSize: 12 }} value={ef.customText}
              onChange={e => setEf({ customText: e.target.value })} placeholder="Testo personalizzato..." />
            <input className="inp" style={{ fontSize: 12 }} value={ef.coupon}
              onChange={e => setEf({ coupon: e.target.value })} placeholder="Coupon (opzionale)..." />
          </div>
        );
      })}
      {editErr && <ErrorBanner>{editErr}</ErrorBanner>}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button className="btn bs bsm" style={{ flex: 1 }} onClick={() => setEditingKey(null)}>Annulla</button>
        <button className="btn bp bsm" style={{ flex: 2 }} disabled={saving}
          onClick={() => saveEdit(p)}>{saving ? '...' : '💾 Salva su Telegram'}</button>
      </div>
    </div>
  );

  const mainTemplate = templates[0];

  return (
    <div className="pg">
      <PageHeader title="Pubblicati oggi" onBack={() => nav('dash')} badge={`${published.length}`} badgeVariant="green" />
      <div style={{ height: 8 }} />
      {!published.length && (
        <EmptyState icon="✅" text="Nessun post pubblicato oggi."
          action={<button className="btn bp" onClick={() => nav('queue')}>Vai alla coda</button>} />
      )}
      {published.map(p => {
        const pCurrency = p.platform === 'aliexpress' ? aliCurrencySym(settings.aliexpress.targetCountry) : '€';
        const pAsPost: CreatedPost = {
          id: p.id, platform: p.platform as Platform, sourceUrl: p.sourceUrl, productId: p.productId,
          title: p.title, image: p.image, emoji: p.emoji,
          originalPrice: p.originalPrice, discountedPrice: parseFloat(p.price),
          discountPercent: p.discountPercent, customText: p.customText,
          isHistoricalLow: p.isHistoricalLow, tagOverrides: p.tagOverrides,
          templateId: 'tpl1', layoutId: p.layoutId, keyboardId: 'kb1',
        };
        const pLayout = layouts.find(l => l.id === p.layoutId);
        const pKb = keyboards.find(k => k.id === (pLayout?.keyboardId ?? 'kb1'));
        const pPreviewText = !p.isMulti && pLayout
          ? resolvePostTags(pLayout.contenuto, pAsPost, tags, pCurrency)
          : (() => {
            const stored = (p.multiItems ?? []).map(it => it.resolvedText ?? '').filter(Boolean).join('\n');
            if (stored) return stored;
            return (p.multiItems ?? []).map(it => `${it.emoji || '📦'} <b>${it.title}</b>\n💶 €${it.price} (-${it.discountPercent}%)`).join('\n\n');
          })();
        const pKbBtns: string[] | undefined = pKb
          ? undefined
          : (p.isMulti ? undefined : [`🛒 Compra su ${p.platform === 'amazon' ? 'Amazon' : 'AliExpress'}`]);

        return (
          <div key={p.id} className="card" style={{ margin: '0 16px 12px', padding: 0, overflow: 'hidden' }}>

            {/* ── Post singolo ── */}
            {!p.isMulti && (
              <>
                <TemplateImagePreview post={pAsPost} template={mainTemplate} />
                <div style={{ padding: '10px 12px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <SourceBadge platform={p.platform} />
                    <span style={{ fontSize: 10, color: 'var(--t3)' }}>{p.ts || new Date(p.publishedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>
                    {p.isHistoricalLow && <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 700 }}>🏆 MIN</span>}
                    {p.terminata && <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 700, background: '#2a0808', padding: '2px 7px', borderRadius: 10, border: '1px solid #5a1515' }}>❌ TERMINATA</span>}
                    {p.messageId > 0 && <span style={{ fontSize: 9, color: 'var(--gr2)', marginLeft: 'auto' }}>✓ ID:{p.messageId}</span>}
                  </div>
                  {pPreviewText && editingKey !== p.id && (
                    <div style={{ marginBottom: 10 }}>
                      <TelegramPreview text={pPreviewText} buttons={pKbBtns} />
                    </div>
                  )}
                  {editingKey === p.id ? renderEditForm(p, false) : (
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      <button className="btn bsm bgh" disabled={p.terminata} onClick={() => startEditSingle(p)}>✏️ Modifica</button>
                      <button className="btn bsm bgh" style={{ color: '#ef4444' }} disabled={p.terminata} onClick={() => markTerminataSingle(p)}>❌ Terminata</button>
                      <button className="btn bsm bbl" disabled={p.terminata} onClick={() => reinsert(p)}>↩️ Ri-accoda</button>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ── Post multiplo ── */}
            {p.isMulti && (
              <>
                {/* 1. Griglia immagini: celle terminate diventano grigie con testo overlay */}
                <MultiThumbnailGrid
                  items={p.multiItems ?? []}
                  terminataText={settings.terminata.overlayText}
                  terminataColor={settings.terminata.overlayTextColor}
                />

                <div style={{ padding: '10px 12px 12px' }}>
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <SourceBadge platform={p.platform} />
                    <span style={{ fontSize: 10, color: 'var(--a1)', fontWeight: 700 }}>🗂️ MULTI ({p.multiItems?.length ?? 0})</span>
                    <span style={{ fontSize: 10, color: 'var(--t3)' }}>{p.ts || new Date(p.publishedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>
                    {p.terminata && <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 700, background: '#2a0808', padding: '2px 7px', borderRadius: 10, border: '1px solid #5a1515' }}>❌ TERMINATA</span>}
                    {p.messageId > 0 && <span style={{ fontSize: 9, color: 'var(--gr2)', marginLeft: 'auto' }}>✓ ID:{p.messageId}</span>}
                  </div>

                  {/* 2. Testo Telegram (nascosto se in editing) */}
                  {pPreviewText && !editingKey?.startsWith(p.id) && (
                    <div style={{ marginBottom: 10 }}>
                      <TelegramPreview text={pPreviewText} buttons={pKbBtns} />
                    </div>
                  )}

                  {/* 3. Editor tutti i prodotti */}
                  {editingKey === `${p.id}:multi` && renderMultiEditForm(p)}

                  {/* 4. Lista prodotti con thumbnail, ✏️ per-item e ❌ termina */}
                  {editingKey !== `${p.id}:multi` && (p.multiItems ?? []).map((item, idx) => (
                    <div key={item.id || idx} style={{ borderBottom: idx < (p.multiItems?.length ?? 0) - 1 ? '1px solid var(--bd)' : 'none' }}>
                      {editingKey === `${p.id}:item:${idx}` ? (
                        /* Form inline per questo articolo */
                        <div style={{ padding: '8px 0' }}>{renderEditForm(p, true)}</div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', opacity: item.terminata ? 0.6 : 1 }}>
                          {/* Thumbnail */}
                          <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {item.image
                              ? <img src={item.image.startsWith('http') ? `/api/posts?img=${encodeURIComponent(item.image)}` : item.image}
                                  alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: item.terminata ? 'grayscale(1)' : 'none' }}
                                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                              : <span style={{ fontSize: 18 }}>{item.emoji || '📦'}</span>
                            }
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                            <div style={{ fontSize: 11, color: item.terminata ? 'var(--t3)' : 'var(--gr2)', textDecoration: item.terminata ? 'line-through' : 'none' }}>
                              €{item.price} <span style={{ color: 'var(--t3)' }}>-{item.discountPercent}%</span>
                            </div>
                          </div>
                          {/* ✏️ per-item e ❌ termina */}
                          {!item.terminata && <button className="btn bsm bgh" style={{ flexShrink: 0, fontSize: 11 }} onClick={() => startEditItem(p, idx)}>✏️</button>}
                          {item.terminata
                            ? <span style={{ fontSize: 9, color: '#ef4444', fontWeight: 700, flexShrink: 0 }}>❌</span>
                            : <button className="btn bsm bgh" style={{ color: '#ef4444', flexShrink: 0 }} onClick={() => markTerminataItem(p, idx)}>❌</button>
                          }
                        </div>
                      )}
                    </div>
                  ))}

                  {/* 5. Nessun dato disponibile per vecchi multi-post */}
                  {!(p.multiItems?.length) && (
                    <div style={{ fontSize: 11, color: 'var(--t3)', padding: '6px 0' }}>Dati prodotti non disponibili (post precedente)</div>
                  )}
                </div>
              </>
            )}

          </div>
        );
      })}
    </div>
  );
}
