import React, { useState } from 'react';
import { AppProvider } from './context/AppContext';
import { NavPage } from './types';
import { Dashboard, SearchPage, NewPostPage, QueuePage, PublishedPage } from './pages/MainPages';
import { LayoutPage, SettingsPage, MonitorPage } from './pages/LayoutSettings';

// ── Bottom Nav Icons ──────────────────────────────────────────
const NavIcons: Record<string, React.ReactElement> = {
  dash: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={20} height={20}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M9 22V12h6v10"/></svg>,
  search: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={20} height={20}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
  newpost: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={20} height={20}><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>,
  queue: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={20} height={20}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>,
  layout: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={20} height={20}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>,
  settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={20} height={20}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  monitor: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={20} height={20}><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 10a19.79 19.79 0 01-3.07-8.67A2 2 0 012 1.16h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>,
};

const NAV_ITEMS: { id: NavPage; label: string }[] = [
  { id: 'dash', label: 'Home' },
  { id: 'search', label: 'Cerca' },
  { id: 'newpost', label: 'Post' },
  { id: 'queue', label: 'Coda' },
  { id: 'layout', label: 'Layout' },
  { id: 'settings', label: 'Config' },
];

function BottomNav({ current, nav }: { current: NavPage; nav: (p: NavPage) => void }) {
  return (
    <div className="bnav">
      {NAV_ITEMS.map(item => (
        <button key={item.id} className={`nv ${current === item.id ? 'on' : ''}`} onClick={() => nav(item.id)}>
          {NavIcons[item.id]}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────
function AppInner() {
  const [page, setPage] = useState<NavPage>('dash');
  const nav = (p: NavPage) => setPage(p);

  const pageMap: Record<NavPage, React.ReactElement> = {
    dash: <Dashboard nav={nav} />,
    search: <SearchPage nav={nav} />,
    newpost: <NewPostPage nav={nav} />,
    queue: <QueuePage nav={nav} />,
    published: <PublishedPage nav={nav} />,
    monitor: <MonitorPage nav={nav} />,
    layout: <LayoutPage nav={nav} />,
    settings: <SettingsPage nav={nav} />,
  };

  return (
    <div className="app">
      {pageMap[page]}
      <BottomNav current={page} nav={nav} />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  );
}
