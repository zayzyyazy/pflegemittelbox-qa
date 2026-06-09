import { analyzeAudioAcoustics, decodeAudioDuration } from '../agents/acousticEngine';
import { listenToCallAudio } from '../agents/audioListener';
import { detectTimingSignalsFromSegments } from '../agents/signalEngine';
import type { Settings } from './storageService';
import type { CallReview, TranscriptSegment } from '../types/CallReview';
import type { EvidenceMoment, EvidenceMomentType } from '../types/EvidenceMoment';
import type { AcousticEvent, AudioListenerFinding, TimingSignal } from '../types/AudioAnalysis';
import { ANALYSIS_VERSION } from '../types/AudioAnalysis';
import { selectClipWindows } from '../utils/clipExtract';
import { extractEntitiesFromTranscript } from '../utils/entityExtract';
import { buildPrimaryFriction } from '../utils/friction';
import { deriveMainIssue } from '../utils/issueLabels';
import { acousticNotes, shouldRunAudioListener, transcriptSignals } from '../utils/suspicionDetect';
import { syncCallFlagsFromEvidence } from '../utils/callAnalysis';
import { generateCallDraft, transcribeAudioDetailed } from './openaiService';
import { loadFileFromStoredAudio } from './audioStorageService';
import { id } from '../utils/text';
import { nowIso } from '../utils/dates';
import { normalizeMomentType } from '../utils/transcriptHeuristics';

export interface AnalyzeCallInput {
  settings: Settings;
  transcript: string;
  transcriptSegments?: TranscriptSegment[];
  audioFile?: File | null;
  reviewerContext?: string;
  existingCall?: CallReview;
  existingCallId?: string;
  workspace?: CallReview['workspace'];
  botVersion?: CallReview['bot_version'];
  signal?: AbortSignal;
  onStep?: (step: string) => void;
}

export interface AnalyzeCallResult {
  call: Partial<CallReview>;
  evidence: EvidenceMoment[];
  bot_outputs: {
    entities?: ReturnType<typeof extractEntitiesFromTranscript>;
    acoustic_events?: AcousticEvent[];
    timing_signals?: TimingSignal[];
    audio_findings?: AudioListenerFinding[];
    listened?: boolean;
  };
}

function mapIssueType(issueType: string): EvidenceMomentType {
  const key = issueType.toLowerCase().replace(/\s+/g, '_');
  const map: Record<string, EvidenceMomentType> = {
    caller_cut_off: 'caller_cut_off',
    long_pause: 'long_pause',
    repeated_authentication: 'repeated_authentication',
    authentication_friction: 'repeated_authentication',
    robotic_pacing: 'robotic_pacing',
    wrong_workflow: 'wrong_workflow',
    missing_integration: 'missing_integration',
    escalation: 'escalation',
    repeated_question: 'repeated_question'
  };
  return map[key] || normalizeMomentType(key);
}

function evidenceFromAudioFindings(callId: string, findings: AudioListenerFinding[], now: string): EvidenceMoment[] {
  return findings.map(f => ({
    id: id('ev'),
    call_id: callId,
    speaker: 'unknown' as const,
    moment_type: mapIssueType(f.issue_type),
    severity: f.severity === 'high' || f.severity === 'low' ? f.severity : 'medium',
    timestamp_start_seconds: Number(f.start_seconds || 0),
    timestamp_end_seconds: Number(f.end_seconds || 0),
    quote_or_transcript_excerpt: f.heard.slice(0, 280),
    explanation: 'Detected by listening to call audio (not transcript alone).',
    recommended_fix: '',
    voice_cue_notes: f.heard,
    confidence: f.confidence >= 0.7 ? 'high' : f.confidence >= 0.4 ? 'medium' : 'low',
    source: 'audio_listener' as const,
    reviewer_status: 'pending' as const,
    created_at: now,
    updated_at: now
  }));
}

