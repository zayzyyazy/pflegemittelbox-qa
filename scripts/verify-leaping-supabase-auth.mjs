/**
 * Offline check: Leaping Supabase anon key resolves and is accepted by auth endpoint.
 * Run: node scripts/verify-leaping-supabase-auth.mjs
 */

const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjdWd5enRicXJyc2RkZ29scWJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTUzMzE3MDgsImV4cCI6MjAzMDkwNzcwOH0.' +
  '8YS_szj7zOBuZsZimtRNjy0sw3Rw_4ykUirM-OCV-Do';

const LOGIN_URL =
  'https://vcugyztbqrrsddgolqbz-all.supabase.co/auth/v1/token?grant_type=password';

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const json = Buffer.from(padded, 'base64').toString('utf8');
  return JSON.parse(json);
}

function isSupabaseAnonKey(key) {
  const payload = decodeJwtPayload(key);
  if (!payload) return false;
  if (payload.role === 'anon') return true;
  if (payload.role === 'authenticated' || typeof payload.sub === 'string') return false;
  return false;
}

async function main() {
  if (!isSupabaseAnonKey(ANON)) throw new Error('builtin anon key failed validation');

  const fakeAccess =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
    'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjdWd5enRicXJyc2RkZ29scWJ6Iiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJzdWIiOiIxMjM0NTY3OCIsImV4cCI6OTk5OTk5OTk5OX0.' +
    'fake-signature';
  if (isSupabaseAnonKey(fakeAccess)) throw new Error('access token should not pass as anon key');

  const res = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON,
      Authorization: `Bearer ${ANON}`
    },
    body: JSON.stringify({ email: 'test@example.com', password: 'wrong' })
  });
  const body = await res.json();
  if (body.message === 'Invalid API key') {
    throw new Error('anon key rejected by Supabase — key may be stale');
  }
  if (body.error_code !== 'invalid_credentials' && res.status !== 400) {
    throw new Error(`unexpected auth response: ${res.status} ${JSON.stringify(body)}`);
  }

  console.log('OK: Leaping Supabase anon key accepted (invalid_credentials as expected for dummy login)');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
