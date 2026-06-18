import { invoke } from '@tauri-apps/api/core';
import { isTauriApp } from './audioStorageService';

export function diskDatabaseEnabled(): boolean {
  return isTauriApp();
}

export async function loadDatabaseJsonFromDisk(): Promise<string | null> {
  if (!diskDatabaseEnabled()) return null;
  try {
    const raw = await invoke<string | null>('load_database_file');
    return raw && raw.length > 0 ? raw : null;
  } catch (e) {
    console.error('[pflegemittelbox] disk db load failed', e);
    return null;
  }
}

export async function saveDatabaseJsonToDisk(json: string): Promise<boolean> {
  if (!diskDatabaseEnabled()) return false;
  try {
    await invoke('save_database_file', { content: json });
    return true;
  } catch (e) {
    console.error('[pflegemittelbox] disk db save failed', e);
    return false;
  }
}

export async function databaseFileKb(): Promise<number> {
  if (!diskDatabaseEnabled()) return 0;
  try {
    const bytes = await invoke<number>('database_file_bytes');
    return Math.round(Number(bytes || 0) / 1024);
  } catch {
    return 0;
  }
}

export async function getDatabaseFilePath(): Promise<string | undefined> {
  if (!diskDatabaseEnabled()) return undefined;
  try {
    return await invoke<string>('get_database_file_path');
  } catch {
    return undefined;
  }
}
