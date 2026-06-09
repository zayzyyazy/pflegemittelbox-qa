export type FailureMode = 'routing' | 'prompt' | 'integration' | 'data_field';

export interface WorkflowArea {
  id: string;
  label: string;
  description?: string;
  enabled?: boolean;
}

export interface Taxonomy {
  workflowAreas: WorkflowArea[];
  failureModes: FailureMode[];
}

export const DEFAULT_FAILURE_MODES: FailureMode[] = [
  'routing',
  'prompt',
  'integration',
  'data_field'
];

export const DEFAULT_WORKFLOW_AREAS: WorkflowArea[] = [
  { id: 'identify', label: 'Customer identification / phone lookup', enabled: true },
  { id: 'verify', label: 'Birthday + insurance verification', enabled: true },
  { id: 'delivery', label: 'Lieferstatus / delivery questions & complaints', enabled: true },
  { id: 'box_change', label: 'Box / product changes', enabled: true },
  { id: 'reactivation', label: 'Reactivations', enabled: true },
  { id: 'cancel_pause', label: 'Cancellation & pause / retention', enabled: true },
  { id: 'tickets', label: 'Ticket creation', enabled: true },
  { id: 'transfer', label: 'Call transfer to human/team', enabled: true },
  { id: 'email', label: 'Send email actions', enabled: true },
  { id: 'crm_update', label: 'CRM / customer data updates', enabled: true },
  { id: 'completion', label: 'Call completion & conversation end', enabled: true },
  { id: 'field_mapping', label: 'Workflow field population', enabled: true },
  { id: 'dialogue_loop', label: 'Stuck loops / broken transitions', enabled: true },
  { id: 'integration', label: 'External lookup/API failures', enabled: true },
  { id: 'vip_retention', label: 'VIP / retention offers', enabled: true }
];

export const defaultTaxonomy: Taxonomy = {
  workflowAreas: DEFAULT_WORKFLOW_AREAS,
  failureModes: DEFAULT_FAILURE_MODES
};
