import { useEffect, useRef, useState } from 'react';
import type { CallReview } from '../../types/CallReview';
import {
  loadAudioDataUrl,
  loadPlayableAudioUrl,
  openRecording,
  revokePlayableAudioUrl,
  revealRecording
} from '../../services/audioStorageService';

export function CallAudioPlayer({
  call,
  seekSeconds
}: {
  call: Partial<CallReview>;
  seekSeconds?: number;
}) {
  const [src, setSrc] = useState<string>();
  const [playError, setPlayError] = useState('');
  const [rate, setRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement>(null);
  const srcRef = useRef<string | undefined>(undefined);
  const triedFallbackRef = useRef(false);
  const [persistFailed, setPersistFailed] = useState(false);
  const hasStored = !!call.audio_local_path || !!call.audio_storage_key;
  const openPath = call.audio_local_path;

  useEffect(() => {
    let active = true;
    setPlayError('');
    setPersistFailed(false);
    triedFallbackRef.current = false;
    if (call.audio_file_name && !call.audio_local_path && !call.audio_storage_key) {
      setPersistFailed(true);
      return;
    }
    if (!call.audio_local_path && !call.audio_storage_key) return;
    loadPlayableAudioUrl(call.audio_local_path, call.audio_storage_key).then(url => {
      if (!active) return;
      if (!url) {
        setPlayError('Playback unavailable — use Reveal in Finder or re-import audio.');
        return;
      }
      srcRef.current = url;
      setSrc(url);
    });
    return () => {
      active = false;
      revokePlayableAudioUrl(srcRef.current);
    };
  }, [call.audio_local_path, call.audio_storage_key, call.id]);

  useEffect(() => {
    if (seekSeconds != null && audioRef.current) {
      audioRef.current.currentTime = Math.max(0, seekSeconds);
      void audioRef.current.play().catch(() => undefined);
    }
  }, [seekSeconds]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, src]);

  if (!hasStored) {
    const isDemoMetadata =
      !!call.audio_file_name && !call.audio_local_path && !call.audio_storage_key;
    return (
      <p className="muted audio-status-message">
        {persistFailed || isDemoMetadata
          ? `Demo/metadata only — "${call.audio_file_name || 'recording'}" has no saved audio file. Re-import a WAV/MP3 to enable playback.`
          : 'No recording attached. Import audio to persist a local copy for in-app playback.'}
      </p>
    );
  }

  return (
    <div className="audio-bar">
      <p className="muted stored-audio-label">
        {call.audio_file_name || 'Recording'}
        {call.audio_file_size ? ` · ${Math.round(call.audio_file_size / 1024)} KB` : ''}
        {call.audio_local_path ? ' · stored in app' : ' · browser storage'}
      </p>
      {src ? (
        <audio
          ref={audioRef}
          controls
          src={src}
          className="inline-audio"
          onError={() => {
            void (async () => {
              if (triedFallbackRef.current || !call.audio_local_path) {
                setPlayError('Embedded player failed — open via Finder.');
                return;
              }
              triedFallbackRef.current = true;
              const fallback = await loadAudioDataUrl(call.audio_local_path);
              if (fallback) {
                revokePlayableAudioUrl(srcRef.current);
                srcRef.current = fallback;
                setSrc(fallback);
                setPlayError('');
                return;
              }
              setPlayError('Embedded player failed — open via Finder.');
            })();
          }}
        />
      ) : (
        <p className="muted">Loading audio…</p>
      )}
      <div className="row wrap audio-controls">
        <label className="field inline-field">
          <span>Speed</span>
          <select value={rate} onChange={e => setRate(Number(e.target.value))}>
            <option value={0.75}>0.75×</option>
            <option value={1}>1×</option>
            <option value={1.25}>1.25×</option>
            <option value={1.5}>1.5×</option>
          </select>
        </label>
      </div>
      {playError && <p className="error">{playError}</p>}
      <div className="btn-group">
        <button type="button" className="btn-sm primary-soft" disabled={!openPath} onClick={() => openRecording(openPath).catch(e => alert(e.message))}>
          Open recording
        </button>
        <button type="button" className="btn-sm" disabled={!openPath} onClick={() => revealRecording(openPath).catch(e => alert(e.message))}>
          Reveal in Finder
        </button>
      </div>
    </div>
  );
}
