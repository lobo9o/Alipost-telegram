import React, { createContext, useContext, useState } from 'react';
import { AppContextType, QueueItem, PublishedPost, TextLayout, Template, AppSettings, Tag, CreatedPost } from '../types';
import {
  INITIAL_QUEUE, INITIAL_PUBLISHED, INITIAL_TAGS,
  INITIAL_LAYOUTS, INITIAL_TEMPLATES, INITIAL_SETTINGS,
} from '../data/mock';

const AppCtx = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [createdPosts, setCreatedPosts] = useState<CreatedPost[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>(INITIAL_QUEUE);
  const [published, setPublished] = useState<PublishedPost[]>(INITIAL_PUBLISHED);
  const [tags, setTags] = useState<Tag[]>(INITIAL_TAGS);
  const [layouts, setLayouts] = useState<TextLayout[]>(INITIAL_LAYOUTS);
  const [templates, setTemplates] = useState<Template[]>(INITIAL_TEMPLATES);
  const [settings, setSettings] = useState<AppSettings>(INITIAL_SETTINGS);

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
