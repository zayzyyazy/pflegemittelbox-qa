import type { CallReview } from '../types/CallReview';

export const id = (prefix='id') => prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
export const clamp = (text = '', max = 120) => text.length > max ? text.slice(0, max - 1).trim() + '...' : text;
export const shortCallId = (callId: string) => callId.length > 12 ? callId.slice(0, 8) + '...' : callId;

/** Match saved calls by full or partial id / call_id (notes often store shortened ids). */
export function resolveCallByReference(calls: CallReview[], ref?: string): CallReview | undefined {
  const raw = ref?.trim().toLowerCase();
  if (!raw) return undefined;
  const key = raw.replace(/\.\.\.$/, '').replace(/[^a-z0-9_-]/g, '');
  if (!key) return undefined;

  const exact = calls.find(c => c.id.toLowerCase() === raw || c.call_id.toLowerCase() === raw);
  if (exact) return exact;

  return calls.find(c => {
    const id = c.id.toLowerCase();
    const callId = c.call_id.toLowerCase();
    return (
      id.startsWith(key) ||
      callId.startsWith(key) ||
      key.startsWith(id.slice(0, Math.min(key.length, id.length))) ||
      key.startsWith(callId.slice(0, Math.min(key.length, callId.length)))
    );
  });
}
export const cleanCallIdFromFilename = (name: string) => name.replace(/.(wav|mp3|m4a|webm|ogg)$/i, '').replace(/-call-recording.*$/i, '').replace(/[_ ]+$/,'');
export const similarity = (a='', b='') => { const aw = new Set(a.toLowerCase().split(/W+/).filter(Boolean)); const bw = new Set(b.toLowerCase().split(/W+/).filter(Boolean)); if (!aw.size || !bw.size) return 0; let hit = 0; aw.forEach(w => { if (bw.has(w)) hit++; }); return hit / Math.max(aw.size, bw.size); };
export const downloadText = (name: string, text: string) => { const blob = new Blob([text], { type: 'text/markdown' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); };