import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { AppContextType, QueueItem, PublishedPost, TextLayout, KeyboardLayout, Template, AppSettings, Tag, CreatedPost, makeDefaultTemplate, LinkItem, NewPostItem } from '../types';
import {
  INITIAL_TAGS, INITIAL_LAYOUTS, INITIAL_KEYBOARDS, INITIAL_TEMPLATES, INITIAL_SETTINGS,
} from '../data/mock';
import { tagsApi, layoutsApi, keyboardsApi, templatesApi, settingsApi, autopostApi, publishedApi, setApiProfileId } from '../lib/api';

const AppCtx = createContext<AppContextType | null>(null);

const IS_DEV = process.env.NODE_ENV === 'development';

function getBaseUserId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const initDataUnsafe = (window as any).Telegram?.WebApp?.initDataUnsafe;
    return String(initDataUnsafe?.user?.id ?? '');
  } catch { return ''; }
}

async function tryFetch<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (IS_DEV) return fallback;
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function mergeSettings(fetched: unknown): AppSettings {
  const r = (fetched ?? {}) as Record<string, any>;
  const am = (r.amazon ?? {}) as Record<string, any>;
  const al = (r.aliexpress ?? {}) as Record<string, any>;
  const tm = (r.terminata ?? {}) as Record<string, any>;
  return {
    oraI: typeof r.oraI === 'string' ? r.oraI : INITIAL_SETTINGS.oraI,
    oraF: typeof r.oraF === 'string' ? r.oraF : INITIAL_SETTINGS.oraF,
    interv: typeof r.interv === 'number' ? r.interv : INITIAL_SETTINGS.interv,
    attivo: typeof r.attivo === 'boolean' ? r.attivo : INITIAL_SETTINGS.attivo,
    channels: Array.isArray(r.channels) ? r.channels as string[] : INITIAL_SETTINGS.channels,
    notifThreshold: typeof r.notifThreshold === 'number' ? r.notifThreshold : undefined,
    amazon: {
      enabled: typeof am.enabled === 'boolean' ? am.enabled : INITIAL_SETTINGS.amazon.enabled,
      affiliateTag: typeof am.affiliateTag === 'string' ? am.affiliateTag : '',
      credentialId: typeof am.credentialId === 'string' ? am.credentialId : '',
      credentialSecret: typeof am.credentialSecret === 'string' ? am.credentialSecret : '',
      version: typeof am.version === 'string' ? am.version : '2.2',
      marketplace: typeof am.marketplace === 'string' ? am.marketplace : 'IT',
    },
    aliexpress: {
      enabled: typeof al.enabled === 'boolean' ? al.enabled : INITIAL_SETTINGS.aliexpress.enabled,
      appKey: typeof al.appKey === 'string' ? al.appKey : '',
      appSecret: typeof al.appSecret === 'string' ? al.appSecret : '',
      trackingId: typeof al.trackingId === 'string' ? al.trackingId : '',
      targetCountry: typeof al.targetCountry === 'string' ? al.targetCountry : 'IT',
    },
    terminata: {
      grayscale: typeof tm.grayscale === 'boolean' ? tm.grayscale : true,
      overlayText: typeof tm.overlayText === 'string' ? tm.overlayText : '❌ OFFERTA TERMINATA',
      overlayTextColor: typeof tm.overlayTextColor === 'string' ? tm.overlayTextColor : '#ff0000',
      overlayTextSize: typeof tm.overlayTextSize === 'number' ? tm.overlayTextSize : 7,
      overlayTextX: typeof tm.overlayTextX === 'number' ? tm.overlayTextX : 50,
      overlayTextY: typeof tm.overlayTextY === 'number' ? tm.overlayTextY : 50,
      overlayTextFont: typeof tm.overlayTextFont === 'string' ? tm.overlayTextFont : 'Impact',
      showPrezzo: typeof tm.showPrezzo === 'boolean' ? tm.showPrezzo : true,
      showPrezzoPrecedente: typeof tm.showPrezzoPrecedente === 'boolean' ? tm.showPrezzoPrecedente : false,
      showSconto: typeof tm.showSconto === 'boolean' ? tm.showSconto : false,
      layoutId: typeof tm.layoutId === 'string' ? tm.layoutId : '',
      telegramMode: ['keep','append','only'].includes(tm.telegramMode) ? tm.telegramMode : 'keep',
      telegramText: typeof tm.telegramText === 'string' ? tm.telegramText : '❌ Offerta terminata',
    },
    dealSearch: {
      autoPublishAliexpress: typeof r.dealSearch?.autoPublishAliexpress === 'boolean' ? r.dealSearch.autoPublishAliexpress : false,
      autoPublishAmazon: typeof r.dealSearch?.autoPublishAmazon === 'boolean' ? r.dealSearch.autoPublishAmazon : false,
      publishPattern: typeof r.dealSearch?.publishPattern === 'string' ? r.dealSearch.publishPattern : '1:1',
      ali: {
        keywords: typeof r.dealSearch?.ali?.keywords === 'string' ? r.dealSearch.ali.keywords : '',
        minDiscount: typeof r.dealSearch?.ali?.minDiscount === 'number' ? r.dealSearch.ali.minDiscount : 0,
        minPrice: typeof r.dealSearch?.ali?.minPrice === 'number' ? r.dealSearch.ali.minPrice : 0,
        maxPrice: typeof r.dealSearch?.ali?.maxPrice === 'number' ? r.dealSearch.ali.maxPrice : 0,
        sort: typeof r.dealSearch?.ali?.sort === 'string' ? r.dealSearch.ali.sort : 'DEFAULT_SORT',
        deliveryDays: typeof r.dealSearch?.ali?.deliveryDays === 'number' ? r.dealSearch.ali.deliveryDays : 0,
        categoryIds: typeof r.dealSearch?.ali?.categoryIds === 'string' ? r.dealSearch.ali.categoryIds : '',
      },
      autoPublishSort:      (r.dealSearch?.autoPublishSort === 'score' ? 'score' : 'discount') as 'discount' | 'score',
      scoreWeightDiscount:  typeof r.dealSearch?.scoreWeightDiscount === 'number' ? r.dealSearch.scoreWeightDiscount : 50,
      scoreWeightRating:    typeof r.dealSearch?.scoreWeightRating === 'number' ? r.dealSearch.scoreWeightRating : 30,
      scoreWeightReviews:   typeof r.dealSearch?.scoreWeightReviews === 'number' ? r.dealSearch.scoreWeightReviews : 20,
      noDupeCategory:       typeof r.dealSearch?.noDupeCategory === 'boolean' ? r.dealSearch.noDupeCategory : false,
      amazon: r.dealSearch?.amazon ? {
        keywords:       typeof r.dealSearch.amazon.keywords === 'string' ? r.dealSearch.amazon.keywords : '',
        minDiscount:    typeof r.dealSearch.amazon.minDiscount === 'number' ? r.dealSearch.amazon.minDiscount : 0,
        maxDiscount:    typeof r.dealSearch.amazon.maxDiscount === 'number' ? r.dealSearch.amazon.maxDiscount : 0,
        minPrice:       typeof r.dealSearch.amazon.minPrice === 'number' ? r.dealSearch.amazon.minPrice : 0,
        maxPrice:       typeof r.dealSearch.amazon.maxPrice === 'number' ? r.dealSearch.amazon.maxPrice : 0,
        sort:           typeof r.dealSearch.amazon.sort === 'string' ? r.dealSearch.amazon.sort : 'Featured',
        searchIndexes:  typeof r.dealSearch.amazon.searchIndexes === 'string' ? r.dealSearch.amazon.searchIndexes : '',
        brandKeywords:  typeof r.dealSearch.amazon.brandKeywords === 'string' ? r.dealSearch.amazon.brandKeywords : undefined,
        minRating:      typeof r.dealSearch.amazon.minRating === 'number' ? r.dealSearch.amazon.minRating : 0,
        minReviews:     typeof r.dealSearch.amazon.minReviews === 'number' ? r.dealSearch.amazon.minReviews : 0,
        merchantFilter: typeof r.dealSearch.amazon.merchantFilter === 'string' ? r.dealSearch.amazon.merchantFilter : 'all',
      } : undefined,
    },
  };
}

