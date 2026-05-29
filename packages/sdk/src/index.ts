// v0.3.0 API (default)
export { AWI, AWISDK } from './sdk';
export type { SDKConfig } from './sdk';

// v0.3.0 modules
export { FileSystemDB, hashRecipe } from './db';
export { NativeExecutor } from './native-executor';
export {
  RecipeSigner, CapabilityManager, PolicyEnforcer,
  LocalRateLimiter, DEFAULT_POLICY, STRICT_POLICY,
} from './security';
export { SEED_RECIPES } from './seeds';

// Re-export from sdk.ts
export { RecipeRegistry, LocalExecutor, DOMExtractor, RecipeSync } from './sdk';

// v2.1 API (backward compatible)
export { AWIClient } from './client';
export { AdvisoryExecutor } from './advisory-executor';
export { DiscoverResult } from './result';
export { ExecutionResult as LegacyExecutionResult } from './execution';

// Compiler
export { AXIRCompilerV2 as AXIRCompiler, type CompileOptions } from './compiler/axir-compiler-v2';
export { AXIRCompiler as AXIRCompilerV1 } from './compiler/axir-compiler-v1';
export { LocalAXIRCompiler, type LocalAXIRCompilerOptions } from './compiler/local-axir';

// Re-export all types from @awi-protocol/types
export type {
  Recipe, RecipeMeta, RecipeStep, Action,
  ExecutionResult, ExecutionLog,
  DiscoverResponse, SiteIdentity, InteractiveElement,
  ExtractableField, ActionPlanStep, RiskWarning, DiscoverMode, DiscoverRequest,
  RecipeSource, RegistryConfig,
  SecurityPolicy, Capability,
  SyncConfig, SyncPatch,
  AgentRequest, AgentResponse, AWIClientOptions,
  RouteHandler, RouteDefinition, RouteParameter, SiteManifest, SiteBlueprint,
  LegacyRecipe, LegacyRecipeStep, LegacyRecipeStatus,
  AgentTier, SelectorSet, Selector, ExtractionSpec, ExtractionField,
  ValidationRules, ValidationRule, AXIRIntent,
  RegistryEntry, FeedbackRequest, DelegationRequest,
  ExecutionMetrics, ExecutionResponse,
} from '@awi-protocol/types';

// Backward-compatible aliases
import type { Recipe as _Recipe, RecipeStep as _RecipeStep, ExecutionResult as _ExecutionResult } from '@awi-protocol/types';
export type RecipeV3 = _Recipe;
export type RecipeStepV3 = _RecipeStep;
export type ExecutionResultV3 = _ExecutionResult;

// Compiler types
export type {
  AXIRNode, AXIREdge, AXIRWorkflow, AXIRIntentMapping, AXIRField,
  AXIRCompilationResult, AXIRHealingResult, SelectorCandidate,
} from './compiler/types';
