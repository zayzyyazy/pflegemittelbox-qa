import { nowIso } from '../utils/dates';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { CallReview } from '../types/CallReview';

async function invokeTauri<T>(command: string, args: Record<string, unknown> = {}): Promise<T | undefined> {
  if (!('__TAURI_INTERNALS__' in window)) return undefined;
  return invoke<T>(command, args);
}

export function isTauriApp() {
  return '__TAURI_INTERNALS__' in window;
}

export async function readAudioMetadata(file: File): Promise<Partial<CallReview>> {
  return {
    audio_file_name: file.name,
    audio_file_size: file.size,
    audio_file_type: file.type,
    audio_file_last_modified: file.lastModified,
    imported_at: nowIso()
  };
}

export async function deleteStoredAudio(call: Partial<CallReview>): Promise<void> {
  if (call.audio_local_path) {
    await invokeTauri('delete_audio_file', { path: call.audio_local_path });
  }
  if (call.audio_storage_key) {
    localStorage.removeItem(call.audio_storage_key);
  }
}

export class AudioPersistError extends Error {
  constructor(message = 'Audio could not be saved locally — playback will fail after import.') {
    super(message);
    this.name = 'AudioPersistError';
  }
}

/** Copy audio into app-managed storage (Tauri app_data/audio or localStorage fallback). */
export async function persistAudioFile(
  callId: string,
  file: File
): Promise<{ audio_local_path?: string; audio_storage_key?: string }> {
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  const audio_local_path = await invokeTauri<string>('save_audio_file', {
    callId,
    fileName: file.name,
    bytes
  });
  if (audio_local_path) return { audio_local_path };

  const key = 'ai-call-qa-audio-v1:' + callId;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
  try {
    localStorage.setItem(key, dataUrl);
    return { audio_storage_key: key };
  } catch {
    return {};
  }
}

export async function attachAudioToCall(callId: string, file: File) {
  const [meta, copy] = await Promise.all([readAudioMetadata(file), persistAudioFile(callId, file)]);
  if (!copy.audio_local_path && !copy.audio_storage_key) {
    throw new AudioPersistError();
  }
  return { ...meta, ...copy, audio_original_path: undefined };
}

export async function getAudioStorageDirectory(): Promise<string | undefined> {
  return invokeTauri<string>('get_audio_storage_dir');
}

export async function openRecording(path?: string) {
  if (!path) return;
  await invokeTauri('open_audio_path', { path });
}

export async function revealRecording(path?: string) {
  if (!path) return;
  await invokeTauri('reveal_audio_path', { path });
}

export function revokePlayableAudioUrl(url?: string) {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
}

/**
 * Prefer Tauri asset URL for playback; CallAudioPlayer retries with loadAudioDataUrl on error.
 */
export async function loadAudioDataUrl(path: string): Promise<string | undefined> {
  if (!isTauriApp()) return undefined;
  return invokeTauri<string>('read_audio_playback_url', { path });
}

export async function loadPlayableAudioUrl(
  path?: string,
  storageKey?: string
): Promise<string | undefined> {
  if (path && isTauriApp()) {
    const exists = await invokeTauri<boolean>('audio_file_exists', { path });
    if (exists !== false) {
      try {
        const assetUrl = convertFileSrc(path);
        if (assetUrl) return assetUrl;
      } catch {
        // fall through to data URL
      }
    }
  }

  if (storageKey) {
    const stored = localStorage.getItem(storageKey);
    if (stored) return stored;
  }

  return undefined;
}

function dataUrlToFile(dataUrl: string, name: string): File {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'audio/wav';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

/** Load stored audio as a File for re-transcription / re-analysis. */
export async function loadFileFromStoredAudio(call: Partial<CallReview>): Promise<File | undefined> {
  const name = call.audio_file_name || 'recording.wav';
  if (call.audio_storage_key) {
    const stored = localStorage.getItem(call.audio_storage_key);
    if (stored) return dataUrlToFile(stored, name);
  }
  if (call.audio_local_path && isTauriApp()) {
    const dataUrl = await invokeTauri<string>('read_audio_playback_url', { path: call.audio_local_path });
    if (dataUrl) return dataUrlToFile(dataUrl, name);
  }
  return undefined;
}

export async function ensureCallHasLocalAudio(call: CallReview, file?: File) {
  if (call.audio_local_path || call.audio_storage_key) return call;
  if (!file) return call;
  const copy = await persistAudioFile(call.id, file);
  return { ...call, ...copy };
}
