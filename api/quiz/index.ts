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

async function tgForm(method: string, form: FormData) {
  const r = await fetch(`${TG_BASE}/${method}`, { method: 'POST', body: form });
  return r.json() as Promise<any>;
}

async function initTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS quizzes (
      id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       TEXT         NOT NULL,
      channel_id    TEXT         NOT NULL,
      message_id    BIGINT,
      header_text   TEXT,
      question      TEXT         NOT NULL,
      answers       JSONB        NOT NULL,
      prize_code    TEXT         NOT NULL,
      image         TEXT,
      status        TEXT         NOT NULL DEFAULT 'active',
      winner_tg_id  BIGINT,
      winner_username TEXT,
      created_at    TIMESTAMPTZ  DEFAULT now(),
      won_at        TIMESTAMPTZ
    )
  `.catch(() => {});
  // Migrazione: aggiunge colonne mancanti su tabelle già esistenti
  await sql`ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS header_text TEXT`.catch(() => {});
  await sql`ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS image TEXT`.catch(() => {});
}

export default async function handler(req: any, res: any) {
  const userId = String(req.headers['x-internal-user-id'] || req.query.userId || '');
  if (!userId) return res.status(401).json({ error: 'Non autorizzato' });

  await initTable();

  // ── GET: lista quiz ──────────────────────────────────────────
  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, channel_id, header_text, question, answers, prize_code, status,
             winner_username, created_at, won_at, message_id
      FROM quizzes WHERE user_id = ${userId}
      ORDER BY created_at DESC LIMIT 50
    `.catch(() => []);
    return res.json(rows);
  }

  // ── POST: crea e pubblica quiz ───────────────────────────────
  if (req.method === 'POST') {
    const { question, answers, prizeCode, channelId, headerText, image } = req.body ?? {};
    if (!question || !Array.isArray(answers) || answers.length < 2 || !prizeCode || !channelId) {
      return res.status(400).json({ error: 'Dati mancanti' });
    }
    const correctIdx = (answers as any[]).findIndex((a: any) => a.correct);
    if (correctIdx < 0) return res.status(400).json({ error: 'Nessuna risposta corretta selezionata' });

    const header = String(headerText || '🎯 QUIZ — Vinci un Buono Amazon!').trim();

    const [quiz] = await sql`
      INSERT INTO quizzes (user_id, channel_id, header_text, question, answers, prize_code, image)
      VALUES (${userId}, ${channelId}, ${header}, ${question}, ${sql.json(answers)}, ${prizeCode}, ${image || null})
      RETURNING id
    `.catch(() => []);
    if (!quiz) return res.status(500).json({ error: 'Errore DB' });

    const letters = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫', '🇬', '🇭'];
    const caption =
      `${header}\n\n` +
      `❓ <b>${question}</b>\n\n` +
      `<i>Clicca la risposta esatta — il primo che risponde correttamente vince! 🎁</i>`;

    const buttons = (answers as any[]).map((a: any, i: number) => ({
      text: `${letters[i] ?? String.fromCharCode(65 + i)} ${a.text}`,
      callback_data: `quiz:${quiz.id}:${i}`,
    }));
    const inline_keyboard: object[][] = [];
    for (let i = 0; i < buttons.length; i += 2) inline_keyboard.push(buttons.slice(i, i + 2));
    const reply_markup = { inline_keyboard };

    let r: any;
    if (image) {
      // Invia con immagine — base64 → multipart
      const form = new FormData();
      form.append('chat_id', channelId);
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
      form.append('reply_markup', JSON.stringify(reply_markup));
      if (image.startsWith('http')) {
        form.append('photo', image);
        r = await tgForm('sendPhoto', form);
      } else {
        const b64 = image.replace(/^data:[^;]+;base64,/, '');
        const mime = image.match(/^data:([^;]+)/)?.[1] ?? 'image/jpeg';
        form.append('photo', new Blob([Buffer.from(b64, 'base64')], { type: mime }), 'quiz.jpg');
        r = await tgForm('sendPhoto', form);
      }
    } else {
      r = await tg('sendMessage', { chat_id: channelId, text: caption, parse_mode: 'HTML', reply_markup });
    }

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

    if (quiz.status === 'active' && quiz.message_id) {
      const cancelText = `❌ <b>Quiz annullato</b>\n\n❓ ${quiz.question}`;
      if (quiz.image) {
        await tg('editMessageCaption', {
          chat_id: quiz.channel_id, message_id: Number(quiz.message_id),
          caption: cancelText, parse_mode: 'HTML',
        }).catch(() => {});
      } else {
        await tg('editMessageText', {
          chat_id: quiz.channel_id, message_id: Number(quiz.message_id),
          text: cancelText, parse_mode: 'HTML',
        }).catch(() => {});
      }
    }

    await sql`DELETE FROM quizzes WHERE id = ${id}`.catch(() => {});
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Metodo non supportato' });
}
