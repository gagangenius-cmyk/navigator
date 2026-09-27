import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { SECURE_KEYS, secureStorage } from '@/services/storage/secureStorage';

// Offline cache database. It holds client names, phone numbers and payment
// figures, so it is encrypted with SQLCipher (enabled by the expo-sqlite config
// plugin in app.config.ts) using a random key kept in the Keychain/Keystore.
const DB_NAME = 'navigator-cache.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getOrCreateKey(): Promise<string> {
  const existing = await secureStorage.get(SECURE_KEYS.dbKey);
  if (existing) return existing;
  const hex = Array.from(Crypto.getRandomBytes(32), (b) => b.toString(16).padStart(2, '0')).join('');
  await secureStorage.set(SECURE_KEYS.dbKey, hex);
  return hex;
}

async function openAndMigrate(key: string): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  // SQLCipher requires the key to be the very first statement. The raw-key
  // syntax skips the passphrase KDF - the key is already 256 random bits.
  await db.execAsync(`PRAGMA key = "x'${key}'";`);
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS cache_entries (
      scope TEXT NOT NULL,
      key TEXT NOT NULL,
      json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (scope, key)
    );
  `);
  return db;
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  const key = await getOrCreateKey();
  try {
    return await openAndMigrate(key);
  } catch {
    // "file is not a database": the key was lost (Keychain reset) or the file
    // is corrupt. It is only a cache - start over rather than wedge the app.
    await SQLite.deleteDatabaseAsync(DB_NAME).catch(() => undefined);
    return openAndMigrate(key);
  }
}

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = open().catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

/** Deletes every cached row and the database key. Called on logout. */
export async function destroyDb(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  try {
    const db = pending ? await pending.catch(() => null) : null;
    await db?.closeAsync();
  } catch {
    // closing is best effort - the file is deleted next either way
  }
  await SQLite.deleteDatabaseAsync(DB_NAME).catch(() => undefined);
  await secureStorage.remove(SECURE_KEYS.dbKey).catch(() => undefined);
}
