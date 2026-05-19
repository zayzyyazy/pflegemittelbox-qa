import type { Database, Settings } from './storageService';
import type { CallReview } from '../types/CallReview';
import type { EvidenceMoment } from '../types/EvidenceMoment';
import type { Experiment } from '../types/Experiment';
import { normalizeAnliegen } from '../utils/anliegen';
import { cleanCallIdFromFilename, id } from '../utils/text';
import { nowIso } from '../utils/dates';

const timeoutSignal = (ms: number) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };
function requireKey(settings: Settings) { if (!settings.openaiApiKey.trim()) throw new Error('Missing OpenAI API key. Add it in Settings first.'); }
async function chatJson(settings: Settings, system: string, user: unknown, ms = 75000) {
  requireKey(settings);
  const res = await fetch('https://api.openai.com/v1/chat/completions', { method:'POST', signal: timeoutSignal(ms), headers:{ 'Content-Type':'application/json', Authorization: 'Bearer ' + settings.openaiApiKey }, body: JSON.stringify({ model: settings.textModel || 'gpt-4o-mini', temperature: .2, response_format:{ type:'json_object' }, messages:[{ role:'system', content:system }, { role:'user', content: JSON.stringify(user) }] }) });
  if (!res.ok) throw new Error((await res.text()).slice(0, 300) || 'OpenAI request failed');
  const json = await res.json();
  try { return JSON.parse(json.choices?.[0]?.message?.content || '{}'); } catch { throw new Error('OpenAI returned malformed JSON.'); }
}
export async function testKey(settings: Settings) { await chatJson(settings, 'Return JSON {"ok":true}.', { ping:true }, 30000); return true; }
export async function transcribeAudio(settings: Settings, file: File) {
  requireKey(settings);
  const form = new FormData(); form.append('model', settings.transcriptionModel || 'whisper-1'); form.append('file', file);
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method:'POST', signal: timeoutSignal(180000), headers:{ Authorization:'Bearer ' + settings.openaiApiKey }, body: form });
  if (!res.ok) throw new Error((await res.text()).slice(0, 300) || 'Transcription failed');
  const json = await res.json(); return json.text || '';
}
const reviewSystem = 'You turn Leaping AI call review notes or transcripts into strict JSON. Normalize Anliegen using only: order_status, cancel_or_pause, box_or_product_change, address_or_account_change, authentication_problem, other. Use the caller original intent. Also identify evidence_moments with exact excerpts. No prose outside JSON.';
export async function generateCallDraft(settings: Settings, input: { reviewText?: string; transcript?: string; file?: { name:string; size:number; type:string; lastModified:number }; reviewerContext?: string }) {
  const out = await chatJson(settings, reviewSystem, input, 75000);
  const now = nowIso();
  const call: Partial<CallReview> = { id:id('call'), call_id: out.call_id || (input.file ? cleanCallIdFromFilename(input.file.name) : id('callid')), date: out.date || new Date().toISOString().slice(0,10), duration_seconds: Number(out.duration_seconds || 0), customer_type: out.customer_type || '', caller_context: out.caller_context || input.reviewerContext || '', anliegen: normalizeAnliegen(out.anliegen || out.intent || input.reviewText || input.transcript || ''), solved_status: out.solved_status || 'partially', overall_rating: Number(out.overall_rating || 5), naturalness_rating: Number(out.naturalness_rating || 5), caller_cut_off: !!out.caller_cut_off, awkward_pauses: !!out.awkward_pauses, robotic_pacing: !!out.robotic_pacing, latency_too_long: !!out.latency_too_long, repeated_question: !!out.repeated_question, identification_problem: !!out.identification_problem, missing_integration: !!out.missing_integration, workflow_node: out.workflow_node || '', root_cause_category: out.root_cause_category || 'Other', breakpoint_notes: out.breakpoint_notes || '', suggested_improvement: out.suggested_improvement || '', reviewer_notes: out.reviewer_notes || '', call_summary: out.call_summary || '', transcript: input.transcript || out.transcript || '', audio_file_name: input.file?.name || '', audio_file_size: input.file?.size || 0, audio_file_type: input.file?.type || '', audio_file_last_modified: input.file?.lastModified || 0, linked_issue_ids: [], created_at: now, updated_at: now };
  const evidence: Partial<EvidenceMoment>[] = (out.evidence_moments || []).map((e: any) => ({ id:id('ev'), call_id: call.id!, speaker:e.speaker || 'unknown', moment_type:e.moment_type || 'other', severity:e.severity || 'medium', timestamp_start_seconds:e.timestamp_start_seconds, timestamp_end_seconds:e.timestamp_end_seconds, quote_or_transcript_excerpt:e.quote_or_transcript_excerpt || e.excerpt || '', explanation:e.explanation || '', recommended_fix:e.recommended_fix || '', voice_cue_notes:e.voice_cue_notes || '', created_at:now, updated_at:now }));
  return { call, evidence };
}
export function buildProjectPayload(db: Database) { return { active_issues: db.issues.filter(i=>!['resolved','ignored'].includes(i.status)).slice(0,5), caller_request_counts: db.calls.reduce((a:any,c)=>{a[c.anliegen]=(a[c.anliegen]||0)+1; return a;},{}), recent_calls: db.calls.slice(0,5).map(c=>({ call_id:c.call_id, anliegen:c.anliegen, solved_status:c.solved_status, rating:c.overall_rating, summary:c.call_summary, root_cause:c.root_cause_category })), experiments: db.experiments.slice(0,5), memory: db.memory.filter(m=>m.importance !== 'low').slice(0,8).map(m=>m.memory_text) }; }
export async function getAiInsights(settings: Settings, db: Database) { return chatJson(settings, 'Return strict JSON with primary_focus, why, next_steps array of 3, experiment, success_metric. Be concise and operational.', buildProjectPayload(db), 90000); }
export function localRecommendation(db: Database) { const issue = db.issues.filter(i=>!['resolved','ignored'].includes(i.status)).sort((a,b)=> (a.severity==='high'?-1:1) - (b.severity==='high'?-1:1))[0]; const counts = db.calls.reduce((a:any,c)=>{a[c.anliegen]=(a[c.anliegen]||0)+1; return a;},{}); const top = Object.entries(counts).sort((a:any,b:any)=>Number(b[1])-Number(a[1]))[0]?.[0] || 'other'; return { primary_focus: issue?.title || 'Review the next unsolved call', why: issue?.description || 'No active issue has enough evidence yet.', next_steps: ['Review highest severity evidence', 'Link two exact call examples', 'Define one small experiment'], experiment: issue?.suggested_fix || 'Create a narrow prompt or workflow test.', success_metric: 'Fewer unresolved or partially solved calls for ' + top }; }
export async function askAi(settings: Settings, payload: unknown) { return chatJson(settings, 'Answer as concise operational bullets with exact next steps. Return JSON {"answer":"..."}.', payload, 90000); }
export async function generateExperimentDraft(settings: Settings, text: string): Promise<Partial<Experiment>> { return chatJson(settings, 'Turn experiment notes into strict Experiment JSON fields. Result must be better/worse/no_change/inconclusive.', { text }, 75000); }