function evidenceFromAcoustic(callId: string, acoustic: AcousticEvent[], now: string): EvidenceMoment[] {
  const topGaps = [...acoustic]
    .filter(e => e.end_ms - e.start_ms >= 8000)
    .sort((a, b) => b.end_ms - b.start_ms - (a.end_ms - a.start_ms))
    .slice(0, 3);

  return topGaps.map(e => ({
    id: id('ev'),
    call_id: callId,
    speaker: 'unknown' as const,
    moment_type: 'long_pause' as const,
    severity: 'high' as const,
    timestamp_start_seconds: Math.round(e.start_ms / 1000),
    timestamp_end_seconds: Math.round(e.end_ms / 1000),
    quote_or_transcript_excerpt: e.description.slice(0, 280),
    explanation: 'Local waveform analysis detected dead air.',
    recommended_fix: 'Review endpointing and hold messaging.',
    voice_cue_notes: e.description,
    source: 'ai_suggested' as const,
    reviewer_status: 'pending' as const,
    created_at: now,
    updated_at: now
  }));
}

function mergeEvidence(primary: EvidenceMoment[], extra: EvidenceMoment[]): EvidenceMoment[] {
  const merged = [...primary];
  for (const item of extra) {
    const dup = merged.some(
      e =>
        e.moment_type === item.moment_type &&
        Math.abs((e.timestamp_start_seconds || 0) - (item.timestamp_start_seconds || 0)) <
          (item.moment_type === 'long_pause' ? 8 : 3)
    );
    if (!dup) merged.push(item);
  }
  return merged.slice(0, 5);
}

