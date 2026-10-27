import { handlePrizeBotUpdate } from './handler.js';

const BOT_TOKEN = process.env.PRIZE_BOT_TOKEN || '';
const TG_BASE   = `https://api.telegram.org/bot${BOT_TOKEN}`;

export async function startPrizeBotPoller() {
  if (!BOT_TOKEN) { console.log('[prize-bot] PRIZE_BOT_TOKEN assente, poller non avviato'); return; }

  const me = await fetch(`${TG_BASE}/getMe`).then(r => r.json()) as any;
  if (!me?.ok) { console.error('[prize-bot] token non valido:', me?.description); return; }
  console.log(`[prize-bot] Poller avviato — bot @${me.result?.username}`);

  let offset = 0;

  while (true) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 32000);
      let updates: any[] = [];

      try {
        const res = await fetch(
          `${TG_BASE}/getUpdates?offset=${offset}&timeout=25&allowed_updates=${encodeURIComponent('["message"]')}`,
          { signal: controller.signal }
        );
        clearTimeout(timer);
        if (res.ok) {
          const json = await res.json() as { ok: boolean; result: any[] };
          if (json.ok) updates = json.result ?? [];
        } else {
          await new Promise(r => setTimeout(r, 5000));
        }
      } catch (e: any) {
        clearTimeout(timer);
        if (e.name !== 'AbortError') await new Promise(r => setTimeout(r, 5000));
      }

      for (const update of updates) {
        if (update.update_id >= offset) offset = update.update_id + 1;
        handlePrizeBotUpdate(update).catch(e =>
          console.error('[prize-bot] errore update:', e.message?.slice(0, 120))
        );
      }
    } catch (e: any) {
      console.error('[prize-bot] poll loop error:', e.message?.slice(0, 100));
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}
