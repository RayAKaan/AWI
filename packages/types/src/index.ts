// ===== Core v0.3.0 Recipe Types =====

export type Action = 'navigate' | 'type' | 'click' | 'wait' | 'scroll' | 'extract' | 'submit' | 'select' | 'upload' | 'hover' | 'press' | 'native_http';

export interface RecipeStep {
  step_number: number;
  action: Action;
  target?: string;
  value?: string;
  reason: string;
  fallback?: string;
  timeout?: number;
  optional?: boolean;
}

export interface RecipeMeta {
  domain: string;
  action: string;
  version: string;
  hash: string;
  signature?: string;
  publicKey?: string;
  trustScore: number;
  permissions: string[];
  jsRequired: boolean;
  authRequired: boolean;
  rateLimitTag: string;
  createdAt: string;
  updatedAt: string;
  author: string;
  tags: string[];
  native?: boolean;
  endpoint?: string;
  method?: string;
  estimatedLatencyMs?: number;
}

export interface Recipe {
  meta: RecipeMeta;
  steps: RecipeStep[];
}

// ===== Execution Types =====

export interface ExecutionContext {
  recipe: Recipe;
  params: Record<string, any>;
  page?: any;
  browser?: any;
}

export interface ExecutionLog {
  step: number;
  action: Action;
  target: string;
  success: boolean;
  timestamp: number;
  durationMs: number;
  error?: string;
  screenshot?: string;
  extracted?: any;
}

export interface ExecutionResult {
  success: boolean;
  data?: any;
  logs: ExecutionLog[];
  errors: string[];
  metadata: {
    recipeURI: string;
    recipeHash: string;
    startedAt: string;
    finishedAt: string;
    totalDurationMs: number;
    stepsCompleted: number;
    stepsTotal: number;
  };
}

// ===== Discover Types =====

export type DiscoverMode = 'inspect' | 'plan' | 'execute';

export interface SiteIdentity {
  domain: string;
  site_name?: string;
  category?: string;
  has_recipe: boolean;
  recipe_confidence?: number;
  recipe_version?: string;
  page_types_detected: string[];
}

export interface InteractiveElement {
  element_id: string;
  what_it_is: string;
  element_type: 'search' | 'button' | 'input' | 'link' | 'form' | 'dropdown' | 'checkbox' | 'unknown';
  purpose: string;
  how_to_target: string;
  selector_hint?: string;
  confidence: number;
  required_params: string[];
}

export interface ExtractableField {
  field_name: string;
  description: string;
  example_value?: string;
  where_to_find: string;
  data_type: 'text' | 'number' | 'url' | 'image' | 'date' | 'list' | 'boolean';
  cardinality: 'single' | 'multiple';
}

export interface ActionPlanStep {
  step_number: number;
  action: Action;
  target?: string;
  value?: string;
  reason: string;
  fallback?: string;
}

export interface RiskWarning {
  risk_type: 'auth_required' | 'rate_limit' | 'captcha' | 'paywall' | 'dynamic_content' | 'anti_bot' | 'deprecated_ui' | 'unknown';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  mitigation?: string;
}

export interface DiscoverResponse {
  target: string;
  site: SiteIdentity;
  summary: string;
  what_you_can_do: string[];
  interactive_elements: InteractiveElement[];
  extractable_data: ExtractableField[];
  action_plan?: RecipeStep[];
  risks: RiskWarning[];
  bxl_summary?: Record<string, any>;
  execution_result?: any;
  metadata: Record<string, any>;
}

// ===== Site-SDK Types =====

export interface RouteHandler {
  (req: any, res: any, next?: any): void;
}

export interface RouteParameter {
  name: string;
  type: string;
  required: boolean;
}

export interface RouteDefinition {
  path: string;
  methods: string[];
  handler: RouteHandler;
  parameters: RouteParameter[];
  returnType: string;
  intent: string;
}

export interface SiteManifest {
  version: string;
  native: boolean;
  routes: Array<{
    path: string;
    intent: string;
    parameters: RouteParameter[];
    methods: string[];
  }>;
}

export interface SiteBlueprint {
  recipe_id: string;
  target: string;
  native: boolean;
  endpoint: string;
  method: string;
  parameters: RouteParameter[];
  return_schema: string;
  axir?: Record<string, any>;
  estimated_latency_ms: number;
}

