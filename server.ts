import express from 'express';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import cron from 'node-cron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);

// Carica handler tramite URL per gestire nomi di file con caratteri speciali
async function loadHandler(relPath: string) {
  const abs = path.join(__dirname, relPath);
  const mod = await import(pathToFileURL(abs).href);
  return mod.default as (req: any, res: any) => Promise<void>;
}

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve la build React
app.use(express.static(path.join(__dirname, 'build')));

// Carica tutti gli handler all'avvio
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
]);

// Helper per iniettare l'id come query param (compatibilità Vercel rewrites)
function withId(handler: (req: any, res: any) => any) {
  return (req: any, res: any) => {
    req.query.id = req.params.id;
    return handler(req, res);
  };
}

// Route API
app.all('/api/settings', settingsHandler);
app.all('/api/tags', tagsHandler);
app.all('/api/tags/:id', withId(tagsHandler));
app.all('/api/keyboards', keyboardsHandler);
app.all('/api/keyboards/:id', withId(keyboardsHandler));
app.all('/api/layouts', layoutsHandler);
app.all('/api/layouts/:id', withId(layoutsIdHandler));
// /api/autopost/publish PRIMA di /api/autopost/:id
app.all('/api/autopost/publish', autopostPublishHandler);
app.all('/api/autopost', autopostHandler);
app.all('/api/autopost/:id', withId(autopostIdHandler));
app.all('/api/posts', postsHandler);
app.all('/api/posts/:id', withId(postsIdHandler));
app.all('/api/product', productHandler);
app.all('/api/templates', templatesHandler);
app.all('/api/templates/:id', withId(templatesIdHandler));

// React SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// Avvia server
app.listen(PORT, () => {
  console.log(`[server] avviato su http://localhost:${PORT}`);
});

// ── Cron jobs ────────────────────────────────────────────────────────────────

const cronHeaders = () => {
  const s = process.env.CRON_SECRET;
  return s ? { authorization: `Bearer ${s}` } : {};
};

// Autopost ogni minuto
cron.schedule('* * * * *', () => {
  fetch(`http://localhost:${PORT}/api/autopost/publish`, { headers: cronHeaders() })
    .then(r => r.json())
    .then((d: any) => {
      if (d.published?.length) console.log('[cron] pubblicati:', d.published);
      if (d.errors?.length)    console.error('[cron] errori:', d.errors);
    })
    .catch(e => console.error('[cron autopost]', e));
});

// Price check ogni giorno alle 9:00
cron.schedule('0 9 * * *', () => {
  fetch(`http://localhost:${PORT}/api/posts?action=price-check`, { headers: cronHeaders() })
    .catch(e => console.error('[cron price-check]', e));
});
