import React from 'react';
import { Platform, PostStatus } from '../types';

// ── Page Header ───────────────────────────────────────────
interface PageHeaderProps {
  title: string;
  onBack: () => void;
  badge?: string | number;
  badgeVariant?: 'purple' | 'green' | 'amber';
  right?: React.ReactNode;
}
export function PageHeader({ title, onBack, badge, badgeVariant = 'purple', right }: PageHeaderProps) {
  const bgMap = { purple: 'var(--a1)', green: 'var(--gr)', amber: 'var(--am)' };
  return (
    <header className="hdr">
      <button className="hbk" onClick={onBack}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width={16} height={16}>
          <path d="M19 12H5M12 5l-7 7 7 7" />
        </svg>
      </button>
      <h1 className="htit">{title}</h1>
      {badge !== undefined && (
        <span className="hbdg" style={{ background: bgMap[badgeVariant] }}>{badge}</span>
      )}
      {right}
    </header>
  );
}

// ── Source Badge ──────────────────────────────────────────
export function SourceBadge({ platform }: { platform: Platform }) {
  const styles: Record<Platform, React.CSSProperties> = {
    amazon: { background: '#1a1000', color: '#f59e0b', border: '1px solid #3a2000', padding: '2px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700 },
    aliexpress: { background: '#1a0808', color: '#ff6b6b', border: '1px solid #3a1010', padding: '2px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700 },
  };
  return <span style={styles[platform]}>{platform === 'amazon' ? 'Amazon' : 'AliExpress'}</span>;
}

// ── Status Badge ──────────────────────────────────────────
const STATUS_STYLES: Record<PostStatus, { bg: string; color: string }> = {
  draft: { bg: '#1e1e30', color: 'var(--t2)' },
  scheduled: { bg: '#071a38', color: '#60a5fa' },
  published: { bg: '#0d2e1e', color: 'var(--gr2)' },
  error: { bg: '#2a0808', color: 'var(--re)' },
};
const STATUS_LABELS: Record<PostStatus, string> = {
  draft: 'Bozza', scheduled: 'Programmato', published: 'Pubblicato', error: 'Errore',
};
export function StatusBadge({ status }: { status: PostStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span style={{ ...s, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>
      {STATUS_LABELS[status]}
    </span>
  );
}

// ── Switch Tabs ───────────────────────────────────────────
interface SwitchTabsProps {
  options: [string, string][];
  value: string;
  onChange: (v: string) => void;
}
export function SwitchTabs({ options, value, onChange }: SwitchTabsProps) {
  return (
    <div className="sw-wrap">
      {options.map(([v, l]) => (
        <div key={v} className={`sw-opt ${value === v ? 'on' : ''}`} onClick={() => onChange(v)}>{l}</div>
      ))}
    </div>
  );
}

// ── Toggle Row ────────────────────────────────────────────
interface ToggleRowProps {
  label: string;
  sub?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}
export function ToggleRow({ label, sub, value, onChange }: ToggleRowProps) {
  return (
    <div className="trow">
      <div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--t2)' }}>{sub}</div>}
      </div>
      <div className={`tgl ${value ? 'on' : ''}`} onClick={() => onChange(!value)}>
        <div className="tgl-k" />
      </div>
    </div>
  );
}

// ── Discount Badge ────────────────────────────────────────
export function DiscountBadge({ pct }: { pct: number }) {
  return <span className="dbdg">-{pct}%</span>;
}

// ── Empty State ───────────────────────────────────────────
export function EmptyState({ icon, text, action }: { icon: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="eic">{icon}</div>
      <div className="etx">{text}</div>
      {action}
    </div>
  );
}

// ── Info/Error Banners ────────────────────────────────────
export function InfoBanner({ children }: { children: React.ReactNode }) {
  return <div className="infob">{children}</div>;
}
export function ErrorBanner({ children }: { children: React.ReactNode }) {
  return <div className="errb">⚠️ {children}</div>;
}

// ── Telegram Preview ──────────────────────────────────────
interface TelegramPreviewProps {
  text?: string;
  lines?: React.ReactNode;
  buttons?: string[];
}
export function TelegramPreview({ text, lines, buttons = ['🛒 Compra ora'] }: TelegramPreviewProps) {
  return (
    <div className="pvbox">
      <span className="pvbdg">PREVIEW TELEGRAM</span>
      {text !== undefined
        ? <div className="pvmsg" style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
        : <div className="pvmsg">{lines}</div>
      }
      {buttons.map((b, i) => (
        <div key={i} className="tgbtn">{b}</div>
      ))}
    </div>
  );
}
