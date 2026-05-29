import type { Recipe, RecipeSource, DiscoverResponse, ExecutionResult, SecurityPolicy, SyncConfig } from '@awi-protocol/types';
import type { SiteManifest, SiteBlueprint } from '@awi-protocol/types';
import { FileSystemDB, DBAdapter, hashRecipe } from './db';
import { RecipeRegistry, SeedSource, GitRecipeSource, LocalDBSource, AutoDiscoverSource } from './registry';
import { LocalExecutor } from './local-executor';
import { NativeExecutor } from './native-executor';
import { DOMExtractor } from './extractor';
import { RecipeSync } from './sync';
import {
  PolicyEnforcer, CapabilityManager, LocalRateLimiter,
  DEFAULT_POLICY,
} from './security';
import { SEED_RECIPES } from './seeds';

export interface SDKConfig {
  dataDir?: string;
  headless?: boolean;
  screenshotOnFailure?: boolean;
  defaultTimeout?: number;
  policy?: SecurityPolicy;
  sync?: SyncConfig;
  recipeSources?: { git?: string[]; ipfs?: string[] };
  nativeHeaders?: Record<string, string>;
}

export class AWISDK {
  private db: DBAdapter;
  private registry: RecipeRegistry;
  private localExecutor: LocalExecutor;
  private nativeExecutor: NativeExecutor;
  private sync: RecipeSync;
  private caps: CapabilityManager;
  private extractor: DOMExtractor;

  constructor(config: SDKConfig = {}) {
    const dataDir = config.dataDir || './.awi';
    const policy = new PolicyEnforcer(config.policy || DEFAULT_POLICY);
    const caps = new CapabilityManager(policy.getSandboxPermissions());
    const db = new FileSystemDB(dataDir);
    const rateLimiter = new LocalRateLimiter();

    rateLimiter.configure('github.com', 30, 5);
    rateLimiter.configure('linkedin.com', 10, 2);
    rateLimiter.configure('google.com', 60, 10);
    rateLimiter.configure('news.ycombinator.com', 30, 5);
    rateLimiter.configure('wikipedia.org', 60, 10);

    const localExecutor = new LocalExecutor(rateLimiter, {
      headless: config.headless !== false,
      screenshotOnFailure: config.screenshotOnFailure !== false,
      defaultTimeout: config.defaultTimeout || 30000,
    });

    const nativeExecutor = new NativeExecutor({
      timeout: config.defaultTimeout || 30000,
      headers: config.nativeHeaders,
    });

    const extractor = new DOMExtractor();

    const sources: RecipeSource[] = [
      new SeedSource(SEED_RECIPES),
      new LocalDBSource(db),
    ];

    if (config.recipeSources?.git) {
      for (const url of config.recipeSources.git) {
        sources.push(new GitRecipeSource(url));
      }
    }

    const autoDiscover = new AutoDiscoverSource(extractor);

    const registry = new RecipeRegistry(
      { sources, autoDiscover: true, cacheTtlMs: 86400000, trustThreshold: 0.0 },
      db,
      policy,
      caps,
      autoDiscover
    );

    const sync = new RecipeSync(db, {
      remoteURL: 'https://recipes.awi.network/sync',
      intervalMs: 300000,
      autoSync: true,
      compression: true,
      ...config.sync,
    });

    this.db = db;
    this.registry = registry;
    this.localExecutor = localExecutor;
    this.nativeExecutor = nativeExecutor;
    this.sync = sync;
    this.caps = caps;
    this.extractor = extractor;

    this.sync.start();
  }

  supports(recipe: Recipe): 'native' | 'local' | null {
    if (this.nativeExecutor.supports(recipe)) return 'native';
    return 'local';
  }

