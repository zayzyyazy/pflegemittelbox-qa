import { useState } from 'react';
import type { Database } from '../../services/storageService';
import { fetchLeapingCalls, importLeapingRawCalls } from '../../services/leapingImportService';

export function useLeapingImport(db: Database, setDb: (db: Database) => void) {
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');

  async function runImport() {
    console.info('[leaping-import] starting import');
    setImporting(true);
    setMessage('Importing Leaping calls…');
    try {
      const { calls: raw, db: dbAfterFetch } = await fetchLeapingCalls(db);
      const result = await importLeapingRawCalls(dbAfterFetch, raw);
      setDb(result.db);
      const batch = db.settings.leapingImportBatchSize ?? 50;
      const parts = [`${result.imported} new`, `${result.updated} updated`];
      if (result.skipped > 0) parts.push(`${result.skipped} skipped (< 50s)`);
      setMessage(`Leaping import complete (batch ${batch}): ${parts.join(', ')}.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[leaping-import] failed', msg);
      setMessage(msg || 'Leaping import failed.');
    } finally {
      setImporting(false);
    }
  }

  return { importing, message, runImport, lastImportAt: db.leapingLastImportAt };
}

export function LeapingImportButton({
  db,
  importing,
  onImport,
  className = 'primary'
}: {
  db: Database;
  importing: boolean;
  onImport: () => void;
  className?: string;
}) {
  const batch = db.settings.leapingImportBatchSize ?? 50;
  return (
    <button type="button" className={className} onClick={onImport} disabled={importing}>
      {importing ? 'Importing Leaping…' : `Import Leaping (${batch})`}
    </button>
  );
}

export function LeapingImportNotice({
  message,
  lastImportAt
}: {
  message?: string;
  lastImportAt?: string;
}) {
  if (!message && !lastImportAt) return null;
  return (
    <section className="panel inline-notice leaping-import-notice">
      <div className="row between wrap">
        {message && <p className="muted">{message}</p>}
        {lastImportAt && (
          <span className="badge blue">Last import {lastImportAt.slice(0, 16).replace('T', ' ')}</span>
        )}
      </div>
    </section>
  );
}
