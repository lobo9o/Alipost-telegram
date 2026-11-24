import crypto from 'crypto';

/**
 * Autenticazione delle chiamate che il server fa a sé stesso (Monitor Canali, cron, riepiloghi).
 *
 * Dietro Cloudflare Tunnel anche le richieste pubbliche arrivano dal socket locale, quindi
 * l'indirizzo non prova nulla. Le chiamate interne portano un token casuale generato a ogni
 * avvio del processo: resta solo in memoria, non è nel .env, non va su disco né nei log e non
 * viene mai inviato fuori da localhost. Chi arriva da Internet non può conoscerlo.
 */
// Lo stesso file può essere caricato due volte nello stesso processo (server.ts come CommonJS,
// i gestori con import() dinamico): il token sta in un registro unico del processo, così ogni
// copia del modulo usa lo stesso valore.
const KEY = Symbol.for('postdealbot.internalAuthToken');
const G = globalThis as unknown as Record<symbol, string | undefined>;
const INTERNAL_TOKEN: string = (G[KEY] ??= crypto.randomBytes(32).toString('base64url'));

export const INTERNAL_AUTH_HEADER = 'x-internal-auth';

/** Confronto a tempo costante: non rivela quanti caratteri coincidono */
export function safeEqual(a: string, b: string): boolean {
  const h = (s: string) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

/** Header per una chiamata interna, eventualmente per conto di un utente o profilo */
export function internalHeaders(userId?: string | null, json = false): Record<string, string> {
  const headers: Record<string, string> = { [INTERNAL_AUTH_HEADER]: INTERNAL_TOKEN };
  if (json) headers['Content-Type'] = 'application/json';
  if (userId) headers['x-internal-user-id'] = String(userId);
  return headers;
}

/** Vero se la richiesta porta il token interno di questo processo */
export function hasInternalToken(headers: Record<string, unknown>): boolean {
  const v = headers[INTERNAL_AUTH_HEADER];
  return typeof v === 'string' && v.length > 0 && safeEqual(v, INTERNAL_TOKEN);
}
