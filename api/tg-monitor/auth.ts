import { withErrorHandler, requireUserId } from '../_utils.js';
import sql from '../../lib/db.js';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Api } from 'telegram/tl/index.js';

// Stato temporaneo in-memory durante il flusso di autenticazione
const pendingAuth = new Map<string, {
  client: TelegramClient;
  phoneCodeHash: string;
  phone: string;
}>();

function getApiCredentials() {
  const apiId = parseInt(process.env.TG_API_ID || '0', 10);
  const apiHash = process.env.TG_API_HASH || '';
  if (!apiId || !apiHash) throw new Error('TG_API_ID e TG_API_HASH non configurati nel server');
  return { apiId, apiHash };
}

export default withErrorHandler(async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  // La sessione Telegram è condivisa tra tutti i profili dello stesso account
  const baseUserId = userId.includes(':') ? userId.split(':')[0] : userId;

  const { action } = req.body ?? {};

  // ── Status ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    const [row] = await sql<{ status: string; phone: string | null }[]>`
      SELECT status, phone FROM tg_sessions WHERE user_id = ${baseUserId}
    `;
    return res.json(row ?? { status: 'none', phone: null });
  }

  if (!['sendCode', 'signIn', 'signOut', 'confirm2FA'].includes(action)) {
    return res.status(400).json({ error: 'Azione non valida' });
  }

  // ── Sign Out ─────────────────────────────────────────────────
  if (action === 'signOut') {
    const [row] = await sql<{ session_string: string }[]>`
      SELECT session_string FROM tg_sessions WHERE user_id = ${baseUserId}
    `;
    if (row?.session_string) {
      try {
        const { apiId, apiHash } = getApiCredentials();
        const client = new TelegramClient(
          new StringSession(row.session_string), apiId, apiHash, { connectionRetries: 2 }
        );
        await client.connect();
        await client.invoke(new Api.auth.LogOut());
        await client.disconnect();
      } catch { /* ignora errori di logout */ }
    }
    await sql`DELETE FROM tg_sessions WHERE user_id = ${baseUserId}`;
    pendingAuth.delete(baseUserId);
    const { reloadUser } = await import('./worker.js');
    reloadUser(baseUserId);
    return res.json({ ok: true });
  }

  // ── Send Code ────────────────────────────────────────────────
  if (action === 'sendCode') {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Numero di telefono mancante' });

    const { apiId, apiHash } = getApiCredentials();
    const session = new StringSession('');
    const client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 3,
      useWSS: false,
    });
    await client.connect();

    const result = await client.invoke(new Api.auth.SendCode({
      phoneNumber: phone,
      apiId,
      apiHash,
      settings: new Api.CodeSettings({}),
    }));

    pendingAuth.set(baseUserId, {
      client,
      phoneCodeHash: (result as any).phoneCodeHash,
      phone,
    });

    return res.json({ codeSent: true });
  }

  // ── Sign In ──────────────────────────────────────────────────
  if (action === 'signIn') {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Codice mancante' });

    const pending = pendingAuth.get(baseUserId);
    if (!pending) return res.status(400).json({ error: 'Sessione di login scaduta, riprova con il numero' });

    const { client, phoneCodeHash, phone } = pending;

    try {
      await client.invoke(new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCodeHash,
        phoneCode: code,
      }));
    } catch (e: any) {
      if (e?.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        return res.json({ need2FA: true });
      }
      throw e;
    }

    const sessionString = (client.session as StringSession).save() as string;
    pendingAuth.delete(baseUserId);

    await sql`
      INSERT INTO tg_sessions (id, user_id, phone, session_string, status)
      VALUES (${crypto.randomUUID()}, ${baseUserId}, ${phone}, ${sessionString}, 'active')
      ON CONFLICT (user_id) DO UPDATE SET phone = EXCLUDED.phone, session_string = EXCLUDED.session_string, status = 'active'
    `;

    await client.disconnect();

    const { reloadUser } = await import('./worker.js');
    reloadUser(baseUserId);

    return res.json({ ok: true });
  }

  // ── 2FA Password ─────────────────────────────────────────────
  if (action === 'confirm2FA') {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password 2FA mancante' });

    const pending = pendingAuth.get(baseUserId);
    if (!pending) return res.status(400).json({ error: 'Sessione scaduta, riprova' });

    const { client, phone } = pending;

    const pwdInfo = await client.invoke(new Api.account.GetPassword({})) as any;
    const { computeCheck } = await import('telegram/Password.js');
    const inputCheckPassword = await computeCheck(pwdInfo, password);
    await client.invoke(new Api.auth.CheckPassword({ password: inputCheckPassword }));

    const sessionString = (client.session as StringSession).save() as string;
    pendingAuth.delete(baseUserId);

    await sql`
      INSERT INTO tg_sessions (id, user_id, phone, session_string, status)
      VALUES (${crypto.randomUUID()}, ${baseUserId}, ${phone}, ${sessionString}, 'active')
      ON CONFLICT (user_id) DO UPDATE SET phone = EXCLUDED.phone, session_string = EXCLUDED.session_string, status = 'active'
    `;

    await client.disconnect();

    const { reloadUser } = await import('./worker.js');
    reloadUser(baseUserId);

    return res.json({ ok: true });
  }
});
