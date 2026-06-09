import type { Database } from '../../services/storageService';
import type { CallReview } from '../../types/CallReview';
import { CallReviewShell } from './CallReviewShell';

/** @deprecated Use CallReviewShell directly */
export function CallDetailView({
  call,
  db,
  setDb,
  initialEvidenceId,
  onClose
}: {
  call: CallReview;
  db: Database;
  setDb: (db: Database) => void;
  initialEvidenceId?: string;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const evidence = db.evidence.filter(e => e.call_id === call.id);
  const live = db.calls.find(c => c.id === call.id) || call;

  return (
    <CallReviewShell
      db={db}
      setDb={setDb}
      call={live}
      evidence={evidence}
      initialEvidenceId={initialEvidenceId}
      onClose={onClose}
    />
  );
}

export { CallAudioPlayer } from './CallAudioPlayer';
