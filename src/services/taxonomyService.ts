import type { Database } from './storageService';
import type { WorkflowArea } from '../types/Taxonomy';
import { defaultTaxonomy } from '../types/Taxonomy';

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'workflow_area';
}

function ensureTaxonomy(db: Database) {
  return db.taxonomy || defaultTaxonomy;
}

function uniqueSlug(areas: WorkflowArea[], base: string): string {
  let slug = base;
  let n = 2;
  while (areas.some(a => a.id === slug)) {
    slug = `${base}_${n++}`;
  }
  return slug;
}

export function addWorkflowArea(
  db: Database,
  label: string,
  opts?: { id?: string; description?: string }
): Database {
  const taxonomy = ensureTaxonomy(db);
  const id = opts?.id || uniqueSlug(taxonomy.workflowAreas, slugify(label));
  if (taxonomy.workflowAreas.some(a => a.id === id)) return db;
  const area: WorkflowArea = {
    id,
    label: label.trim(),
    description: opts?.description,
    enabled: true
  };
  return {
    ...db,
    taxonomy: {
      ...taxonomy,
      workflowAreas: [...taxonomy.workflowAreas, area]
    }
  };
}

export function removeWorkflowArea(db: Database, areaId: string): Database {
  const taxonomy = ensureTaxonomy(db);
  return {
    ...db,
    taxonomy: {
      ...taxonomy,
      workflowAreas: taxonomy.workflowAreas.filter(a => a.id !== areaId)
    }
  };
}

export function renameWorkflowArea(
  db: Database,
  areaId: string,
  next: { label?: string; id?: string; description?: string }
): Database {
  const taxonomy = ensureTaxonomy(db);
  const areas = taxonomy.workflowAreas.map(a => {
    if (a.id !== areaId) return a;
    const label = next.label?.trim() || a.label;
    const id = next.id?.trim() || a.id;
    return {
      ...a,
      id,
      label,
      description: next.description !== undefined ? next.description : a.description
    };
  });
  return { ...db, taxonomy: { ...taxonomy, workflowAreas: areas } };
}
