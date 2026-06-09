import type { CallReview } from '../types/CallReview';

export const WORKSPACE_STORAGE_KEY = 'pflegemittelbox-qa-workspace-v1';

export function callWorkspace(call: CallReview): 'production' | 'test' {
  return call.workspace === 'test' ? 'test' : 'production';
}

export function loadSavedWorkspace(): 'production' | 'test' {
  try {
    const value = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    return value === 'test' ? 'test' : 'production';
  } catch {
    return 'production';
  }
}

export function saveWorkspace(workspace: 'production' | 'test') {
  localStorage.setItem(WORKSPACE_STORAGE_KEY, workspace);
}

export function workspaceLabel(workspace: 'production' | 'test') {
  return workspace === 'test' ? 'Test' : 'Production';
}
