// Placeholder for the next iteration: a Tauri file watcher can poll or subscribe to an auto-ingest folder and create queued Batch Transcribe entries without saving audio binaries.
export interface IngestCandidate { path: string; fileName: string; detectedAt: string; }
export const scanAutoIngestFolder = async () : Promise<IngestCandidate[]> => [];