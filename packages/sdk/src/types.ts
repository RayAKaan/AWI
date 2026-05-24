/**
 * AWI Protocol Types
 * 
 * TypeScript definitions for the Agent Web Interface protocol.
 */

export type ExecutionMode = 'proxy' | 'advisory';

export type RecipeStatus = 'candidate' | 'active' | 'suspended' | 'deprecated';

export type AgentTier = 'free' | 'pro' | 'enterprise';

export interface AgentRequest {
  target: string;  // awi://domain/resource/action/v1
  params: Record<string, unknown>;
  agent_id?: string;
  mode?: ExecutionMode;
  session_id?: string;
  workflow_id?: string;
  delegate_to?: string;
  options?: Record<string, unknown>;
}

export interface AgentResponse<T = unknown> {
  success: boolean;
  data: T | null;
  errors: Array<{
    code: string;
    message: string;
    details?: Record<string, unknown>;
  }>;
  metadata: {
    execution_id?: string;
    latency_ms?: number;
    recipe_id?: string;
    recipe_version?: string;
    recipe_confidence?: number;
    cache_status?: 'hit' | 'miss' | 'bypass';
    [key: string]: unknown;
  };
  execution_path: string[];
  axir_intent?: {
    intent: string;
    action: string;
    parameters: string[];
  };
}

export interface Recipe {
  id: string;
  version: string;
  domain: string;
  resource: string;
  action: string;
  status: RecipeStatus;
  confidence: number;
  steps: RecipeStep[];
  selectors: Record<string, SelectorSet>;
  extraction: ExtractionSpec;
  validation: ValidationRules;
  axir?: AXIRIntent;
}

export interface RecipeStep {
  type: 'navigate' | 'wait' | 'click' | 'type' | 'scroll' | 'extract_list' | 'extract_one';
  name?: string;
  url?: string;
  selector?: string;
  value?: string;
  amount?: number;
  timeout_ms?: number;
  retry?: number;
}

export interface SelectorSet {
  name: string;
  selectors: Selector[];
}

export interface Selector {
  type: 'css' | 'semantic' | 'text' | 'attribute';
  value: string;
  priority: number;
  confidence: number;
}

export interface ExtractionSpec {
  mode: 'list' | 'one';
  container: string;
  fields: ExtractionField[];
  min_items: number;
}

export interface ExtractionField {
  name: string;
  selector: string;
  transform?: 'strip' | 'strip_currency' | 'number' | 'lower' | 'upper';
  required?: boolean;
}

export interface ValidationRules {
  required_fields: string[];
  min_items: number;
  custom_checks: ValidationRule[];
}

export interface ValidationRule {
  field: string;
  rule_type: 'required' | 'type' | 'regex' | 'range';
  value?: string | number;
}

export interface AXIRIntent {
  intent: string;
  action: string;
  parameters: string[];
  semantic_context?: Record<string, unknown>;
}

export interface RegistryEntry {
  domain: string;
  display_name: string;
  category: string;
  country: string;
  actions: Array<{
    resource: string;
    action: string;
    version: string;
    confidence: number;
    status: RecipeStatus;
  }>;
  confidence: number;
  certified: boolean;
  recipe_count: number;
}

export interface FeedbackRequest {
  execution_id: string;
  rating: 'good' | 'bad' | 'neutral';
  notes?: string;
  field_issues?: Array<{
    field: string;
    issue: string;
  }>;
}

export interface DelegationRequest {
  target: string;
  delegate_to: string;
  session_id?: string;
  workflow_id?: string;
  params?: Record<string, unknown>;
  permissions?: string[];
}

export interface AWIClientOptions {
  endpoint: string;
  certificate: string;
  timeout?: number;
  retries?: number;
}

export interface ExecutionMetrics {
  latency_ms: number;
  fallback_count: number;
  selectors_used: string[];
  cache_status: 'hit' | 'miss' | 'bypass';
}
