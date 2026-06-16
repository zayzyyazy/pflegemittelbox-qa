import type { Settings } from './storageService';

/** Leaping platform origin — Supabase anon key is embedded in its public JS bundles. */
export const LEAPING_PLATFORM_ORIGIN = 'https://platform.leaping.ai';

/**
 * Public Supabase anon key from Leaping platform bundle
 * (`platform.leaping.ai/_next/static/chunks/7543-*.js`, createClient call).
 * Safe to ship: identical to what every Leaping web user loads client-side.
 */
export const LEAPING_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjdWd5enRicXJyc2RkZ29scWJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTUzMzE3MDgsImV4cCI6MjAzMDkwNzcwOH0.' +
  '8YS_szj7zOBuZsZimtRNjy0sw3Rw_4ykUirM-OCV-Do';

export const LEAPING_SUPABASE_LOGIN_URL =
  'https://vcugyztbqrrsddgolqbz-all.supabase.co/auth/v1/token?grant_type=password';

export type SupabaseAnonKeySource = 'settings' | 'builtin' | 'discovered';

export interface ResolvedSupabaseAnonKey {
  anonKey: string;
  source: SupabaseAnonKeySource;
  settingsPatch?: Partial<Settings>;
}

const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const PUBLISHABLE_RE = /^sb_publishable_[A-Za-z0-9_-]+$/;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded.padEnd(padded.length + (4 - (padded.length % 4)) % 4, '='));
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** True when the value is a Supabase anon/publishable key — not a user access token. */
export function isSupabaseAnonKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  if (PUBLISHABLE_RE.test(trimmed)) return true;
  if (!JWT_RE.test(trimmed)) return false;

  const payload = decodeJwtPayload(trimmed);
  if (!payload) return false;
  if (payload.role === 'anon') return true;
  // Reject access tokens accidentally pasted as anon key.
  if (payload.role === 'authenticated' || typeof payload.sub === 'string') return false;
  return false;
}

export function supabaseProjectRefFromUrl(url: string): string | null {
  const match = url.match(/https:\/\/([a-z0-9]+)(?:-all)?\.supabase\.co/i);
  return match ? match[1].toLowerCase() : null;
}

export function extractAnonKeyFromJs(source: string, projectRef?: string | null): string | null {
  if (projectRef) {
    const scoped = new RegExp(
      `https:\\/\\/${projectRef}(?:-all)?\\.supabase\\.co["'\`],["'\`](eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+)`,
      'i'
    );
    const hit = source.match(scoped);
    if (hit?.[1] && isSupabaseAnonKey(hit[1])) return hit[1];
  }

  const generic = /https:\/\/[a-z0-9]+(?:-all)?\.supabase\.co["'`,](eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = generic.exec(source)) !== null) {
    if (match[1] && isSupabaseAnonKey(match[1])) return match[1];
  }
  return null;
}

let discoveryCache: { projectRef: string; anonKey: string; fetchedAt: number } | null = null;
const DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;

export async function discoverSupabaseAnonKey(loginUrl: string): Promise<string | null> {
  const projectRef = supabaseProjectRefFromUrl(loginUrl);
  if (!projectRef) return null;

  if (
    discoveryCache &&
    discoveryCache.projectRef === projectRef &&
    Date.now() - discoveryCache.fetchedAt < DISCOVERY_TTL_MS
  ) {
    return discoveryCache.anonKey;
  }

  if (projectRef === 'vcugyztbqrrsddgolqbz') {
    discoveryCache = { projectRef, anonKey: LEAPING_SUPABASE_ANON_KEY, fetchedAt: Date.now() };
    return LEAPING_SUPABASE_ANON_KEY;
  }

  try {
    const indexRes = await fetch(`${LEAPING_PLATFORM_ORIGIN}/`, { headers: { Accept: 'text/html' } });
    if (!indexRes.ok) return null;
    const html = await indexRes.text();
    const fromHtml = extractAnonKeyFromJs(html, projectRef);
    if (fromHtml) {
      discoveryCache = { projectRef, anonKey: fromHtml, fetchedAt: Date.now() };
      return fromHtml;
    }

    const chunkPaths = [...html.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)]
      .map(m => m[0])
      .slice(0, 40);

    for (const chunkPath of chunkPaths) {
      try {
        const chunkRes = await fetch(`${LEAPING_PLATFORM_ORIGIN}${chunkPath}`);
        if (!chunkRes.ok) continue;
        const js = await chunkRes.text();
        if (!js.includes(projectRef) && !js.includes('supabase.co')) continue;
        const key = extractAnonKeyFromJs(js, projectRef);
        if (key) {
          discoveryCache = { projectRef, anonKey: key, fetchedAt: Date.now() };
          console.info('[leaping-auth] discovered Supabase anon key from Leaping platform bundle', {
            projectRef,
            chunkPath
          });
          return key;
        }
      } catch {
        // try next chunk
      }
    }
  } catch (err) {
    console.warn('[leaping-auth] anon key discovery failed', {
      error: err instanceof Error ? err.message : String(err)
    });
  }

  return null;
}

export async function resolveSupabaseAnonKey(settings: Settings): Promise<ResolvedSupabaseAnonKey> {
  const loginUrl = (settings.leapingLoginUrl || LEAPING_SUPABASE_LOGIN_URL).trim();
  const stored = (settings.leapingSupabaseAnonKey || '').trim();

  if (stored && isSupabaseAnonKey(stored)) {
    return { anonKey: stored, source: 'settings' };
  }

  if (stored && !isSupabaseAnonKey(stored)) {
    console.warn('[leaping-auth] stored Supabase key looks like an access token, not anon — replacing');
  }

  const projectRef = supabaseProjectRefFromUrl(loginUrl);
  if (projectRef === 'vcugyztbqrrsddgolqbz') {
    return {
      anonKey: LEAPING_SUPABASE_ANON_KEY,
      source: 'builtin',
      settingsPatch: { leapingSupabaseAnonKey: LEAPING_SUPABASE_ANON_KEY }
    };
  }

  const discovered = await discoverSupabaseAnonKey(loginUrl);
  if (discovered) {
    return {
      anonKey: discovered,
      source: 'discovered',
      settingsPatch: { leapingSupabaseAnonKey: discovered }
    };
  }

  throw new Error(
    'Could not resolve Supabase anon API key.\n' +
    'Paste the anon key once in Settings → Leaping API (from Supabase dashboard or Leaping platform network tab).'
  );
}

export function maskSecret(value: string): string {
  const v = value.trim();
  if (v.length <= 12) return '***';
  return `${v.slice(0, 6)}…${v.slice(-4)}`;
}

export function maskAuthHeaders(headers: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (/apikey|authorization/i.test(key)) masked[key] = maskSecret(value);
    else masked[key] = value;
  }
  return masked;
}

export function summarizeAuthResponse(json: unknown): Record<string, unknown> {
  const obj = json && typeof json === 'object' && !Array.isArray(json) ? json as Record<string, unknown> : {};
  return {
    token_type: obj.token_type,
    expires_in: obj.expires_in,
    has_access_token: typeof obj.access_token === 'string',
    has_refresh_token: typeof obj.refresh_token === 'string',
    has_user: !!obj.user,
    error: obj.error || obj.msg || obj.message
  };
}
