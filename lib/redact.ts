/**
 * Dettaglio sicuro di una risposta d'errore di un servizio esterno (Amazon, AliExpress), da usare
 * nei messaggi d'errore: questi finiscono nei log e, tramite withErrorHandler, nella risposta HTTP.
 * Tiene solo i campi descrittivi (error, error_description, message, code, type…), mai il corpo
 * intero, e oscura qualsiasi sequenza che somigli a un token, una chiave o una firma.
 */
const CAMPI = ['error', 'error_description', 'message', 'Message', 'code', 'Code', 'type', '__type', 'resp_msg', 'resp_code', 'msg', 'sub_msg'];

export function redactSecrets(s: string): string {
  return String(s)
    .replace(/Bearer\s+\S+/gi, 'Bearer [oscurato]')
    .replace(/"?(access_token|refresh_token|id_token|client_secret|credentialSecret|app_secret|appSecret|password|cookie|session(_string)?|sign)"?\s*[:=]\s*"?[^",\s}]+/gi, '$1=[oscurato]')
    .replace(/Atc\|[A-Za-z0-9+/=_|-]+/g, '[oscurato]')
    .replace(/[A-Za-z0-9+/=_-]{32,}/g, '[oscurato]');
}

export function upstreamDetail(body: string, max = 160): string {
  let out = '';
  try {
    const j = JSON.parse(body);
    const src = j && typeof j === 'object' ? (j.error_response ?? j.errors?.[0] ?? j) : {};
    const parts = CAMPI.map(k => src?.[k]).filter(v => typeof v === 'string' || typeof v === 'number').map(String);
    out = parts.join(' · ');
  } catch {
    out = String(body ?? '').replace(/\s+/g, ' ');
  }
  out = redactSecrets(out).slice(0, max);
  return out ? `: ${out}` : '';
}
