import React, { createContext, useContext, useState, useEffect } from 'react';
import { AppContextType, QueueItem, PublishedPost, TextLayout, Template, AppSettings, Tag, CreatedPost } from '../types';
import {
  INITIAL_QUEUE, INITIAL_PUBLISHED, INITIAL_TAGS,
  INITIAL_LAYOUTS, INITIAL_TEMPLATES, INITIAL_SETTINGS,
} from '../data/mock';
import { tagsApi, layoutsApi, templatesApi, postsApi, settingsApi, autopostApi } from '../lib/api';

const AppCtx = createContext<AppContextType | null>(null);

// In development (react-scripts start) there is no /api server, so we fall
// back silently to mock data and keep the app fully functional offline.
const IS_DEV = process.env.NODE_ENV === 'development';

async function tryFetch<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (IS_DEV) return fallback;
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [createdPosts, setCreatedPosts] = useState<CreatedPost[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>(INITIAL_QUEUE);
  const [published, setPublished] = useState<PublishedPost[]>(INITIAL_PUBLISHED);
  const [tags, setTags] = useState<Tag[]>(INITIAL_TAGS);
  const [layouts, setLayouts] = useState<TextLayout[]>(INITIAL_LAYOUTS);
  const [templates, setTemplates] = useState<Template[]>(INITIAL_TEMPLATES);
  const [settings, setSettings] = useState<AppSettings>(INITIAL_SETTINGS);

  // Load persisted data from API on first mount (production only)
  useEffect(() => {
    if (IS_DEV) return;
    Promise.all([
      tryFetch(postsApi.list, []),
      tryFetch(autopostApi.list, INITIAL_QUEUE),
      tryFetch(tagsApi.list, INITIAL_TAGS),
      tryFetch(layoutsApi.list, INITIAL_LAYOUTS),
      tryFetch(templatesApi.list, INITIAL_TEMPLATES),
      tryFetch(settingsApi.get, INITIAL_SETTINGS),
    ]).then(([posts, q, t, l, tmpl, s]) => {
      if (posts.length > 0) setCreatedPosts(posts);
      if (q.length > 0) setQueue(q);
      if (t.length > 0) setTags(t);
      if (l.length > 0) setLayouts(l);
      if (tmpl.length > 0) setTemplates(tmpl);
      setSettings(s);
    });
  }, []);

  const stats = {
    inCoda: queue.length,
    sched: queue.filter(x => x.status === 'scheduled').length,
    pub: published.length,
  };

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
