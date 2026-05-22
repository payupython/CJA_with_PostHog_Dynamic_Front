import { getDb } from './connection.js';

export interface Site {
  id: number;
  name: string;
  url: string;
  slug: string;
}

export async function getSiteBySlug(slug: string): Promise<Site | undefined> {
  const db = await getDb();
  return db.get('SELECT * FROM sites WHERE slug = ?', slug);
}

export async function getAllSites(): Promise<Site[]> {
  const db = await getDb();
  return db.all('SELECT * FROM sites');
}
