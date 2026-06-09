import type { EvidenceMoment } from '../types/EvidenceMoment';

export type EvidenceReviewStatus = 'pending' | 'confirmed' | 'dismissed';

export function isAiSuggested(ev: Partial<EvidenceMoment>): boolean {
  return ev.source === 'ai' || ev.source === 'ai_suggested';
}

export function getEvidenceReviewStatus(ev: Partial<EvidenceMoment>): EvidenceReviewStatus {
  if (ev.reviewer_status) return ev.reviewer_status;
  if (isAiSuggested(ev)) return 'pending';
  return 'confirmed';
}

export function hasUnreviewedAiEvidence(evidence: Partial<EvidenceMoment>[]): boolean {
  return evidence.some(
    e => isAiSuggested(e) && getEvidenceReviewStatus(e) === 'pending' && e.reviewer_status !== 'dismissed'
  );
}

export function activeEvidence(evidence: Partial<EvidenceMoment>[]): Partial<EvidenceMoment>[] {
  return evidence.filter(e => getEvidenceReviewStatus(e) !== 'dismissed');
}

export function normalizeEvidenceForImport(raw: Partial<EvidenceMoment>[]): Partial<EvidenceMoment>[] {
  return raw.map(e => ({
    ...e,
    reviewer_status: isAiSuggested(e) ? ('pending' as const) : ('confirmed' as const)
  }));
}

/** On 1-click save: keep confirmed + manual; auto-confirm pending AI rows. */
export function resolveEvidenceForSave(evidence: Partial<EvidenceMoment>[]): Partial<EvidenceMoment>[] {
  return activeEvidence(evidence).map(e => {
    if (isAiSuggested(e) && getEvidenceReviewStatus(e) === 'pending') {
      return { ...e, reviewer_status: 'confirmed' as const };
    }
    return e;
  });
}
