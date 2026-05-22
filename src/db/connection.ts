import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';

const DB_PATH = process.env.DB_PATH ?? path.resolve(process.cwd(), 'data', 'avisador.db');

let _db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (_db) return _db;

  _db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  // SQLite-specific pragmas
  await _db.exec('PRAGMA journal_mode = WAL');
  await _db.exec('PRAGMA foreign_keys = ON');
  await _db.exec('PRAGMA busy_timeout = 5000');

  return _db;
}

export async function closeDb(): Promise<void> {
  if (_db) {
    await _db.close();
    _db = null;
  }
}
