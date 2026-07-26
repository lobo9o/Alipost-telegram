import sql from '../../lib/db.js';
import { sendCustomPost } from './[id].js';

export async function runCustomPostScheduler(): Promise<void> {
  const now = new Date();
  // Usa sempre il fuso orario italiano (Europe/Rome) indipendentemente dal sistema
  const romeStr = now.toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }); // "2026-07-26 23:23:00"
  const todayStr = romeStr.slice(0, 10);   // "2026-07-26"
  const timeStr  = romeStr.slice(11, 16);  // "23:23"
  const [y, m, d] = todayStr.split('-').map(Number);
  const todayDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Dom … 6=Sab

  const posts = await sql`
    SELECT id, user_id, title, image, body, keyboard, schedules
    FROM custom_posts
    WHERE jsonb_array_length(schedules) > 0
  `.catch(() => [] as any[]);

  for (const post of posts) {
    const schedules: Array<{ id: string; days: number[]; time: string; channel: string; active: boolean; lastSentDate?: string }> =
      Array.isArray(post.schedules) ? post.schedules : [];

    let changed = false;
    for (const sched of schedules) {
      if (!sched.active) continue;
      if (!sched.days.includes(todayDay)) continue;
      if (sched.time !== timeStr) continue;
      if (sched.lastSentDate === todayStr) continue;

      console.log(`[custom-scheduler] invio "${post.title}" → ${sched.channel} (${timeStr})`);
      const result = await sendCustomPost(post, sched.channel, String(post.user_id)).catch((e: any) => ({ ok: false, error: e?.message }));
      if (result.ok) {
        sched.lastSentDate = todayStr;
        changed = true;
        console.log(`[custom-scheduler] ✅ inviato "${post.title}" → ${sched.channel}`);
      } else {
        console.error(`[custom-scheduler] ❌ errore "${post.title}" → ${sched.channel}: ${result.error}`);
      }
    }

    if (changed) {
      await sql`UPDATE custom_posts SET schedules = ${sql.json(schedules)} WHERE id = ${post.id}`.catch(() => {});
    }
  }
}