export const analysisOrchestrator = {
  async analyzeCall(input: AnalyzeCallInput): Promise<AnalyzeCallResult> {
    const transcript = input.transcript.trim();
    if (!transcript) throw new Error('Transcript is required for analysis.');
    const now = nowIso();
    const callId = input.existingCallId || input.existingCall?.id || id('call');

    input.onStep?.('Listening locally');
    const entities = extractEntitiesFromTranscript(transcript);
    const txSignals = transcriptSignals(transcript, input.transcriptSegments);

    let acoustic: AcousticEvent[] = [];
    let timing: TimingSignal[] = detectTimingSignalsFromSegments(input.transcriptSegments);
    let durationSeconds = input.existingCall?.duration_seconds || 0;

    if (input.audioFile) {
      try {
        if (!durationSeconds) {
          durationSeconds = await decodeAudioDuration(input.audioFile);
        }
      } catch {
        // duration fallback below
      }
      try {
        acoustic = await analyzeAudioAcoustics(input.audioFile);
      } catch {
        acoustic = [];
      }
    }

    let audioFindings: AudioListenerFinding[] = [];
    let listened = false;
    const lastSegment = input.transcriptSegments?.[input.transcriptSegments.length - 1];
    const lastAcoustic = acoustic[acoustic.length - 1];
    if (!durationSeconds) {
      durationSeconds =
        lastSegment?.end || (lastAcoustic?.end_ms ? lastAcoustic.end_ms / 1000 : 0);
    }

    const draftStub: Partial<CallReview> = {
      ...input.existingCall,
      solved_status: input.existingCall?.solved_status,
      caller_cut_off: input.existingCall?.caller_cut_off,
      awkward_pauses: acoustic.length > 0 || input.existingCall?.awkward_pauses,
      identification_problem: input.existingCall?.identification_problem,
      repeated_question: input.existingCall?.repeated_question
    };

    if (
      input.audioFile &&
      shouldRunAudioListener(input.settings, draftStub, transcript, acoustic, timing, durationSeconds)
    ) {
      input.onStep?.('AI audio check');
      listened = true;
      const fullCall =
        durationSeconds > 0 &&
        durationSeconds <= (input.settings.alwaysListenFullCallUnderSeconds ?? 180);
      const windows = fullCall
        ? []
        : selectClipWindows(
            durationSeconds,
            acoustic,
            timing,
            input.settings.maxAudioClipsPerCall ?? 2,
            input.settings.maxClipSeconds ?? 30
          );
      try {
        audioFindings = await listenToCallAudio(input.settings, input.audioFile, {
          transcript,
          windows,
          fullCall,
          signal: input.signal
        });
      } catch {
        audioFindings = [];
      }
    }

    input.onStep?.('Analyzing');
    const acousticContext = [...acousticNotes(acoustic, timing), ...txSignals].join('\n');
    const { call: draft, evidence: textEvidence } = await generateCallDraft(input.settings, {
      transcript,
      transcriptSegments: input.transcriptSegments,
      file: input.audioFile
        ? {
            name: input.audioFile.name,
            size: input.audioFile.size,
            type: input.audioFile.type,
            lastModified: input.audioFile.lastModified
          }
        : undefined,
      reviewerContext: [input.reviewerContext, acousticContext ? `Audio/local signals:\n${acousticContext}` : '']
        .filter(Boolean)
        .join('\n\n'),
      existingCall: input.existingCall,
      existingCallId: callId,
      analysisSettings: input.settings,
      workspace: input.workspace || input.existingCall?.workspace,
      botVersion: input.botVersion || input.existingCall?.bot_version
    });

    const audioEvidence = [
      ...evidenceFromAcoustic(callId, acoustic, now),
      ...evidenceFromAudioFindings(callId, audioFindings, now)
    ];
    const evidence = mergeEvidence(textEvidence, audioEvidence);

    const enrichedCall: Partial<CallReview> = {
      ...syncCallFlagsFromEvidence({ ...draft, ...entities }, evidence),
      customer_name: entities.customer_name || input.existingCall?.customer_name,
      vnr: entities.vnr || input.existingCall?.vnr,
      phone: entities.phone || input.existingCall?.phone,
      duration_seconds: durationSeconds || draft.duration_seconds || input.existingCall?.duration_seconds,
      analysis_version: ANALYSIS_VERSION,
      awkward_pauses: draft.awkward_pauses || acoustic.some(e => e.type === 'silence_gap'),
      primary_friction: buildPrimaryFriction({ ...draft, ...entities }, evidence, acoustic),
      primary_issue_label:
        deriveMainIssue({ ...draft, ...entities }, evidence) || draft.primary_issue_label
    };

    return {
      call: enrichedCall,
      evidence,
      bot_outputs: {
        entities,
        acoustic_events: acoustic,
        timing_signals: timing,
        audio_findings: audioFindings,
        listened
      }
    };
  },

  async reanalyzeCall(
    settings: Settings,
    call: CallReview,
    manualEvidence: EvidenceMoment[] = []
  ) {
    let transcript = call.transcript || '';
    let transcriptSegments = call.transcript_segments;
    let audioFile: File | undefined;

    const stored = await loadFileFromStoredAudio(call);
    if (stored) {
      audioFile = stored;
      const transcribed = await transcribeAudioDetailed(settings, stored);
      transcript = transcribed.text;
      transcriptSegments = transcribed.segments;
    } else if (!transcript.trim()) {
      throw new Error('No transcript or stored audio to analyze.');
    }

    const { call: draft, evidence: newAiEvidence } = await analysisOrchestrator.analyzeCall({
      settings,
      transcript,
      transcriptSegments,
      audioFile: audioFile || null,
      reviewerContext: call.caller_context || call.original_intent_summary,
      existingCall: call,
      existingCallId: call.id
    });

    const merged = {
      ...call,
      ...draft,
      id: call.id,
      call_id: call.call_id,
      created_at: call.created_at,
      audio_file_name: call.audio_file_name,
      audio_file_size: call.audio_file_size,
      audio_file_type: call.audio_file_type,
      audio_file_last_modified: call.audio_file_last_modified,
      audio_local_path: call.audio_local_path,
      audio_original_path: call.audio_original_path,
      audio_storage_key: call.audio_storage_key,
      linked_issue_ids: call.linked_issue_ids,
      transcript: draft.transcript || transcript,
      transcript_segments: draft.transcript_segments || transcriptSegments,
      duration_seconds: draft.duration_seconds || call.duration_seconds
    } as CallReview;

    const aiOnly = newAiEvidence.filter(
      e => e.source === 'ai' || e.source === 'ai_suggested' || e.source === 'audio_listener'
    );
    return { call: merged, evidence: [...manualEvidence, ...aiOnly] };
  }
};
