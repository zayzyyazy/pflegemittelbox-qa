import type { AnliegenCategory } from '../types/CallReview';
import { inferCallerRequestDeterministic } from './intentSafeguards';

export const callerRequestLabels: Record<AnliegenCategory, string> = {
  box_or_product_change: 'Box / product change',
  order_status: 'Order status',
  cancel_or_pause: 'Cancel / pause',
  address_or_account_change: 'Address / account change',
  authentication_problem: 'Authentication problem',
  new_customer_onboarding: 'New customer / onboarding',
  general_information_question: 'General information question',
  other: 'Other'
};

/** @deprecated */
export const anliegenLabels = callerRequestLabels;

export type CallerRequestTone = 'yellow' | 'blue' | 'amber' | 'purple' | 'teal' | 'slate';

export const anliegenOrder = Object.keys(callerRequestLabels) as AnliegenCategory[];

export const callerRequestTone: Record<AnliegenCategory, CallerRequestTone> = {
  box_or_product_change: 'yellow',
  order_status: 'blue',
  cancel_or_pause: 'amber',
  address_or_account_change: 'purple',
  authentication_problem: 'teal',
  new_customer_onboarding: 'teal',
  general_information_question: 'slate',
  other: 'slate'
};

const LEGACY_MAP: Record<string, AnliegenCategory> = {
  box_change: 'box_or_product_change',
  product_change: 'box_or_product_change',
  delivery_issue: 'order_status',
  delivery_problem: 'order_status',
  cancel: 'cancel_or_pause',
  cancel_pause: 'cancel_or_pause',
  pause: 'cancel_or_pause',
  address_change: 'address_or_account_change',
  account_change: 'address_or_account_change',
  account_contact_change: 'address_or_account_change',
  authentication_help: 'authentication_problem',
  general_information: 'general_information_question',
  new_customer_general: 'new_customer_onboarding',
  new_customer: 'new_customer_onboarding',
  billing_invoice: 'general_information_question',
  billing_question: 'general_information_question',
  speak_to_human: 'general_information_question'
};

/** @deprecated use inferCallerRequestDeterministic */
export function inferCallerRequestFromOpening(text: string): AnliegenCategory | null {
  return inferCallerRequestDeterministic(text);
}

export function normalizeAnliegen(input = ''): AnliegenCategory {
  return inferCallerRequestDeterministic(input) || 'other';
}

export function migrateAnliegenCategory(value?: string): AnliegenCategory {
  if (!value) return 'other';
  if (value in callerRequestLabels) return value as AnliegenCategory;
  if (value in LEGACY_MAP) return LEGACY_MAP[value];
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (slug in callerRequestLabels) return slug as AnliegenCategory;
  if (slug in LEGACY_MAP) return LEGACY_MAP[slug];
  const label = Object.entries(callerRequestLabels).find(([, l]) => l.toLowerCase() === value.toLowerCase());
  if (label) return label[0] as AnliegenCategory;
  return 'other';
}
