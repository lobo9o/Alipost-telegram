import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { NavPage, Product, QueueItem } from '../types';
import { PageHeader, SourceBadge, StatusBadge, SwitchTabs, PriceRow, EmptyState, InfoBanner, ErrorBanner, TelegramPreview } from '../components/Shared';
import { MOCK_PRODUCTS, genId, fetchProductMock } from '../data/mock';
import { detectAmazonLink, extractASIN, fetchAmazonProduct } from '../services/amazonService';

// ============================================================
// DASHBOARD
// ============================================================
export function Dashboard({ nav }: { nav: (p: NavPage) => void }) {
  const { stats, settings } = useApp();
  const items = [
    { id: 'search', ic: '🔍', lb: 'Cerca Offerte', sub: 'Amazon & AliExpress', c: 'var(--bl)' },
    { id: 'newpost', ic: '✏️', lb: 'Nuovo Post', sub: 'singolo / multiplo', c: 'var(--a1)' },
    { id: 'queue', ic: '🗓️', lb: 'Coda AutoPost', sub: `${stats.inCoda} in coda`, c: 'var(--or)' },
    { id: 'published', ic: '✅', lb: 'Pubblicati', sub: `${stats.pub} oggi`, c: 'var(--gr)' },
    { id: 'layout', ic: '🎨', lb: 'Layout', sub: 'tag · testo · immagine', c: 'var(--a2)' },
    { id: 'settings', ic: '⚙️', lb: 'Impostazioni', sub: 'API · canali · orari', c: 'var(--t2)' },
  ];
  return (
    <div className="pg">
      <div className="hero">
        <div className="hero-top">
          <div className="logo">A</div>
          <div>
            <div className="brand">Ali<span>Post</span> <span style={{ color: 'var(--t2)', fontSize: 14, fontWeight: 400 }}>v2</span></div>
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
  const { setQueue } = useApp();
  const [src, setSrc] = useState<'ali' | 'az' | 'all'>('ali');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [searched, setSearched] = useState(false);

  const search = () => {
    const filtered = MOCK_PRODUCTS.filter(p => src === 'all' || p.src === src);
    setResults(q ? filtered.filter(p => p.titolo.toLowerCase().includes(q.toLowerCase())) : filtered);
    setSearched(true);
  };

  const addToQueue = (p: Product, publishNow: boolean) => {
    setQueue(prev => [...prev, {
      id: genId(), tipo: 'single', src: p.src, products: [p],
      sched: publishNow ? 'Subito' : 'Auto',
      status: publishNow ? 'published' : 'scheduled',
      sel: false,
    }]);
    nav(publishNow ? 'published' : 'queue');
  };

  return (
    <div className="pg">
      <PageHeader title="Cerca Offerte" onBack={() => nav('dash')} />
      <div style={{ padding: '12px 16px 0' }}>
        <SwitchTabs
          options={[['ali', 'AliExpress'], ['az', 'Amazon'], ['all', 'Entrambi']]}
          value={src} onChange={v => setSrc(v as any)}
        />
        <div className="irow" style={{ marginTop: 10, marginBottom: 12 }}>
          <input className="inp" value={q} onChange={e => setQ(e.target.value)}
            placeholder="Cerca prodotti..." onKeyDown={e => e.key === 'Enter' && search()} />
          <button className="btn bp" onClick={search} style={{ padding: '0 16px', flexShrink: 0 }}>🔍</button>
        </div>
      </div>
      {!searched && <InfoBanner>Seleziona piattaforma e cerca, oppure premi 🔍 per vedere tutte le offerte mock.</InfoBanner>}
      {searched && !results.length && <EmptyState icon="🔎" text="Nessun prodotto trovato." />}
      {results.map(p => (
        <div key={p.id} className="pcard">
          <div className="pthumb">{p.emoji}</div>
          <div className="pinfo">
            <div className="ptit">{p.titolo}</div>
            <div className="prow">
              <span className="pnew" style={{ fontSize: 14 }}>€{p.prezzo_sc}</span>
              <span className="pold">€{p.prezzo_orig}</span>
              <span className="dbdg">-{p.sconto}%</span>
              <SourceBadge src={p.src} />
            </div>
            <div className="pacts">
              <button className="btn bgr bsm" onClick={() => addToQueue(p, true)}>⚡ Pubblica</button>
              <button className="btn bbl bsm" onClick={() => addToQueue(p, false)}>+ AutoPost</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// NEW POST
// ============================================================
interface LinkItem { id: string; url: string; src: 'az' | 'ali'; asin?: string; }

export function NewPostPage({ nav }: { nav: (p: NavPage) => void }) {
  const { setQueue } = useApp();
  const [mode, setMode] = useState<'single' | 'multi'>('single');
  const [linkInput, setLinkInput] = useState('');
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [err, setErr] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [analyzed, setAnalyzed] = useState(false);
  const [loading, setLoading] = useState(false);

  const sendLink = () => {
    if (!linkInput.trim()) return;
    if (mode === 'multi' && links.length >= 6) { setErr('Massimo 6 articoli per post multiplo.'); return; }
    const url = linkInput.trim();
    const isAmazon = detectAmazonLink(url);
    const asin = isAmazon ? (extractASIN(url) ?? undefined) : undefined;
    setLinks(prev => [...prev, { id: genId(), url, src: isAmazon ? 'az' : 'ali', asin }]);
    setLinkInput(''); setErr('');
  };

  const removeLink = (id: string) => setLinks(prev => prev.filter(l => l.id !== id));

  const creaPost = async () => {
    setLoading(true);
    const prods = await Promise.all(links.map(async (l, i) => {
      if (l.src === 'az' && l.asin) {
        const ap = await fetchAmazonProduct(l.asin);
        const discount = Math.round((1 - ap.price / ap.originalPrice) * 100);
        return { id: genId(), titolo: ap.title, prezzo_orig: ap.originalPrice.toFixed(2), prezzo_sc: ap.price.toFixed(2), sconto: discount, emoji: '📦', src: 'az' as const, custom: '', asin: l.asin };
      }
      return fetchProductMock(l.url, i);
    }));
    setProducts(prods as Product[]);
    setAnalyzed(true);
    setLoading(false);
  };

  const updateProd = (id: string, field: keyof Product, val: string) =>
    setProducts(ps => ps.map(p => p.id === id ? { ...p, [field]: val } : p));
  const delProd = (id: string) => setProducts(ps => ps.filter(p => p.id !== id));

  const addToQueue = () => {
    setQueue(prev => [...prev, {
      id: genId(), tipo: mode, src: products[0]?.src || 'ali', products,
      sched: 'Auto', status: 'draft', sel: false,
    }]);
    nav('queue');
  };

  return (
    <div className="pg">
      <PageHeader title="Nuovo Post" onBack={() => nav('dash')} />
      <div className="cbar">
        <div className="cb"><div className="cbnum" style={{ color: 'var(--a3)' }}>1</div><div className="cblb">Singoli</div></div>
        <div className="cb"><div className="cbnum" style={{ color: 'var(--am2)' }}>1</div><div className="cblb">Multipli</div></div>
        <div className="cb"><div className="cbnum" style={{ color: 'var(--gr2)' }}>{links.length}</div><div className="cblb">Link aggiunti</div></div>
      </div>

      {!analyzed ? (
        <>
          <SwitchTabs
            options={[['single', 'Singolo'], ['multi', 'Multiplo']]}
            value={mode} onChange={v => { setMode(v as any); setLinks([]); setErr(''); }}
          />
          {mode === 'multi' && <InfoBanner>📦 Modalità multipla — max 6 articoli. Incolla i link uno alla volta.</InfoBanner>}
          {err && <ErrorBanner>{err}</ErrorBanner>}

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
                  <SourceBadge src={l.src} />
                  {l.asin && (
                    <span style={{ fontSize: 10, background: '#1a1000', color: '#f59e0b', padding: '2px 6px', borderRadius: 4, fontWeight: 700, flexShrink: 0 }}>
                      ASIN: {l.asin}
                    </span>
                  )}
                  <span className="llink-url">{l.url}</span>
                  <button className="btn bgh bsm" onClick={() => removeLink(l.id)} style={{ color: 'var(--re)', padding: '4px 8px', flexShrink: 0 }}>×</button>
                </div>
              ))}
              <div style={{ padding: '8px 16px 16px' }}>
                <button className="btn bp bfull" onClick={creaPost} disabled={loading}>
                  {loading ? '⏳ Analisi in corso...' : `🚀 Crea Post (${links.length})`}
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <InfoBanner>✅ {products.length} prodotti — modifica se necessario</InfoBanner>
          {products.map((p, i) => (
            <div key={p.id} className="card">
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                <div className="cn">{i + 1}</div>
                <div style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{p.titolo}</div>
                <button className="btn bgh bsm" onClick={() => delProd(p.id)} style={{ color: 'var(--re)', padding: '3px 7px' }}>×</button>
              </div>
              <div className="prow">
                <span className="pnew">€{p.prezzo_sc}</span>
                <span className="pold">€{p.prezzo_orig}</span>
                <span className="dbdg">-{p.sconto}%</span>
                <SourceBadge src={p.src} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <input className="inp" value={p.titolo} onChange={e => updateProd(p.id, 'titolo', e.target.value)} placeholder="Titolo" />
                <div className="irow">
                  <input className="inp" value={p.prezzo_sc} onChange={e => updateProd(p.id, 'prezzo_sc', e.target.value)} placeholder="€ scontato" />
                  <input className="inp" value={p.prezzo_orig} onChange={e => updateProd(p.id, 'prezzo_orig', e.target.value)} placeholder="€ orig." />
                </div>
                <input className="inp" value={p.custom} onChange={e => updateProd(p.id, 'custom', e.target.value)} placeholder="Testo personalizzato..." />
              </div>
            </div>
          ))}

          {products.length > 0 && (
            <>
              <div className="stit">ANTEPRIMA TELEGRAM</div>
              <TelegramPreview
                lines={<>
                  <b>🔥 {mode === 'multi' ? 'OFFERTE DEL GIORNO' : 'OFFERTA'} 🔥{'\n\n'}</b>
                  {mode === 'single'
                    ? <>📌 <b>{products[0]?.titolo}</b>{`\n\n💰 €${products[0]?.prezzo_sc} ~~€${products[0]?.prezzo_orig}~~\n🏷️ -${products[0]?.sconto}% di sconto\n\n👇 Link nel pulsante`}</>
                    : products.map((p, i) => <span key={p.id}>{`${i + 1}. ${p.titolo} — €${p.prezzo_sc}\n`}</span>)
                  }
                </>}
                buttons={mode === 'single' ? ['🛒 Compra ora', '💰 Vedi offerta'] : products.map((p, i) => `🛒 ${i + 1}. ${p.titolo.slice(0, 24)}...`)}
              />
              <div style={{ padding: '0 16px 16px', display: 'flex', gap: 8 }}>
                <button className="btn bs" style={{ flex: 1 }} onClick={() => { setAnalyzed(false); setProducts([]); }}>← Indietro</button>
                <button className="btn bp" style={{ flex: 1 }} onClick={addToQueue}>📬 Aggiungi coda</button>
              </div>
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
  const { queue, setQueue } = useApp();
  const [multiSelect, setMultiSelect] = useState(false);
  const selCount = queue.filter(x => x.sel).length;

  const toggle = (id: string) => setQueue(q => q.map(x => x.id === id ? { ...x, sel: !x.sel } : x));
  const delSelected = () => setQueue(q => q.filter(x => !x.sel));
  const publish = (id: string) => setQueue(q => q.map(x => x.id === id ? { ...x, status: 'published' } : x));
  const del = (id: string) => setQueue(q => q.filter(x => x.id !== id));
  const move = (id: string, dir: 'up' | 'down') => setQueue(q => {
    const a = [...q]; const i = a.findIndex(x => x.id === id);
    if (dir === 'up' && i > 0) [a[i - 1], a[i]] = [a[i], a[i - 1]];
    if (dir === 'down' && i < a.length - 1) [a[i], a[i + 1]] = [a[i + 1], a[i]];
    return a;
  });

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
          <button className="btn bam bsm">🔗 Unisci in multiplo</button>
          <button className="btn bre bsm" onClick={delSelected}>🗑️ Elimina</button>
        </div>
      )}

      {!queue.length ? (
        <EmptyState icon="🗓️" text="Nessun post in coda." action={<button className="btn bp" onClick={() => nav('newpost')}>+ Nuovo post</button>} />
      ) : (
        <>
          <div style={{ height: 10 }} />
          {queue.map((item, idx) => (
            <div key={item.id} className="qi" style={{ position: 'relative' }}>
              {multiSelect && (
                <div className={`qsel ${item.sel ? 'on' : ''}`} onClick={() => toggle(item.id)}>
                  {item.sel && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>✓</span>}
                </div>
              )}
              <div className="qi-h">
                <span className={`qtype ${item.tipo}`}>{item.tipo === 'single' ? 'Singolo' : 'Multi'}</span>
                <SourceBadge src={item.src} />
                <span style={{ fontSize: 13, fontWeight: 600, flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', paddingLeft: 4 }}>
                  {(item.products[0] as any)?.emoji} {(item.products[0] as any)?.titolo?.slice(0, 22)}
                  {item.products.length > 1 && ` +${item.products.length - 1}`}
                </span>
                <StatusBadge status={item.status} />
              </div>
              <div className="qmeta">
                <span>🕐 {item.sched}</span>
                <span>💰 €{(item.products[0] as any)?.prezzo_sc}</span>
                <span>📦 {item.products.length} prod.</span>
              </div>
              <div className="qacts">
                <button className="btn bsm" style={{ background: '#071a38', color: '#60a5fa', border: '1px solid #0e3060' }} onClick={() => move(item.id, 'up')} disabled={idx === 0}>↑</button>
                <button className="btn bsm" style={{ background: '#071a38', color: '#60a5fa', border: '1px solid #0e3060' }} onClick={() => move(item.id, 'down')} disabled={idx === queue.length - 1}>↓</button>
                <button className="btn bgr bsm" onClick={() => publish(item.id)}>⚡ Pubblica</button>
                <button className="btn bbl bsm">✏️ Modifica</button>
                <button className="btn bre bsm" onClick={() => del(item.id)}>🗑️</button>
              </div>
            </div>
          ))}
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
    setQueue(prev => [...prev, {
      id: genId(), tipo: 'single', src: p.src,
      products: [{ titolo: p.titolo, prezzo_sc: p.prezzo, emoji: p.emoji }],
      sched: 'Auto', status: 'draft', sel: false,
    }]);
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
            <div className="pub-tit">{p.titolo}</div>
            <div className="pub-meta">
              <SourceBadge src={p.src} /> {p.ts} · €{p.prezzo}
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
