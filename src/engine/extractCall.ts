import type { TranscriptSegment } from '../types/CallReview';
import type { EvidenceMoment } from '../types/EvidenceMoment';
import {
  buildCallUnderstanding,
  mapAiEvidenceRow,
  sanitizeEvidenceMoments
} from '../utils/callAnalysis';
import { detectHeuristicEvidence, mergeEvidenceLists } from '../utils/transcriptHeuristics';
import type { Settings } from '../services/storageService';
import { defaultSettings } from '../services/storageService';

export const RECALL_MAX_EVIDENCE = 5;

function recallCap(settings: Settings): number {
  let n = settings.evidenceSensitivity === 'low' ? 3 : settings.evidenceSensitivity === 'high' ? 5 : 4;
  if (settings.analysisStrictness === 'strict') n = Math.min(n, 3);
  if (settings.analysisStrictness === 'lenient') n = Math.min(n + 1, RECALL_MAX_EVIDENCE);
  return Math.min(n, RECALL_MAX_EVIDENCE);
}

/** Recall-first extraction: merge AI rows with contextual heuristics (max 5). */
export function extractCallEvidence(
  transcript: string,
  segments: TranscriptSegment[] | undefined,
  aiOut: Record<string, unknown>,
  callId: string,
  settings?: Settings
): Partial<EvidenceMoment>[] {
  const s = settings || defaultSettings;
  const understanding = buildCallUnderstanding(transcript, segments, aiOut);
  const aiRows = ((aiOut.evidence_moments as Record<string, unknown>[]) || []).map(mapAiEvidenceRow);

  const heuristic = detectHeuristicEvidence(transcript, callId, segments, understanding).map(h => ({
    ...h,
    source: 'ai_suggested' as const
  }));

  const merged = mergeEvidenceLists(aiRows, heuristic, RECALL_MAX_EVIDENCE);
  return sanitizeEvidenceMoments(merged, transcript, understanding, recallCap(s));
}

export { buildCallFromAiOutput } from '../services/openaiService';
