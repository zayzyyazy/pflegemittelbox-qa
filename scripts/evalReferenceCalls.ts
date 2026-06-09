/**
 * Eval reference calls — run: npm run eval:reference
 * Uses transcript fixtures; live WAV transcription optional via OPENAI_API_KEY.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeCallContext,
  parseTranscriptTurns
} from '../src/analysis/callUnderstanding';
import { detectHeuristicEvidence, mergeEvidenceLists } from '../src/utils/transcriptHeuristics';
import { mapAiEvidenceRow, sanitizeEvidenceMoments } from '../src/utils/callAnalysis';
import { normalizeEvidenceForImport } from '../src/utils/evidenceReview';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = join(root, 'fixtures/reference-calls');

type Expected = {
  call_id: string;
  expected_anliegen?: string;
  expected_result?: string;
  min_evidence?: number;
  max_evidence?: number;
  notes?: string;
};

function loadExpected(): Expected[] {
  const path = join(fixturesDir, 'expected.json');
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, 'utf8')) as Expected[];
}

function loadTranscript(callId: string): string | null {
  const path = join(fixturesDir, `${callId}.transcript.txt`);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

function evalTranscript(callId: string, transcript: string) {
  const segments = parseTranscriptTurns(transcript);
  const understanding = analyzeCallContext(transcript, segments);
  const heuristics = detectHeuristicEvidence(transcript, callId, segments, understanding);
  const aiRows = sanitizeEvidenceMoments([], transcript, understanding, 5).map(r =>
    mapAiEvidenceRow(r as Record<string, unknown>)
  );
  const merged = normalizeEvidenceForImport(mergeEvidenceLists(aiRows, heuristics, 5));
  return {
    call_id: callId,
    anliegen: understanding.anliegen,
    result: understanding.solved_status,
    evidence_count: merged.length
  };
}

function main() {
  const expected = loadExpected();
  if (!expected.length) {
    console.error('No fixtures/reference-calls/expected.json — add human labels.');
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  for (const row of expected) {
    const transcript = loadTranscript(row.call_id);
    if (!transcript) {
      console.warn(`SKIP ${row.call_id}: no transcript fixture`);
      continue;
    }
    const result = evalTranscript(row.call_id, transcript);
    const min = row.min_evidence ?? 0;
    const max = row.max_evidence ?? 5;
    const countOk = result.evidence_count >= min && result.evidence_count <= max;
    const anliegenOk = !row.expected_anliegen || result.anliegen === row.expected_anliegen;
    const resultOk = !row.expected_result || result.result === row.expected_result;
    const ok = countOk && anliegenOk && resultOk;
    const status = ok ? 'PASS' : 'FAIL';
    if (ok) passed++;
    else failed++;
    console.log(
      `${status} ${row.call_id} anliegen=${result.anliegen} result=${result.result} evidence=${result.evidence_count}` +
        (row.notes ? ` — ${row.notes}` : '')
    );
    if (!anliegenOk) console.log(`  expected anliegen=${row.expected_anliegen}`);
    if (!resultOk) console.log(`  expected result=${row.expected_result}`);
    if (!countOk) console.log(`  expected evidence ${min}-${max}`);
  }

  console.log(`\n${passed} passed, ${failed} failed (${expected.length} fixtures)`);
  if (failed > 0) process.exit(1);
}

main();
