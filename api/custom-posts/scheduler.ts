import sql from '../../lib/db.js';
import { sendCustomPost } from './[id].js';

export async function runCustomPostScheduler(): Promise<void> {
  const now = new Date();
  const todayDay = now.getDay(); // 0=Dom, 1=Lun, ..., 6=Sab
  const todayStr = now.toISOString().slice(0, 10);
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

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
