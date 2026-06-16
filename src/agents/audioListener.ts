import type { Settings } from '../services/storageService';
import type { AudioListenerFinding } from '../types/AudioAnalysis';
import { audioFormatForFile, extractAudioClip, fileToBase64 } from '../utils/clipExtract';
import type { AudioClipWindow } from '../types/AudioAnalysis';

const AUDIO_LISTENER_SYSTEM = `You listen to German Pflegebox / care hotline call audio.
Return strict JSON: {"findings":[{"heard":"what you hear that transcript may miss","issue_type":"caller_cut_off|long_pause|repeated_authentication|robotic_pacing|wrong_workflow|missing_integration|other","speaker":"caller|agent|unknown","severity":"low|medium|high","start_seconds":0,"end_seconds":0,"confidence":0.0,"suggested_action":"what the reviewer should check or change"}]}
Focus on: caller frustration, sighs, cut-offs, robotic pacing, dead air, overlap, auth loops audible but poorly transcribed.
Be specific. If audio sounds clean, return {"findings":[]}.
Reply with JSON only — no markdown fences.`;

function parseFindingsContent(content: string): AudioListenerFinding[] {
  const trimmed = content.trim();
  if (!trimmed) return [];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced || trimmed).trim();
  try {
    const parsed = JSON.parse(candidate) as { findings?: AudioListenerFinding[] };
    return (parsed.findings || []).filter(f => f.heard?.trim());
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(candidate.slice(start, end + 1)) as { findings?: AudioListenerFinding[] };
        return (parsed.findings || []).filter(f => f.heard?.trim());
      } catch {
        return [];
      }
    }
    return [];
  }
}

function isRetryableAudioError(raw: string) {
  return /model_not_found|does not exist|do not have access|response_format.*not supported/i.test(raw);
}

const AUDIO_LISTENER_MODELS = ['gpt-audio-1.5', 'gpt-4o-audio-preview'] as const;

async function listenToClip(
  settings: Settings,
  clipFile: File,
  context: { transcript_excerpt?: string; clip_reason?: string },
  signal?: AbortSignal
): Promise<AudioListenerFinding[]> {
  const base64 = await fileToBase64(clipFile);
  const format = audioFormatForFile(clipFile);
  const configured = (settings.audioListenerModel || 'gpt-audio-1.5').trim();
  const models = [configured, ...AUDIO_LISTENER_MODELS.filter(m => m !== configured)];

  let lastError = 'Audio listener failed';

  for (const model of models) {
    const body: Record<string, unknown> = {
      model,
      modalities: ['text'],
      temperature: 0.1,
      messages: [
        { role: 'system', content: AUDIO_LISTENER_SYSTEM },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                clip_reason: context.clip_reason,
                transcript_excerpt: context.transcript_excerpt?.slice(0, 1200)
              })
            },
            {
              type: 'input_audio',
              input_audio: { data: base64, format }
            }
          ]
        }
      ]
    };

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + settings.openaiApiKey
      },
      body: JSON.stringify(body)
    });

    const raw = await res.text();
    if (!res.ok) {
      lastError = raw.slice(0, 300) || 'Audio listener failed';
      if (isRetryableAudioError(lastError)) continue;
      throw new Error(lastError);
    }

    const json = JSON.parse(raw);
    const content = String(json.choices?.[0]?.message?.content || '');
    return parseFindingsContent(content).slice(0, 4);
  }

  throw new Error(lastError);
}

export async function listenToCallAudio(
  settings: Settings,
  file: File,
  opts: {
    transcript?: string;
    windows: AudioClipWindow[];
    fullCall?: boolean;
    signal?: AbortSignal;
  }
): Promise<AudioListenerFinding[]> {
  const findings: AudioListenerFinding[] = [];
  const maxClip = settings.maxClipSeconds ?? 30;

  if (opts.fullCall) {
    const full = await listenToClip(
      settings,
      file,
      { transcript_excerpt: opts.transcript, clip_reason: 'Full call under duration cap' },
      opts.signal
    );
    findings.push(...full);
  } else {
    const windows =
      opts.windows.length > 0
        ? opts.windows
        : [{ start_seconds: 0, end_seconds: maxClip, reason: 'Fallback opening clip' }];

    for (const window of windows) {
      try {
        const clip = await extractAudioClip(file, window.start_seconds, window.end_seconds);
        const clipFindings = await listenToClip(
          settings,
          clip,
          { transcript_excerpt: opts.transcript, clip_reason: window.reason },
          opts.signal
        );
        for (const f of clipFindings) {
          findings.push({
            ...f,
            start_seconds: f.start_seconds ?? window.start_seconds,
            end_seconds: f.end_seconds ?? window.end_seconds
          });
        }
      } catch {
        // skip failed clip
      }
    }
  }

  const seen = new Set<string>();
  return findings.filter(f => {
    const key = f.heard.toLowerCase().slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function testAudioListener(settings: Settings, file: File): Promise<AudioListenerFinding[]> {
  const dur = await estimateDuration(file);
  const maxClip = settings.maxClipSeconds ?? 30;
  const end = dur > 0 ? Math.min(dur, maxClip) : maxClip;
  const clip = end >= 5 ? await extractAudioClip(file, 0, end) : file;
  return listenToClip(settings, clip, {
    clip_reason: `Settings test clip (first ${Math.round(end)}s)`
  });
}

async function estimateDuration(file: File): Promise<number> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    return decoded.duration;
  } finally {
    await ctx.close().catch(() => undefined);
  }
}
