/**
 * Run: npx vite-node src/analysis/runScenarios.ts
 */
import {
  analyzeCallContext,
  detectRepeatedAuthentication,
  filterEvidenceList,
  parseTranscriptTurns
} from './callUnderstanding';
import { detectHeuristicEvidence, mergeEvidenceLists } from '../utils/transcriptHeuristics';
import { mapAiEvidenceRow, sanitizeEvidenceMoments } from '../utils/callAnalysis';

const SCENARIOS: { name: string; transcript: string; segments?: { start: number; end: number; text: string; speaker: 'caller' | 'agent' }[] }[] = [
  {
    name: '1. Successful cancellation',
    transcript: `Agent: Guten Tag, wie kann ich helfen?
Caller: Ich möchte die Pflegebox für meine Mutter kündigen.
Agent: Gerne. Bitte nennen Sie die Versicherungsnummer.
Caller: A123456789
Agent: Danke. Und das Geburtsdatum?
Caller: 31.01.1934
Agent: Ich habe die Kündigung für Sie vorgenommen. Sie erhalten eine Bestätigung.
Caller: Danke, auf Wiederhören.`
  },
  {
    name: '2. Successful order status',
    transcript: `Agent: Guten Tag.
Caller: Wo bleibt meine Lieferung? Wann kommt das Paket?
Agent: Bitte die Versicherungsnummer.
Caller: B987654321
Agent: Geburtsdatum bitte.
Caller: 15.03.1940
Agent: Ihre Sendung ist unterwegs und kommt voraussichtlich am Donnerstag.
Caller: Super, danke.`
  },
  {
    name: '3. Successful authentication flow',
    transcript: `Agent: Willkommen.
Caller: Ich möchte Handschuhe in der Box ändern.
Agent: Versicherungsnummer bitte.
Caller: C111222333
Agent: Geburtsdatum?
Caller: 01.05.1955
Agent: Die Änderung wurde vorgenommen.
Caller: Danke.`
  },
  {
    name: '4. Transfer / escalation',
    transcript: `Agent: Guten Tag.
Caller: Ich möchte kündigen.
Agent: Versicherungsnummer?
Caller: D444555666
Agent: Geburtsdatum?
Caller: 20.07.1948
Agent: Das kann ich nicht selbst bearbeiten. Ich leite Sie an einen Kollegen weiter. Ein Kollege übernimmt und meldet sich bei Ihnen.
Caller: Okay.`
  },
  {
    name: '5. Repeated auth failure',
    transcript: `Agent: Versicherungsnummer bitte.
Caller: E777888999
Agent: Geburtsdatum bitte.
Caller: 12.12.1950
Agent: Bitte nennen Sie noch einmal Ihr Geburtsdatum.
Caller: Ich habe es gerade gesagt, 12.12.1950
Agent: Entschuldigung, ich habe es nicht verstanden.`
  },
  {
    name: '6. Dead air call',
    transcript: `Agent: Einen Moment, ich schaue nach.
Caller: Hallo? Sind Sie noch da?
Agent: Hmm, sind Sie noch da?`,
    segments: [
      { start: 0, end: 2, text: 'Einen Moment, ich schaue nach.', speaker: 'agent' },
      { start: 22, end: 24, text: 'Hallo? Sind Sie noch da?', speaker: 'caller' },
      { start: 25, end: 27, text: 'Hmm, sind Sie noch da?', speaker: 'agent' }
    ]
  }
];

function run() {
  console.log('=== Analysis scenario tests ===\n');
  for (const s of SCENARIOS) {
    const understanding = analyzeCallContext(s.transcript, s.segments);
    const turns = parseTranscriptTurns(s.transcript, s.segments);
    const repeated = detectRepeatedAuthentication(turns);

    const fakeAi = [
      {
        moment_type: 'escalation',
        transcript_excerpt: 'Versicherungsnummer bitte',
        why_it_matters: 'bad',
        confidence: 'medium'
      },
      {
        moment_type: 'repeated_authentication',
        transcript_excerpt: 'Geburtsdatum bitte',
        why_it_matters: 'bad',
        confidence: 'medium'
      }
    ].map(r => mapAiEvidenceRow(r as Record<string, unknown>));

    const heuristic = detectHeuristicEvidence(s.transcript, 'test-call', s.segments, understanding);
    const merged = mergeEvidenceLists(fakeAi, heuristic, 3);
    const evidence = sanitizeEvidenceMoments(merged, s.transcript, understanding, 3);
    const heuristicOnly = sanitizeEvidenceMoments(
      detectHeuristicEvidence(s.transcript, 'test-call', s.segments, understanding),
      s.transcript,
      understanding,
      3
    );

    console.log(`--- ${s.name} ---`);
    console.log(`Intent (Anliegen): ${understanding.anliegen}`);
    console.log(
      `Result: ${understanding.solved_status} (completed=${understanding.request_completed}, escalation=${understanding.human_transfer_explicit})`
    );
    console.log(`Auth normal: ${understanding.authentication_normal}, repeated auth: ${repeated}`);
    console.log(`Evidence count: ${evidence.length} (heuristic-only: ${heuristicOnly.length})`);
    for (const e of evidence) {
      console.log(`  - [${e.moment_type}] ${e.quote_or_transcript_excerpt?.slice(0, 80)}`);
      console.log(`    why: ${e.explanation?.slice(0, 100)}`);
    }
    if (!evidence.length) console.log('  (no evidence — expected for normal success)');
    console.log('');
  }
}

run();
