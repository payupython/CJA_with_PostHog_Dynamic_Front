#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { getDb, closeDb } from './connection.js';
import { Database } from 'sqlite';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname ?? __dirname, 'migrations');

async function ensureMigrationsTable(db: Database): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      filename    TEXT    NOT NULL UNIQUE,
      applied_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);
}

async function getApplied(db: Database): Promise<Set<string>> {
  const rows = await db.all('SELECT filename FROM _migrations');
  return new Set(rows.map((r: any) => r.filename));
}

function getMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

export async function runMigrations(): Promise<void> {
  const db = await getDb();
  await ensureMigrationsTable(db);

  const applied = await getApplied(db);
  const files = getMigrationFiles();
  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log('[migrate] No pending migrations.');
    return;
  }

  for (const filename of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf-8');

    // sqlite3 transaction is a bit different, but we can just run the SQL
    try {
      await db.exec('BEGIN TRANSACTION');
      await db.exec(sql);
      await db.run('INSERT INTO _migrations (filename) VALUES (?)', filename);
      await db.exec('COMMIT');
      console.log(`[migrate] Applied: ${filename}`);
    } catch (error) {
      await db.exec('ROLLBACK');
      console.error(`[migrate] Failed to apply ${filename}:`, error);
      throw error;
    }
  }

  console.log(`[migrate] Done. ${pending.length} migration(s) applied.`);
}

// Run when executed directly
const isMain = process.argv[1] && (process.argv[1].endsWith('migrate.ts') || process.argv[1].endsWith('migrate.js'));
if (isMain) {
  runMigrations()
    .catch(console.error)
    .finally(() => closeDb());
}
