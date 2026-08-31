import { env } from 'cloudflare:workers';
import { schemaStatements } from './schema';

let schemaReady: Promise<void> | null = null;

export function getDb() {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new Error('The social database binding is not configured.');
  return db;
}

export async function ensureDb() {
  if (!schemaReady) {
    const db = getDb();
    schemaReady = db.batch(schemaStatements.map((statement) => db.prepare(statement))).then(() => undefined).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
  return getDb();
}