// ===== Client / React Types =====

export type ExecutionMode = 'proxy' | 'advisory';

export interface AgentRequest {
  target: string;
  params?: Record<string, any>;
  mode?: ExecutionMode;
  agent_id?: string;
  session_id?: string;
  workflow_id?: string;
  delegate_to?: string;
  options?: Record<string, any>;
}

export interface AgentResponse<T = unknown> {
  success: boolean;
  data?: T;
  errors?: Array<{ message: string; code?: string; details?: Record<string, any> }>;
  metadata?: Record<string, any>;
  execution_path?: string[];
}

export interface DiscoverRequest {
  target: string;
  depth?: 'basic' | 'full';
  include_plan?: boolean;
}

export interface AWIClientOptions {
  endpoint?: string;
  certificate?: string;
  timeout?: number;
  retries?: number;
  p2p?: boolean;
  dataDir?: string;
}

export interface UseAWIResult<T = unknown> {
  execute: (request: Omit<AgentRequest, 'mode'>) => Promise<AgentResponse<T>>;
  explore: (domain: string, resource: string, action?: string) => Promise<AgentResponse<unknown>>;
  run: (uri: string, params?: Record<string, any>) => Promise<ExecutionResult>;
  loading: boolean;
  data: T | null;
  error: Error | null;
  metrics: { latency_ms: number; fallback_count: number } | null;
}

// ===== Registry Types =====

export interface RecipeSource {
  name: string;
  priority: number;
  fetch(domain: string, action: string, version: string): Promise<Recipe | null>;
  list?(domain?: string): Promise<RecipeMeta[]>;
}

export interface RegistryConfig {
  sources: RecipeSource[];
  autoDiscover: boolean;
  cacheTtlMs: number;
  trustThreshold: number;
}

// ===== Security Types =====

export interface Capability {
  domain: string;
  permission: string;
  grantedAt: string;
  expiresAt?: string;
}

export interface SecurityPolicy {
  allowUnsignedRecipes: boolean;
  allowAutoGenerated: boolean;
  maxTrustThreshold: number;
  sandboxPermissions: string[];
  allowedDomains: string[];
  blockedDomains: string[];
}

// ===== Sync Types =====

export interface SyncPatch {
  added: Recipe[];
  updated: RecipeMeta[];
  removed: string[];
  checkpoint: string;
}

export interface SyncConfig {
  remoteURL: string;
  intervalMs: number;
  autoSync: boolean;
  compression: boolean;
}

// ===== Backward-Compatible v2.1 Legacy Types =====

export type LegacyRecipeStatus = 'candidate' | 'active' | 'suspended' | 'deprecated';

export type AgentTier = 'free' | 'pro' | 'enterprise';

export interface LegacyRecipeStep {
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
  semantic_context?: Record<string, any>;
}

export interface LegacyRecipe {
  id: string;
  version: string;
  domain: string;
  resource: string;
  action: string;
  status: LegacyRecipeStatus;
  confidence: number;
  steps: LegacyRecipeStep[];
  selectors: Record<string, SelectorSet>;
  extraction: ExtractionSpec;
  validation: ValidationRules;
  axir?: AXIRIntent;
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
    status: LegacyRecipeStatus;
  }>;
  confidence: number;
  certified: boolean;
  recipe_count: number;
}

export interface FeedbackRequest {
  execution_id: string;
  rating: 'good' | 'bad' | 'neutral';
  notes?: string;
  field_issues?: Array<{ field: string; issue: string }>;
}

export interface DelegationRequest {
  target: string;
  delegate_to: string;
  session_id?: string;
  workflow_id?: string;
  params?: Record<string, any>;
  permissions?: string[];
}

export interface ExecutionMetrics {
  latency_ms: number;
  fallback_count: number;
  selectors_used: string[];
  cache_status: 'hit' | 'miss' | 'bypass';
}

export interface ExecutionResponse {
  success: boolean;
  data?: unknown;
  errors?: Array<{ code?: string; message: string; details?: Record<string, any> }>;
  metadata?: Record<string, any>;
  execution_path?: string[];
}