async function loadProfileData(profileId: string) {
  // Ogni profilo (primario e secondario) ha i propri dati separati.
  // Le credenziali Amazon/AliExpress condivise vengono iniettate server-side.
  const tmplPromise = templatesApi.list().catch(() => null as Template[] | null);
  const tPromise    = tryFetch(tagsApi.list, INITIAL_TAGS);
  const lPromise    = tryFetch(layoutsApi.list, INITIAL_LAYOUTS);
  const kbPromise   = tryFetch(keyboardsApi.list, INITIAL_KEYBOARDS);
  const qPromise    = tryFetch(autopostApi.list, []);
  const sPromise    = tryFetch(settingsApi.get, {} as AppSettings);
  const pubPromise  = tryFetch(publishedApi.listToday, []);

  const [q, t, l, kb, s, pub, tmplResult] = await Promise.all([
    qPromise, tPromise, lPromise, kbPromise, sPromise, pubPromise, tmplPromise,
  ]);
  return { q, t, l, kb, s, pub, tmplResult };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [createdPosts, setCreatedPosts] = useState<CreatedPost[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [published, setPublished] = useState<PublishedPost[]>([]);
  const [newPostMode, setNewPostMode] = useState<'single' | 'multi'>('single');
  const [newPostItems, setNewPostItems] = useState<NewPostItem[]>([]);
  const [newPostEditingMultiId, setNewPostEditingMultiId] = useState<string | null>(null);
  const [tags, setTags] = useState<Tag[]>(INITIAL_TAGS);
  const [layouts, setLayouts] = useState<TextLayout[]>(INITIAL_LAYOUTS);
  const [keyboards, setKeyboards] = useState<KeyboardLayout[]>(INITIAL_KEYBOARDS);
  const [templates, setTemplates] = useState<Template[]>(INITIAL_TEMPLATES);
  const [settings, setSettings] = useState<AppSettings>(INITIAL_SETTINGS);
  const [publishedCount, setPublishedCount] = useState(0);
  const [loaded, setLoaded] = useState(IS_DEV);
  const templateFromDB = useRef(IS_DEV);

  // ── Profilo attivo ──────────────────────────────────────────────────────────
  // allChannels: lista canali del profilo primario (per il switcher)
  const [allChannels, setAllChannels] = useState<string[]>([]);
  const [activeProfileId, setActiveProfileIdState] = useState<string>(() => {
    try { return localStorage.getItem('activeProfileId') ?? ''; } catch { return ''; }
  });

  const setActiveProfileId = useCallback((id: string) => {
    try { localStorage.setItem('activeProfileId', id); } catch {}
    setApiProfileId(id || null);
    setActiveProfileIdState(id);
  }, []);

  // Inizializza header API al mount
  useEffect(() => {
    if (activeProfileId) setApiProfileId(activeProfileId);
  }, []); // solo al mount

  // ── Carica dati profilo ─────────────────────────────────────────────────────
  const applyData = useCallback((
    q: any, t: any, l: any, kb: any, s: any, pub: any, tmplResult: any, isPrimary: boolean
  ) => {
    setQueue((q as QueueItem[]).filter((x: QueueItem) => x.status === 'draft'));

    {
      // Merge: i tag di sistema da INITIAL_TAGS sono sempre presenti per ogni profilo
      const dbById = new Map((t as Tag[]).map((x: Tag) => [x.id, x]));
      const dbByName = new Map((t as Tag[]).map((x: Tag) => [x.name, x]));
      const systemMerged = INITIAL_TAGS.map(d => dbById.get(d.id) ?? dbByName.get(d.name) ?? d);
      const extra = (t as Tag[]).filter((x: Tag) => !INITIAL_TAGS.some(d => d.id === x.id || d.name === x.name));
      setTags([...systemMerged, ...extra]);
    }

    // Merge layouts
    {
      const key = (x: TextLayout) => `${x.nome}__${x.tipo}`;
      const dbByKey = new Map((l as TextLayout[]).map((x: TextLayout) => [key(x), x]));
      const seen = new Map<string, string>();
      for (const x of (l as TextLayout[])) {
        const k = key(x);
        if (!seen.has(k)) { seen.set(k, x.id); }
        else { layoutsApi.delete(x.id).catch(() => {}); }
      }
      const merged = INITIAL_LAYOUTS.map(d => dbByKey.get(key(d)) ?? d);
      const extra = (l as TextLayout[]).filter((x: TextLayout) => !INITIAL_LAYOUTS.some(d => key(d) === key(x)) && seen.get(key(x)) === x.id);
      setLayouts([...merged, ...extra]);
      INITIAL_LAYOUTS.forEach(d => { if (!dbByKey.has(key(d))) layoutsApi.create(d).catch(() => {}); });
    }

    {
      // Merge keyboards — ogni profilo ha le proprie
      const dbByNome = new Map((kb as KeyboardLayout[]).map((x: KeyboardLayout) => [x.nome, x]));
      const seenKb = new Map<string, string>();
      for (const x of (kb as KeyboardLayout[])) {
        if (!seenKb.has(x.nome)) { seenKb.set(x.nome, x.id); }
        else { keyboardsApi.delete(x.id).catch(() => {}); }
      }
      const merged = INITIAL_KEYBOARDS.map(d => dbByNome.get(d.nome) ?? d);
      const extra = (kb as KeyboardLayout[]).filter((x: KeyboardLayout) => !INITIAL_KEYBOARDS.some(d => d.nome === x.nome) && seenKb.get(x.nome) === x.id);
      setKeyboards([...merged, ...extra]);
      INITIAL_KEYBOARDS.forEach(d => { if (!dbByNome.has(d.nome)) keyboardsApi.create(d).catch(() => {}); });
    }

    // Template
    const tmpl = tmplResult as Template[] | null;
    if (tmpl !== null) {
      if (tmpl.length > 0) {
        const loaded = tmpl.map(t => {
          const base = { ...makeDefaultTemplate(t.id), ...t };
          if ((t as any).store && !t.storeAmazon) base.storeAmazon = (t as any).store;
          if ((t as any).store && !t.storeAliexpress) base.storeAliexpress = (t as any).store;
          return base;
        });
        setTemplates(loaded);
        templateFromDB.current = true;
      } else {
        // Nessun template: crea il default per questo profilo
        const def = makeDefaultTemplate('tpl1');
        setTemplates([def]);
        templatesApi.create(def).then(created => {
          setTemplates([{ ...makeDefaultTemplate(created.id), ...created }]);
          templateFromDB.current = true;
        }).catch(() => {});
      }
    }

    const rawS = s as AppSettings & { _publishedCount?: number };
    setPublishedCount(rawS._publishedCount ?? 0);
    const mergedS = mergeSettings(rawS);
    setSettings(mergedS);

    if (isPrimary) {
      setAllChannels(mergedS.channels.filter(Boolean));
    }

    setPublished(pub as PublishedPost[]);
  }, []);

  // Caricamento iniziale
  useEffect(() => {
    if (IS_DEV) return;
    templateFromDB.current = false;
    loadProfileData(activeProfileId).then(({ q, t, l, kb, s, pub, tmplResult }) => {
      const isPrimary = !activeProfileId.includes(':');
      applyData(q, t, l, kb, s, pub, tmplResult, isPrimary);
      if (!isPrimary) {
        const pc = (s as any)?._primaryChannels as string[] | undefined;
        // Aggiorna la lista canali se disponibile, ma NON fare fallback al primario:
        // il check pc.includes(channelId) può fallire per dati stale e causerebbe
        // il reset silenzioso del profilo secondario al primario
        if (Array.isArray(pc) && pc.length > 0) {
          setAllChannels(pc.filter(Boolean));
        }
      }
      setLoaded(true);
    });
  }, []); // solo al mount

  // Ricarica dati quando cambia profilo attivo (dopo il mount iniziale)
  const isFirstMount = useRef(true);
  useEffect(() => {
    if (IS_DEV) return;
    if (isFirstMount.current) { isFirstMount.current = false; return; }
    setLoaded(false);
    templateFromDB.current = false;
    setApiProfileId(activeProfileId || null);
    loadProfileData(activeProfileId).then(({ q, t, l, kb, s, pub, tmplResult }) => {
      const isPrimary = !activeProfileId.includes(':');
      applyData(q, t, l, kb, s, pub, tmplResult, isPrimary);
      if (!isPrimary) {
        const pc = (s as any)?._primaryChannels as string[] | undefined;
        if (Array.isArray(pc) && pc.length > 0) {
          setAllChannels(pc.filter(Boolean));
        }
      }
      setLoaded(true);
    });
  }, [activeProfileId, applyData]);

  // Polling coda ogni 60s
  useEffect(() => {
    if (IS_DEV) return;
    const id = setInterval(() => {
      autopostApi.list()
        .then(q => setQueue((q as QueueItem[]).filter(x => x.status === 'draft')))
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const stats = {
    inCoda: queue.length,
    sched: queue.filter(x => x.status === 'scheduled').length,
    pub: published.length,
  };

  if (!loaded) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100vh', gap: 20,
        background: 'var(--bg)', color: 'var(--t1)',
      }}>
        <div style={{
          fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 32,
          letterSpacing: '-0.5px', lineHeight: 1,
        }}>
          <span style={{ color: 'var(--a3)' }}>Post</span>
          <span style={{ color: 'var(--t1)' }}>Deal</span>
          <span style={{ color: 'var(--a1)' }}>Bot</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--t3)', letterSpacing: '2px', textTransform: 'uppercase' }}>Caricamento...</div>
      </div>
    );
  }

  return (
    <AppCtx.Provider value={{
      createdPosts, setCreatedPosts,
      queue, setQueue,
      published, setPublished,
      tags, setTags,
      layouts, setLayouts,
      keyboards, setKeyboards,
      templates, setTemplates,
      settings, setSettings,
      stats,
      publishedCount,
      templateFromDB,
      activeProfileId,
      setActiveProfileId,
      allChannels,
      newPostMode, setNewPostMode,
      newPostItems, setNewPostItems,
      newPostEditingMultiId, setNewPostEditingMultiId,
    }}>
      {children}
    </AppCtx.Provider>
  );
}

export function useApp(): AppContextType {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
