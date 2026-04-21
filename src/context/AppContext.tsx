import React, { createContext, useContext, useState } from 'react';
import { AppContextType, QueueItem, PublishedPost, TextLayout, TemplateElement, AppSettings, Tag, TemplateSettings } from '../types';
import {
  INITIAL_QUEUE, INITIAL_PUBLISHED, INITIAL_TAGS,
  INITIAL_LAYOUTS, INITIAL_TEMELEMS, INITIAL_SETTINGS, INITIAL_TEMPLATE_SETTINGS,
} from '../data/mock';

const AppCtx = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<QueueItem[]>(INITIAL_QUEUE);
  const [published, setPublished] = useState<PublishedPost[]>(INITIAL_PUBLISHED);
  const [tags, setTags] = useState<Tag[]>(INITIAL_TAGS);
  const [layouts, setLayouts] = useState<TextLayout[]>(INITIAL_LAYOUTS);
  const [settings, setSettings] = useState<AppSettings>(INITIAL_SETTINGS);
  const [telElems, setTelElems] = useState<TemplateElement[]>(INITIAL_TEMELEMS);
  const [templateSettings, setTemplateSettings] = useState<TemplateSettings>(INITIAL_TEMPLATE_SETTINGS);

  const stats = {
    inCoda: queue.length,
    sched: queue.filter(x => x.status === 'scheduled').length,
    pub: published.length,
  };

  return (
    <AppCtx.Provider value={{
      queue, setQueue,
      published, setPublished,
      tags, setTags,
      layouts, setLayouts,
      settings, setSettings,
      telElems, setTelElems,
      templateSettings, setTemplateSettings,
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
