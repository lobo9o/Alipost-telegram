import sql from '../../lib/db.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_BASE   = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tg(method: string, body: Record<string, unknown>) {
  const r = await fetch(`${TG_BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json() as Promise<any>;
}

async function initTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS quizzes (
      id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      TEXT         NOT NULL,
      channel_id   TEXT         NOT NULL,
      message_id   BIGINT,
      question     TEXT         NOT NULL,
      answers      JSONB        NOT NULL,
      prize_code   TEXT         NOT NULL,
      status       TEXT         NOT NULL DEFAULT 'active',
      winner_tg_id BIGINT,
      winner_username TEXT,
      created_at   TIMESTAMPTZ  DEFAULT now(),
      won_at       TIMESTAMPTZ
    )
  `.catch(() => {});
}

export default async function handler(req: any, res: any) {
  const userId = String(req.headers['x-internal-user-id'] || req.query.userId || '');
  if (!userId) return res.status(401).json({ error: 'Non autorizzato' });

  await initTable();

  // ── GET: lista quiz ──────────────────────────────────────────
  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, channel_id, question, answers, prize_code, status,
             winner_username, created_at, won_at, message_id
      FROM quizzes WHERE user_id = ${userId}
      ORDER BY created_at DESC LIMIT 50
    `.catch(() => []);
    return res.json(rows);
  }

  // ── POST: crea e pubblica quiz ───────────────────────────────
  if (req.method === 'POST') {
    const { question, answers, prizeCode, channelId } = req.body ?? {};
    if (!question || !Array.isArray(answers) || answers.length < 2 || !prizeCode || !channelId) {
      return res.status(400).json({ error: 'Dati mancanti' });
    }
    const correctIdx = (answers as any[]).findIndex((a: any) => a.correct);
    if (correctIdx < 0) return res.status(400).json({ error: 'Nessuna risposta corretta selezionata' });

    const [quiz] = await sql`
      INSERT INTO quizzes (user_id, channel_id, question, answers, prize_code)
      VALUES (${userId}, ${channelId}, ${question}, ${sql.json(answers)}, ${prizeCode})
      RETURNING id
    `.catch(() => []);
    if (!quiz) return res.status(500).json({ error: 'Errore DB' });

    const letters = ['🇦', '🇧', '🇨', '🇩'];
    const text =
      `🎯 <b>QUIZ — Vinci un Buono Amazon!</b>\n\n` +
      `❓ <b>${question}</b>\n\n` +
      `<i>Clicca la risposta esatta — il primo che risponde correttamente vince! 🎁</i>`;

    const buttons = (answers as any[]).map((a: any, i: number) => ({
      text: `${letters[i]} ${a.text}`,
      callback_data: `quiz:${quiz.id}:${i}`,
    }));
    const inline_keyboard: object[][] = [];
    for (let i = 0; i < buttons.length; i += 2) inline_keyboard.push(buttons.slice(i, i + 2));

    const r = await tg('sendMessage', {
      chat_id: channelId,
      text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard },
    });

    if (!r?.ok) {
      await sql`DELETE FROM quizzes WHERE id = ${quiz.id}`.catch(() => {});
      return res.status(500).json({ error: r?.description ?? 'Errore invio Telegram' });
    }

    const messageId = r.result?.message_id;
    await sql`UPDATE quizzes SET message_id = ${messageId} WHERE id = ${quiz.id}`.catch(() => {});

    return res.json({ ok: true, id: quiz.id, messageId });
  }

  // ── DELETE: annulla o elimina quiz ──────────────────────────
  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'ID mancante' });

    const [quiz] = await sql`SELECT * FROM quizzes WHERE id = ${id} AND user_id = ${userId}`.catch(() => []);
    if (!quiz) return res.status(404).json({ error: 'Quiz non trovato' });

    // Se ancora attivo: aggiorna il messaggio Telegram prima di eliminare
    if (quiz.status === 'active' && quiz.message_id) {
      await tg('editMessageText', {
        chat_id: quiz.channel_id,
        message_id: Number(quiz.message_id),
        text: `❌ <b>Quiz annullato</b>\n\n❓ ${quiz.question}`,
        parse_mode: 'HTML',
      }).catch(() => {});
    }

    await sql`DELETE FROM quizzes WHERE id = ${id}`.catch(() => {});
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Metodo non supportato' });
}
