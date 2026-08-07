/**
 * Cancella i messaggi di @cavalieridelrisparmio nel range di date specificato.
 * Uso: npx tsx delete-old-posts.ts
 * Da cancellare dopo l'uso.
 */
import * as path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.env') });

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL!;
const TG_API_ID   = parseInt(process.env.TG_API_ID   || '0', 10);
const TG_API_HASH = process.env.TG_API_HASH || '';

const USER_ID = '54225500';
const CHANNEL_ID = -1003593220674; // @cavalieridelrisparmio

// Range di date da cancellare
const FROM_TS = Math.floor(new Date('2026-02-01T00:00:00Z').getTime() / 1000);
const TO_TS   = Math.floor(new Date('2026-07-31T23:59:59Z').getTime() / 1000);

async function main() {
  // Carica session string dal DB
  const isLocal = DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1');
  const sql = postgres(DATABASE_URL, { ssl: isLocal ? false : { rejectUnauthorized: false } });

  const [row] = await sql<{ session_string: string }[]>`
    SELECT session_string FROM tg_sessions WHERE user_id = ${USER_ID}
  `;
  await sql.end();

  if (!row?.session_string) {
    console.error('❌ Nessuna sessione MTProto trovata per userId', USER_ID);
    process.exit(1);
  }

  const client = new TelegramClient(
    new StringSession(row.session_string),
    TG_API_ID,
    TG_API_HASH,
    { connectionRetries: 3, requestRetries: 3 }
  );

  await client.connect();
  console.log('✅ Connesso a Telegram');
  console.log(`📅 Range: ${new Date(FROM_TS * 1000).toISOString()} → ${new Date(TO_TS * 1000).toISOString()}`);

  const channel = await client.getEntity(CHANNEL_ID);

  // Trovare il primo messaggio ID da cui partire (intorno a TO_TS)
  const seed = await client.getMessages(channel, { limit: 1, offsetDate: TO_TS + 1 });
  if (seed.length === 0) {
    console.log('Nessun messaggio trovato prima di TO_TS');
    await client.disconnect();
    return;
  }

  let offsetId  = seed[0].id + 1;
  let totalDeleted = 0;
  let done = false;

  while (!done) {
    // Recupera fino a 100 messaggi con ID < offsetId
    const messages = await client.getMessages(channel, {
      limit: 100,
      offsetId,
    });

    if (messages.length === 0) break;

    const toDelete: number[] = [];
    for (const msg of messages) {
      if (msg.date > TO_TS)   continue;        // messaggio più recente del range, salta
      if (msg.date < FROM_TS) { done = true; break; } // siamo prima di febbraio, stop
      toDelete.push(msg.id);
    }

    if (toDelete.length > 0) {
      await client.deleteMessages(channel, toDelete, { revoke: true });
      totalDeleted += toDelete.length;
      process.stdout.write(`\r🗑  ${totalDeleted} messaggi cancellati...`);
      // Pausa breve per evitare flood limit
      await new Promise(r => setTimeout(r, 400));
    }

    // Paginazione: prossimo batch dal messaggio più vecchio di questo
    offsetId = messages[messages.length - 1].id;

    if (messages.length < 100) break; // ultima pagina
  }

  process.stdout.write('\n');
  console.log(`✅ Completato: ${totalDeleted} messaggi cancellati da @cavalieridelrisparmio`);

  await client.disconnect();
  process.exit(0);
}

main().catch(e => {
  console.error('❌ Errore:', e.message ?? e);
  process.exit(1);
});
