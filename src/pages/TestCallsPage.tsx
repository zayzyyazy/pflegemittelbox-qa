import { CallsPage } from './CallsPage';
import type { Database } from '../services/storageService';

export function TestCallsPage({
  db,
  setDb,
  selectedCallId,
  selectedEvidenceId
}: {
  db: Database;
  setDb: (db: Database) => void;
  selectedCallId?: string;
  selectedEvidenceId?: string;
}) {
  return (
    <CallsPage
      db={db}
      setDb={setDb}
      selectedCallId={selectedCallId}
      selectedEvidenceId={selectedEvidenceId}
      initialWorkspace="test"
    />
  );
}
