export interface SelectorCandidate {
  type: 'css' | 'semantic' | 'text' | 'attribute';
  value: string;
  priority: number;
  confidence?: number;
}

export interface AXIRNode {
  node_id: string;
  element_type:
    | 'button'
    | 'link'
    | 'input'
    | 'form'
    | 'navigation'
    | 'search'
    | 'filter'
    | 'sort'
    | 'pagination'
    | 'container'
    | 'list'
    | 'item'
    | 'heading'
    | 'text'
    | 'image'
    | 'unknown';
  semantic_role?: string;
  intent?: string;
  tag?: string;
  selector_candidates: SelectorCandidate[];
  parent_id?: string;
  children_ids?: string[];
  aria_label?: string;
  aria_role?: string;
  text_content?: string;
  confidence: number;
  reasoning?: string;
}

export interface AXIREdge {
  from_node: string;
  to_node: string;
  action: string;
  condition?: string;
  probability: number;
}

export type PageType =
  | 'landing'
  | 'search'
  | 'listing'
  | 'detail'
  | 'form'
  | 'checkout'
  | 'dashboard'
  | 'unknown';

export interface AXIRWorkflow {
  nodes: Record<string, AXIRNode>;
  edges: AXIREdge[];
  entry_points: string[];
  exit_points: string[];
  domain: string;
  page_type: PageType;
  structure_hash?: string;
}

export interface AXIRIntentMapping {
  intent: string;
  action: string;
  parameters: string[];
  context: string;
}

export interface AXIRField {
  name: string;
  selector: string;
  transform?: string;
  required: boolean;
}

export interface AXIRCompilationResult {
  workflow: AXIRWorkflow;
  intents: AXIRIntentMapping[];
  selectors: Record<string, SelectorCandidate[]>;
  fields: AXIRField[];
  container?: string;
  model_used: string;
  tokens_used: number;
  compilation_time_ms: number;
}

export interface AXIRHealingResult {
  selector: string;
  confidence: number;
  reasoning?: string;
}
