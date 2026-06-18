let generation = 0;

/** Bump to cancel any in-flight recording import. */
export function cancelActiveImport(): number {
  generation += 1;
  return generation;
}

export function currentImportGeneration(): number {
  return generation;
}

export function isImportCancelled(runToken: number): boolean {
  return runToken !== generation;
}
