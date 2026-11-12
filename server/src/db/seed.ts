import { CATALOG } from '../catalog.js';
import type { Database } from './index.js';
import { plans } from './schema.js';

export async function seedCatalog(db: Database): Promise<void> {
  await db.insert(plans).values(CATALOG).onConflictDoNothing();
}