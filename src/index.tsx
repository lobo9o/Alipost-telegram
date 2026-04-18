import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        MainButton: { text: string; show: () => void; hide: () => void; onClick: (fn: () => void) => void; };
        BackButton: { show: () => void; hide: () => void; onClick: (fn: () => void) => void; };
        initDataUnsafe?: { user?: { id: number; username?: string; first_name?: string }; };
      };
    };
  }
}

if (window.Telegram?.WebApp) {
  window.Telegram.WebApp.ready();
  window.Telegram.WebApp.expand();
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode><App /></React.StrictMode>
);
