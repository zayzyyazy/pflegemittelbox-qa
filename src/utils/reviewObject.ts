import type { CallReview } from '../types/CallReview';
import type { EvidenceMoment } from '../types/EvidenceMoment';
import type {
  AgentReviewSection,
  AudioBehavioralSignalsOutput,
  ConversationUnderstandingOutput,
  CustomerExperienceOutput,
  QaProcessComplianceOutput,
  ReviewActionItem,
  ReviewCandidateFinding,
  ReviewFindingConfidence,
  ReviewFindingDimension,
  ReviewFindingStatus,
  ReviewObject
} from '../types/ReviewObject';
import type { AcousticEvent, AudioListenerFinding, TimingSignal } from '../types/AudioAnalysis';
import { nowIso } from './dates';
import { id } from './text';

type ReviewObjectInput = {
  call: Partial<CallReview>;
  evidence?: Partial<EvidenceMoment>[];
  acousticEvents?: AcousticEvent[];
  timingSignals?: TimingSignal[];
  audioFindings?: AudioListenerFinding[];
  listenedToAudio?: boolean;
};

function confidenceFromEvidence(ev: Partial<EvidenceMoment>): ReviewFindingConfidence {
  return ev.confidence || (ev.source === 'manual' || ev.reviewer_status === 'confirmed' ? 'high' : 'medium');
}

function statusFromEvidence(ev: Partial<EvidenceMoment>): ReviewFindingStatus {
  if (ev.reviewer_status === 'dismissed') return 'dismissed';
  if (ev.reviewer_status === 'confirmed' || ev.source === 'manual') return 'verified';
  return 'candidate';
}

function dimensionFromEvidence(ev: Partial<EvidenceMoment>): ReviewFindingDimension {
  if (ev.source === 'audio_listener' || ev.moment_type === 'long_pause' || ev.moment_type === 'robotic_pacing') {
    return 'audio_behavior';
  }
  if (
    ev.moment_type === 'repeated_authentication' ||
    ev.moment_type === 'missing_alternative_verification' ||
    ev.moment_type === 'wrong_workflow' ||
    ev.moment_type === 'missing_integration' ||
    ev.moment_type === 'missing_function_call' ||
    ev.moment_type === 'function_argument_mismatch' ||
    ev.moment_type === 'claimed_completion_without_execution' ||
    ev.moment_type === 'avoidable_transfer'
  ) {
    return 'qa_process';
  }
  if (ev.moment_type === 'caller_cut_off' || ev.moment_type === 'unresolved_request') return 'customer_experience';
  return 'workflow';
}

function agentFromDimension(dimension: ReviewFindingDimension) {
  if (dimension === 'audio_behavior') return 'audio_behavioral_signals' as const;
  if (dimension === 'customer_experience') return 'customer_experience' as const;
  if (dimension === 'qa_process' || dimension === 'compliance' || dimension === 'integration') {
    return 'qa_process_compliance' as const;
  }
  return 'conversation_understanding' as const;
}

function findingFromEvidence(
  callId: string,
  ev: Partial<EvidenceMoment>,
  now: string
): ReviewCandidateFinding {
  const dimension = dimensionFromEvidence(ev);
  return {
    id: ev.id ? `rf_${ev.id}` : id('rf'),
    call_id: callId,
    agent_id: agentFromDimension(dimension),
    dimension,
    type: ev.moment_type || 'summary_signal',
    status: statusFromEvidence(ev),
    severity: ev.severity || 'medium',
    confidence: confidenceFromEvidence(ev),
    evidence: [
      {
        timestamp_start_seconds: ev.timestamp_start_seconds,
        timestamp_end_seconds: ev.timestamp_end_seconds,
        segment_starts: ev.segment_starts,
        speaker: ev.speaker,
        quote_or_transcript_excerpt: ev.quote_or_transcript_excerpt || ev.voice_cue_notes || ''
      }
    ],
    explanation: ev.explanation || ev.reviewer_note || 'Review candidate generated from existing call evidence.',
    suggested_action: ev.recommended_fix || 'Review this moment and confirm, dismiss, or link it to an issue.',
    customer_impact: ev.customer_impact,
    operational_impact: ev.engineering_impact,
    linked_issue_suggestion: ev.linked_issue_suggestion || ev.issue_id || ev.linked_issue_id,
    tags: [ev.moment_type, ev.source].filter(Boolean) as string[],
    created_at: ev.created_at || now,
    updated_at: ev.updated_at || now
  };
}

function section<TOutput>(
  agent_id: AgentReviewSection<TOutput>['agent_id'],
  summary: string,
  findings: ReviewCandidateFinding[],
  output: TOutput,
  now: string
): AgentReviewSection<TOutput> {
  return {
    agent_id,
    status: 'succeeded',
    summary,
    confidence: findings.some(f => f.confidence === 'high') ? 'high' : findings.length ? 'medium' : 'low',
    findings,
    output,
    completed_at: now
  };
}

