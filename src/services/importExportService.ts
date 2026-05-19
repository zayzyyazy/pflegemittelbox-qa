import type { Database } from './storageService';
export const exportData = (db: Database) => JSON.stringify(db, null, 2);
export const importData = (text: string): Database => JSON.parse(text);