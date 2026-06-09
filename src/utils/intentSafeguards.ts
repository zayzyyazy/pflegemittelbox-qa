import type { AnliegenCategory } from '../types/CallReview';
import { migrateAnliegenCategory } from './anliegen';

function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function openingSlice(originalIntent: string, transcript: string) {
  const callerLines = transcript
    .split(/\n+/)
    .filter(l => /^caller:/i.test(l.trim()))
    .slice(0, 8)
    .join(' ');
  const firstChunk = transcript.slice(0, 2000);
  return norm([originalIntent, callerLines, firstChunk].filter(Boolean).join(' '));
}

const CANCEL =
  /kündigen|kuendigen|kündigung|kuendigung|abbestellen|nicht mehr bekommen|stoppen|pausieren|\bpause\b|aussetzen|vorübergehend nicht|voruebergehend nicht|vertrag beenden/;
const BOX =
  /pflegebox|box ändern|box aendern|box anpassen|inhalt ändern|inhalt aendern|produkte ändern|produkte tauschen|anpassen|handschuhe|desinfektion|waschlotion|bettschutzeinlagen|mundschutz|flächendesinfektion|flaechendesinfektion|hygienetücher|hygienetuecher|waschhandschuh/;
const ORDER =
  /wo bleibt|wann kommt|lieferung|paket|bestellung|versand|status|angekommen|nicht erhalten|sendung|tracking/;
const ADDRESS = /adresse|anschrift|e-mail|email|telefonnummer|kontaktdaten|daten ändern|daten aendern|umzug/;
const NEWCUST = /neukunde|neu kunde|erstmalig|beantragen|neu anmelden|werde kunde/;
const GENERAL = /welche produkte|was ist enthalten|allgemeine frage|beratung|was bieten sie/;
const AUTH_ONLY =
  /versicherungsnummer.*(habe ich nicht|nicht dabei|weiß ich nicht|weiss ich nicht)|kann mich nicht identifizieren|identifikation.*(klappt nicht|funktioniert nicht)/;

/** Priority-ordered deterministic intent from opening text. */
export function inferCallerRequestDeterministic(text: string): AnliegenCategory | null {
  const s = norm(text);
  if (!s) return null;

  if (CANCEL.test(s)) return 'cancel_or_pause';
  if (BOX.test(s)) return 'box_or_product_change';
  if (ORDER.test(s) && !CANCEL.test(s) && !BOX.test(s)) return 'order_status';
  if (ADDRESS.test(s)) return 'address_or_account_change';
  if (NEWCUST.test(s)) return 'new_customer_onboarding';
  if (GENERAL.test(s)) return 'general_information_question';
  if (AUTH_ONLY.test(s) && !BOX.test(s) && !CANCEL.test(s) && !ORDER.test(s)) {
    return 'authentication_problem';
  }
  return null;
}

/** Block mislabels: cancel/box must not become order_status or other. */
export function applyIntentSafeguards(
  aiValue: unknown,
  originalIntentSummary: string,
  transcript: string
): AnliegenCategory {
  const opening = openingSlice(originalIntentSummary, transcript);
  const fromAi = migrateAnliegenCategory(String(aiValue || ''));
  const deterministic = inferCallerRequestDeterministic(opening);

  if (deterministic) return deterministic;

  if (fromAi !== 'other') return fromAi;

  const fromSummary = inferCallerRequestDeterministic(norm(originalIntentSummary));
  return fromSummary || 'other';
}