  async discover(target: string, _goal?: string): Promise<DiscoverResponse> {
    const pw = await import('playwright');
    const browser = await pw.chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(target, { timeout: 30000 });
      const script = this.extractor.getExtractionScript();
      const result = await page.evaluate(script);
      return result as DiscoverResponse;
    } finally {
      await context.close();
      await browser.close();
    }
  }

  async discoverSite(baseURL: string): Promise<Recipe[]> {
    const recipes: Recipe[] = [];
    const normalized = baseURL.replace(/\/$/, '');

    try {
      const manifestRes = await fetch(`${normalized}/awi/manifest`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      if (!manifestRes.ok) {
        throw new Error(`Manifest not found: ${manifestRes.status}`);
      }

      const manifest: SiteManifest = await manifestRes.json();

      if (!manifest.native) {
        console.warn(`[AWI] Site ${baseURL} does not advertise native support`);
      }

      for (const route of manifest.routes) {
        try {
          const blueprintRes = await fetch(`${normalized}/awi/blueprint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: route.path }),
            signal: AbortSignal.timeout(10000),
          });

          if (!blueprintRes.ok) continue;

          const blueprint: SiteBlueprint = await blueprintRes.json();
          const recipe = this.blueprintToRecipe(blueprint);
          recipes.push(recipe);
          await this.db.putRecipe(recipe);

        } catch (err: any) {
          console.warn(`[AWI] Failed to get blueprint for ${route.path}: ${err.message}`);
        }
      }

    } catch (err: any) {
      console.error(`[AWI] discoverSite failed: ${err.message}`);
      const discovery = await this.discover(baseURL);
      if (discovery.action_plan) {
        const autoRecipe = this.discoveryToRecipe(baseURL, discovery);
        recipes.push(autoRecipe);
      }
    }

    return recipes;
  }

  async inspect(target: string): Promise<DiscoverResponse> {
    return this.discover(target);
  }

  async run(uri: string, params: Record<string, any> = {}): Promise<ExecutionResult> {
    const recipe = await this.registry.resolve(uri);

    if (this.nativeExecutor.supports(recipe)) {
      return this.nativeExecutor.run(recipe, params);
    }

    return this.localExecutor.run(recipe, params);
  }

  async runRecipe(recipe: Recipe, params: Record<string, any> = {}): Promise<ExecutionResult> {
    if (this.nativeExecutor.supports(recipe)) {
      return this.nativeExecutor.run(recipe, params);
    }
    return this.localExecutor.run(recipe, params);
  }

  grantCapability(domain: string, permission: string, ttlDays?: number) {
    return this.caps.grant(domain, permission, ttlDays);
  }

  async listRecipes(domain?: string) {
    return this.db.listRecipes(domain);
  }

  async stats() {
    return this.db.getStats();
  }

  stop() {
    this.sync.stop();
  }

  private blueprintToRecipe(blueprint: SiteBlueprint): Recipe {
    const now = new Date().toISOString();
    const recipe: Recipe = {
      meta: {
        domain: new URL(blueprint.endpoint).hostname,
        action: blueprint.target.replace(/^awi:\/\//, '').split('/').slice(1, -1).join('/'),
        version: 'v1',
        hash: '',
        trustScore: 1.0,
        permissions: ['read:public'],
        jsRequired: false,
        authRequired: false,
        rateLimitTag: new URL(blueprint.endpoint).hostname,
        createdAt: now,
        updatedAt: now,
        author: 'site-sdk',
        tags: ['native', 'site-sdk'],
        native: true,
        endpoint: blueprint.endpoint,
        method: blueprint.method,
        estimatedLatencyMs: blueprint.estimated_latency_ms,
      },
      steps: [
        {
          step_number: 1,
          action: 'native_http',
          target: blueprint.endpoint,
          value: blueprint.method,
          reason: `Native endpoint for ${blueprint.target}`,
        },
      ],
    };
    recipe.meta.hash = hashRecipe(recipe);
    return recipe;
  }

  private discoveryToRecipe(url: string, discovery: DiscoverResponse): Recipe {
    const now = new Date().toISOString();
    const recipe: Recipe = {
      meta: {
        domain: new URL(url).hostname,
        action: 'auto-discover',
        version: 'auto',
        hash: '',
        trustScore: 0.0,
        permissions: ['read:public'],
        jsRequired: true,
        authRequired: false,
        rateLimitTag: new URL(url).hostname,
        createdAt: now,
        updatedAt: now,
        author: 'auto-discover',
        tags: ['auto-generated'],
      },
      steps: discovery.action_plan || [],
    };
    recipe.meta.hash = hashRecipe(recipe);
    return recipe;
  }
}

export const AWI = new AWISDK();

export { RecipeRegistry, LocalExecutor, NativeExecutor, DOMExtractor, RecipeSync };
export { FileSystemDB, hashRecipe } from './db';
export { PolicyEnforcer, CapabilityManager, LocalRateLimiter, RecipeSigner, DEFAULT_POLICY } from './security';
export { SEED_RECIPES } from './seeds';
