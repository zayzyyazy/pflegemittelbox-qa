import type { AnliegenCategory } from '../types/CallReview';
export const anliegenLabels: Record<AnliegenCategory, string> = { order_status: 'Order status', cancel_or_pause: 'Cancel / pause', box_or_product_change: 'Box / product change', address_or_account_change: 'Address / account change', authentication_problem: 'Authentication problem', other: 'Other' };
export const anliegenOrder = Object.keys(anliegenLabels) as AnliegenCategory[];
export function normalizeAnliegen(input = ''): AnliegenCategory {
  const s = input.toLowerCase();
  if (/kündig|vertrag beenden|abo beenden|pause|pausier|aussetz|unterbrech/.test(s)) return 'cancel_or_pause';
  if (/box wechsel|andere box|pflegebox|produkt wechsel|produktfrage|produkt/.test(s)) return 'box_or_product_change';
  if (/adresse|umgezogen|neue adresse|kontodaten|konto/.test(s)) return 'address_or_account_change';
  if (/paket|sendung|lieferung|bestellung|versandstatus|wo ist meine box/.test(s)) return 'order_status';
  if (/identifikation|versichertennummer|geburtsdatum|verifizierung|auth/.test(s)) return 'authentication_problem';
  return 'other';
}