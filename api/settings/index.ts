import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';
import { withErrorHandler, allowMethods, requireUserId } from '../_utils.js';

// Campi condivisi dal profilo primario — mai salvati nei profili secondari
const SHARED_AMAZON_FIELDS = ['credentialId', 'credentialSecret', 'marketplace', 'version'] as const;
const SHARED_ALI_FIELDS    = ['appKey', 'appSecret'] as const;

function extractSharedCreds(data: Record<string, any>) {
  const am = (data.amazon ?? {}) as Record<string, any>;
  const al = (data.aliexpress ?? {}) as Record<string, any>;
  return {
    amazon:    Object.fromEntries(SHARED_AMAZON_FIELDS.map(k => [k, am[k] ?? ''])),
    aliexpress: Object.fromEntries(SHARED_ALI_FIELDS.map(k => [k, al[k] ?? ''])),
  };
}

function stripSharedCreds(data: Record<string, any>): Record<string, any> {
  const copy = { ...data };
  if (copy.amazon) {
    const am = { ...copy.amazon };
    for (const k of SHARED_AMAZON_FIELDS) delete am[k];
    copy.amazon = am;
  }
  if (copy.aliexpress) {
    const al = { ...copy.aliexpress };
    for (const k of SHARED_ALI_FIELDS) delete al[k];
    copy.aliexpress = al;
  }
  return copy;
}

export default withErrorHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (!allowMethods(['GET', 'POST'], req, res)) return;
  const userId = requireUserId(req, res);
  if (!userId) return;

  const isSecondary = userId.includes(':');
  const primaryId   = isSecondary ? userId.split(':')[0] : null;

  if (req.method === 'GET') {
    const rows = await sql`SELECT data FROM settings WHERE user_id = ${userId}`;
    const raw  = rows[0]?.data ?? {};
    const data = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, any>;
    const size = JSON.stringify(data).length;
    console.log('[settings] GET userId:', userId, 'rows:', rows.length, 'size:', size);
    if (size > 10_000) {
      console.warn('[settings] data troppo grande — reset a {}');
      await sql`UPDATE settings SET data = ${sql.json({})}, updated_at = now() WHERE user_id = ${userId}`;
      res.json({ _publishedCount: 0 });
      return;
    }

    // Per i profili secondari, inietta le credenziali del profilo primario
    let merged: Record<string, any> = data;
    if (isSecondary && primaryId) {
      const channelId = userId.split(':')[1]; // il canale di questo profilo
      const [primRow] = await sql`SELECT data FROM settings WHERE user_id = ${primaryId}`.catch(() => [null]);
      if (primRow) {
        const primData = (typeof primRow.data === 'string' ? JSON.parse(primRow.data) : primRow.data) as Record<string, any>;
        const shared = extractSharedCreds(primData);
        merged = {
          ...data,
          // Il profilo secondario pubblica sempre sul proprio canale
          channels: Array.isArray(data.channels) && data.channels.length > 0
            ? data.channels
            : [channelId],
          amazon: {
            enabled: primData.amazon?.enabled ?? false,
            ...data.amazon,
            ...shared.amazon,
          },
          aliexpress: {
            enabled: primData.aliexpress?.enabled ?? false,
            ...data.aliexpress,
            ...shared.aliexpress,
          },
        };
      }
    }

    const [countRow] = await sql`
      SELECT COUNT(*)::int AS cnt FROM published_posts WHERE user_id = ${userId}
    `.catch(() => [{ cnt: 0 }]);

    // Per profili secondari: inietta i canali del primario direttamente nella risposta
    // così AppContext non deve fare un secondo fetch per il ChannelSwitcher
    let primaryChannels: string[] | undefined;
    if (isSecondary && primaryId) {
      const [pRow] = await sql`SELECT data FROM settings WHERE user_id = ${primaryId}`.catch(() => [null]);
      if (pRow) {
        const pData = (typeof pRow.data === 'string' ? JSON.parse(pRow.data) : pRow.data) as Record<string, any>;
        primaryChannels = Array.isArray(pData.channels) ? pData.channels.filter(Boolean) : [];
      }
    }

    res.json({
      ...merged,
      _publishedCount: countRow?.cnt ?? 0,
      ...(primaryChannels !== undefined ? { _primaryChannels: primaryChannels } : {}),
    });
    return;
  }

  // POST — salva settings
  const data = req.body as Record<string, any>;
  const channels = Array.isArray(data?.channels) ? data.channels.filter((c: string) => typeof c === 'string' && c.trim()) : [];
  // Per i profili secondari, rimuovi le credenziali condivise (vengono sempre dal primario)
  const toSave = isSecondary ? stripSharedCreds({ ...data, channels }) : { ...data, channels };
  console.log('[settings] SAVE userId:', userId, 'channels:', channels, 'secondary:', isSecondary);
  const existing = await sql`SELECT id FROM settings WHERE user_id = ${userId}`;
  if (existing.length > 0) {
    await sql`UPDATE settings SET data = ${sql.json(toSave)}, updated_at = now() WHERE user_id = ${userId}`;
  } else {
    await sql`INSERT INTO settings (user_id, data, updated_at) VALUES (${userId}, ${sql.json(toSave)}, now())`;
  }
  res.json({ ok: true });
});
