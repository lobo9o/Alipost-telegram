import express from 'express';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import cron from 'node-cron';
import { initTgMonitor, getActiveClient } from './api/tg-monitor/worker.js';
import { runDailyRecapCheck } from './api/autopost/daily-recap.js';
import { runPriceWatchCheck } from './api/autopost/price-watch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
(globalThis as any).__getTgClient = getActiveClient;

async function loadHandler(relPath: string) {
  const abs = path.join(__dirname, relPath);
  const mod = await import(pathToFileURL(abs).href);
  return mod.default as (req: any, res: any) => Promise<void>;
}

function withId(handler: (req: any, res: any) => any) {
  return (req: any, res: any) => {
    req.query.id = req.params.id;
    return handler(req, res);
  };
}

const cronHeaders = () => {
  const s = process.env.CRON_SECRET;
  return s ? { authorization: `Bearer ${s}` } : {};
};

async function main() {
  const [
    settingsHandler,
    tagsHandler,
    keyboardsHandler,
    layoutsHandler,
    layoutsIdHandler,
    postsHandler,
    postsIdHandler,
    autopostHandler,
    autopostIdHandler,
    autopostPublishHandler,
    productHandler,
    templatesHandler,
    templatesIdHandler,
    dealsHandler,
    amazonDealsHandler,
    dealsCacheHandler,
    emojiIdsHandler,
    tgMonitorAuthHandler,
    tgMonitorChannelsHandler,
    channelInfoHandler,
    multiPreviewHandler,
    dailyRecapHandler,
    priceWatchHandler,
    adminDashboardHandler,
  ] = await Promise.all([
    loadHandler('api/settings/index.ts'),
    loadHandler('api/tags.ts'),
    loadHandler('api/keyboards.ts'),
    loadHandler('api/layouts/index.ts'),
    loadHandler('api/layouts/[id].ts'),
    loadHandler('api/posts/index.ts'),
    loadHandler('api/posts/[id].ts'),
    loadHandler('api/autopost/index.ts'),
    loadHandler('api/autopost/[id].ts'),
    loadHandler('api/autopost/publish.ts'),
    loadHandler('api/product.ts'),
    loadHandler('api/templates/index.ts'),
    loadHandler('api/templates/[id].ts'),
    loadHandler('api/deals/index.ts'),
    loadHandler('api/amazon-deals/index.ts'),
    loadHandler('api/deals-cache/index.ts'),
    loadHandler('api/emoji-ids/index.ts'),
    loadHandler('api/tg-monitor/auth.ts'),
    loadHandler('api/tg-monitor/channels.ts'),
    loadHandler('api/channel-info.ts'),
    loadHandler('api/multi-preview.ts'),
    loadHandler('api/autopost/daily-recap.ts'),
    loadHandler('api/autopost/price-watch.ts'),
    loadHandler('api/admin/dashboard.ts'),
  ]);

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // CORS globale — header su tutte le risposte + preflight OPTIONS
  app.use((_req: any, res: any, next: any) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-tg-init-data, Authorization, x-internal-user-id, x-profile-id');
    next();
  });
  app.options('*', (_req: any, res: any) => { res.status(204).end(); });

  // index.html: no-cache (forza ricaricamento dopo deploy)
  // static assets (js/css con hash): cache lunga
  app.use(express.static(path.join(__dirname, 'build'), {
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
      }
    },
  }));

  app.all('/api/settings', settingsHandler);
  app.all('/api/tags', tagsHandler);
  app.all('/api/tags/:id', withId(tagsHandler));
  app.all('/api/keyboards', keyboardsHandler);
  app.all('/api/keyboards/:id', withId(keyboardsHandler));
  app.all('/api/layouts', layoutsHandler);
  app.all('/api/layouts/:id', withId(layoutsIdHandler));
  app.all('/api/autopost/publish', autopostPublishHandler);
  app.all('/api/autopost', autopostHandler);
  app.all('/api/autopost/:id', withId(autopostIdHandler));
  app.all('/api/posts', postsHandler);
  app.all('/api/posts/:id', withId(postsIdHandler));
  app.all('/api/product', productHandler);
  app.all('/api/templates', templatesHandler);
  app.all('/api/templates/:id', withId(templatesIdHandler));
  app.all('/api/deals', dealsHandler);
  app.all('/api/amazon-deals', amazonDealsHandler);
  app.all('/api/deals-cache', dealsCacheHandler);
  app.all('/api/emoji-ids', emojiIdsHandler);
  app.all('/api/tg-monitor/auth', tgMonitorAuthHandler);
  app.all('/api/tg-monitor/channels', tgMonitorChannelsHandler);
  app.all('/api/tg-monitor/channels/:id', withId(tgMonitorChannelsHandler));
  app.all('/api/channel-info', channelInfoHandler);
  app.all('/api/multi-preview', multiPreviewHandler);
  app.all('/api/autopost/daily-recap', dailyRecapHandler);
  app.all('/api/autopost/price-watch', priceWatchHandler);
  app.all('/admin', adminDashboardHandler);

  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`[server] avviato su http://localhost:${PORT}`);
    initTgMonitor(PORT);
  });

  // Riepilogo giornaliero: check ogni minuto
  cron.schedule('* * * * *', () => {
    runDailyRecapCheck(PORT).catch(e => console.error('[cron daily-recap]', e));
  });

  // Price watch per post con errore di prezzo: check ogni 2 minuti
  cron.schedule('*/2 * * * *', () => {
    runPriceWatchCheck().catch(e => console.error('[cron price-watch]', e));
  });

  // Autopost ogni minuto
  cron.schedule('* * * * *', () => {
    fetch(`http://localhost:${PORT}/api/autopost/publish`, { headers: cronHeaders() })
      .then(r => r.json())
      .then((d: any) => {
        if (d.published?.length) console.log('[cron] pubblicati:', d.published);
        if (d.errors?.length)    console.error('[cron] errori:', d.errors);
        if (d.skipped?.length)   console.log('[cron] skip:', d.skipped.join(' | '));
      })
      .catch(e => console.error('[cron autopost]', e));
  });

  // Refresh deals cache ogni 4 ore
  cron.schedule('0 */4 * * *', () => {
    fetch(`http://localhost:${PORT}/api/deals-cache`, { method: 'POST', headers: cronHeaders() })
      .then(r => r.json())
      .then((d: any) => console.log(`[cron deals-cache] refresh: ${d.refreshed ?? 0} utenti`))
      .catch(e => console.error('[cron deals-cache]', e));
  });

  // Price check ogni giorno alle 9:00
  cron.schedule('0 9 * * *', () => {
    fetch(`http://localhost:${PORT}/api/posts?action=price-check`, { headers: cronHeaders() })
      .catch(e => console.error('[cron price-check]', e));
  });
}

main().catch(err => {
  console.error('[server] errore avvio:', err);
  process.exit(1);
});
