import React, { createContext, useContext, useState, useEffect } from 'react';
import { AppContextType, QueueItem, PublishedPost, TextLayout, Template, AppSettings, Tag, CreatedPost } from '../types';
import {
  INITIAL_TAGS, INITIAL_LAYOUTS, INITIAL_TEMPLATES, INITIAL_SETTINGS,
} from '../data/mock';
import { tagsApi, layoutsApi, templatesApi, settingsApi, autopostApi } from '../lib/api';

const AppCtx = createContext<AppContextType | null>(null);

const IS_DEV = process.env.NODE_ENV === 'development';

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
  return {
    oraI: typeof r.oraI === 'string' ? r.oraI : INITIAL_SETTINGS.oraI,
    oraF: typeof r.oraF === 'string' ? r.oraF : INITIAL_SETTINGS.oraF,
    interv: typeof r.interv === 'number' ? r.interv : INITIAL_SETTINGS.interv,
    attivo: typeof r.attivo === 'boolean' ? r.attivo : INITIAL_SETTINGS.attivo,
    channels: Array.isArray(r.channels) ? r.channels as string[] : INITIAL_SETTINGS.channels,
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
      affiliateId: typeof al.affiliateId === 'string' ? al.affiliateId : '',
      trackingId: typeof al.trackingId === 'string' ? al.trackingId : '',
    },
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [createdPosts, setCreatedPosts] = useState<CreatedPost[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [published, setPublished] = useState<PublishedPost[]>([]);
  const [tags, setTags] = useState<Tag[]>(INITIAL_TAGS);
  const [layouts, setLayouts] = useState<TextLayout[]>(INITIAL_LAYOUTS);
  const [templates, setTemplates] = useState<Template[]>(INITIAL_TEMPLATES);
  const [settings, setSettings] = useState<AppSettings>(INITIAL_SETTINGS);
  const [loaded, setLoaded] = useState(IS_DEV);

  useEffect(() => {
    if (IS_DEV) return;
    Promise.all([
      tryFetch(autopostApi.list, []),
      tryFetch(tagsApi.list, INITIAL_TAGS),
      tryFetch(layoutsApi.list, INITIAL_LAYOUTS),
      tryFetch(templatesApi.list, INITIAL_TEMPLATES),
      tryFetch(settingsApi.get, {} as AppSettings),
    ]).then(([q, t, l, tmpl, s]) => {
      // Only restore draft items — error/scheduled/published are stale and shouldn't reappear
      setQueue((q as QueueItem[]).filter(x => x.status === 'draft'));
      if (t.length > 0) setTags(t);
      if (l.length > 0) setLayouts(l);
      if (tmpl.length > 0) setTemplates(tmpl);
      setSettings(mergeSettings(s));
      setLoaded(true);
    });
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
        justifyContent: 'center', height: '100vh', gap: 16,
        background: 'var(--bg)', color: 'var(--t1)',
      }}>
        <div style={{ fontSize: 40 }}>⚙️</div>
        <div style={{ fontSize: 15, fontWeight: 700 }}>PostDealBot</div>
        <div style={{ fontSize: 13, color: 'var(--t2)' }}>Caricamento...</div>
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
      templates, setTemplates,
      settings, setSettings,
      stats,
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
