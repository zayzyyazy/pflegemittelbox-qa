export const nowIso = () => new Date().toISOString();
export const fmtDate = (iso?: string) => iso ? new Date(iso).toLocaleDateString() : 'Unknown';
export const fmtDateTime = (iso?: string) => iso ? new Date(iso).toLocaleString() : 'Unknown';
export const secondsToClock = (seconds?: number) => seconds == null ? 'timestamp unknown' : [Math.floor(seconds/60), Math.floor(seconds%60)].map(n => String(n).padStart(2,'0')).join(':');
export const withinDays = (iso: string, days: number) => Date.now() - new Date(iso).getTime() <= days * 86400000;