function buildActionItems(
  callId: string,
  findings: ReviewCandidateFinding[],
  now: string
): ReviewActionItem[] {
  return findings
    .filter(f => f.status !== 'dismissed' && (f.severity === 'high' || f.confidence === 'high'))
    .slice(0, 5)
    .map(f => ({
      id: id('act'),
      call_id: callId,
      title: f.suggested_action || f.explanation,
      priority: f.severity === 'high' ? 'high' : 'medium',
      rationale: f.explanation,
      source_finding_ids: [f.id],
      suggested_next_step: f.suggested_action,
      status: 'open',
      created_at: now,
      updated_at: now
    }));
}

export function buildReviewObject(input: ReviewObjectInput): ReviewObject {
  const now = nowIso();
  const callId = input.call.id || input.call.call_id || id('call');
  const findings = (input.evidence || [])
    .filter(ev => ev.quote_or_transcript_excerpt || ev.explanation || ev.voice_cue_notes)
    .map(ev => findingFromEvidence(callId, ev, now));

  const conversationFindings = findings.filter(f => f.agent_id === 'conversation_understanding');
  const qaFindings = findings.filter(f => f.agent_id === 'qa_process_compliance');
  const cxFindings = findings.filter(f => f.agent_id === 'customer_experience');
  const audioFindings = findings.filter(f => f.agent_id === 'audio_behavioral_signals');

  const conversationOutput: ConversationUnderstandingOutput = {
    concise_summary: input.call.call_summary || '',
    caller_goal: input.call.original_intent_summary || input.call.caller_context || '',
    final_outcome: input.call.final_outcome || '',
    anliegen: input.call.anliegen || 'other',
    solved_status: input.call.solved_status || 'no',
    customer_type: input.call.customer_type,
    entities: {
      customer_name: input.call.customer_name,
      vnr: input.call.vnr,
      phone: input.call.phone
    }
  };

  const qaOutput: QaProcessComplianceOutput = {
    workflow_path: input.call.workflow_node || '',
    workflow_node: input.call.workflow_node,
    root_cause_category: input.call.root_cause_category,
    compliance_checks: qaFindings.length
      ? qaFindings.map(f => ({ check: f.type, result: 'candidate_issue', rationale: f.explanation }))
      : [{ check: 'structured_review', result: 'not_applicable', rationale: 'No QA/process candidates generated yet.' }]
  };

  const customerOutput: CustomerExperienceOutput = {
    customer_sentiment: cxFindings.some(f => f.severity === 'high') ? 'frustrated' : cxFindings.length ? 'confused' : 'unknown',
    friction_summary: input.call.primary_friction || input.call.breakpoint_notes || '',
    moments_of_confusion: cxFindings.length,
    reviewer_note: input.call.reviewer_notes || ''
  };

  const audioOutput: AudioBehavioralSignalsOutput = {
    listened_to_audio: !!input.listenedToAudio,
    transcript_only: !input.listenedToAudio,
    acoustic_events_count: input.acousticEvents?.length || 0,
    timing_notes: [
      ...(input.timingSignals || []).map(s => s.description),
      ...(input.audioFindings || []).map(f => f.heard)
    ].slice(0, 5).join('\n'),
    transcript_segments: input.call.transcript_segments
  };

  const candidate_findings = findings.filter(f => f.status === 'candidate');
  const verified_findings = findings.filter(f => f.status === 'verified');
  const dismissed_findings = findings.filter(f => f.status === 'dismissed');
  const action_items = buildActionItems(callId, findings, now);
  const searchable = [
    input.call.call_id,
    input.call.call_summary,
    input.call.original_intent_summary,
    input.call.final_outcome,
    input.call.primary_issue_label,
    ...findings.flatMap(f => [f.type, f.explanation, f.suggested_action])
  ].filter(Boolean) as string[];

  return {
    schema_version: 1,
    call_id: callId,
    generated_at: now,
    pipeline_status: 'ready_for_review',
    agents: {
      conversation_understanding: section(
        'conversation_understanding',
        conversationOutput.concise_summary || 'Conversation understanding generated from current call fields.',
        conversationFindings,
        conversationOutput,
        now
      ),
      qa_process_compliance: section(
        'qa_process_compliance',
        qaFindings.length ? `${qaFindings.length} QA/process candidate(s).` : 'No QA/process candidates generated yet.',
        qaFindings,
        qaOutput,
        now
      ),
      customer_experience: section(
        'customer_experience',
        customerOutput.friction_summary || 'No customer-experience summary generated yet.',
        cxFindings,
        customerOutput,
        now
      ),
      audio_behavioral_signals: section(
        'audio_behavioral_signals',
        audioFindings.length
          ? `${audioFindings.length} audio/behavioral candidate(s).`
          : 'No audio/behavioral candidates generated yet.',
        audioFindings,
        audioOutput,
        now
      )
    },
    candidate_findings,
    verified_findings,
    dismissed_findings,
    action_items,
    dashboard_signals: {
      high_severity_count: findings.filter(f => f.severity === 'high' && f.status !== 'dismissed').length,
      unresolved_candidate_count: candidate_findings.length,
      trend_tags: Array.from(new Set(findings.flatMap(f => f.tags || []))).slice(0, 12),
      searchable_terms: searchable.slice(0, 40)
    }
  };
}
