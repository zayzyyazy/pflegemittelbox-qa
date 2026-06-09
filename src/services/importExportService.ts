import type { Database } from './storageService';
import { migrateDatabase } from './storageService';

export const exportData = (db: Database) => JSON.stringify(db, null, 2);

export const importData = (text: string): Database => {
  const parsed = JSON.parse(text) as Partial<Database>;
  return migrateDatabase(parsed);
};