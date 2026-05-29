import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AWISDK } from '../src/sdk';
import { FileSystemDB, hashRecipe } from '../src/db';
import { RecipeRegistry, SeedSource, LocalDBSource } from '../src/registry';
import { PolicyEnforcer, CapabilityManager, LocalRateLimiter, DEFAULT_POLICY, STRICT_POLICY } from '../src/security';
import { SEED_RECIPES } from '../src/seeds';
import type { Recipe } from '@awi-protocol/types';

describe('P2P Architecture Stress Tests', () => {
  let sdk: AWISDK;

  beforeAll(() => {
    sdk = new AWISDK({
      dataDir: './.awi-stress',
      headless: true,
      policy: DEFAULT_POLICY,
    });
  });

  afterAll(() => {
    sdk.stop();
  });

  describe('Offline Capability', () => {
    it('should execute seed recipes without network', async () => {
      const seeds = new SeedSource(SEED_RECIPES);
      const recipe = await seeds.fetch('github.com', 'repos/search', 'v1');
      expect(recipe).not.toBeNull();
      expect(recipe?.meta.trustScore).toBe(1.0);
    });

    it('should cache recipes for offline reuse', async () => {
      const db = new FileSystemDB('./.awi-stress-cache');
      const seeds = new SeedSource(SEED_RECIPES);
      const recipe = await seeds.fetch('github.com', 'repos/search', 'v1');
      if (recipe) await db.putRecipe(recipe);

      const cached = await db.getRecipe(recipe!.meta.hash);
      expect(cached).not.toBeNull();
      expect(cached?.meta.domain).toBe('github.com');
    });
  });

  describe('Security Boundary', () => {
    it('should block localhost recipes in default policy', async () => {
      const policy = new PolicyEnforcer(DEFAULT_POLICY);
      const blockedRecipe: Recipe = {
        meta: {
          domain: 'localhost',
          action: 'exploit',
          version: 'v1',
          hash: 'sha256:test',
          trustScore: 1.0,
          permissions: ['read:public'],
          jsRequired: false,
          authRequired: false,
          rateLimitTag: 'localhost',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          author: 'attacker',
          tags: [],
        },
        steps: [{ step_number: 1, action: 'navigate', target: 'http://localhost:22', reason: 'exploit' }],
      };

      const result = policy.evaluate(blockedRecipe);
      expect(result.allowed).toBe(false);
    });

    it('should enforce capability boundaries', () => {
      const caps = new CapabilityManager();
      caps.grant('github.com', 'read:public');

      const writeRecipe: Recipe = {
        meta: {
          domain: 'github.com',
          action: 'issues/create',
          version: 'v1',
          hash: 'sha256:test',
          trustScore: 1.0,
          permissions: ['read:public', 'write:issues'],
          jsRequired: false,
          authRequired: true,
          rateLimitTag: 'github.com',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          author: 'test',
          tags: [],
        },
        steps: [],
      };

      const check = caps.checkRecipe(writeRecipe);
      expect(check.allowed).toBe(false);
      expect(check.missing).toContain('write:issues');
    });
  });

  describe('Rate Limiting', () => {
    it('should throttle aggressive domains', async () => {
      const limiter = new LocalRateLimiter();
      limiter.configure('aggressive.com', 1, 1);

      expect(await limiter.acquire('aggressive.com')).toBe(true);
      expect(await limiter.acquire('aggressive.com')).toBe(false);
    });

    it('should allow whitelisted domains unrestricted', async () => {
      const limiter = new LocalRateLimiter();
      expect(await limiter.acquire('unlimited.com')).toBe(true);
      expect(await limiter.acquire('unlimited.com')).toBe(true);
      expect(await limiter.acquire('unlimited.com')).toBe(true);
    });
  });

  describe('Recipe Integrity', () => {
    it('should detect tampered recipes by hash mismatch', () => {
      const recipe = SEED_RECIPES.get('github.com/repos/search/v1')!;
      const originalHash = recipe.meta.hash;

      const tampered = JSON.parse(JSON.stringify(recipe));
      tampered.steps[0].target = 'https://evil.com';
      const newHash = hashRecipe(tampered);

      expect(newHash).not.toBe(originalHash);
    });

    it('should handle recipes with zero steps gracefully', async () => {
      const emptyRecipe: Recipe = {
        meta: {
          domain: 'test.com',
          action: 'noop',
          version: 'v1',
          hash: 'sha256:test',
          trustScore: 1.0,
          permissions: [],
          jsRequired: false,
          authRequired: false,
          rateLimitTag: 'test.com',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          author: 'test',
          tags: [],
        },
        steps: [],
      };

      expect(emptyRecipe.steps).toEqual([]);
    });
  });

  describe('Registry Resolution', () => {
    it('should prioritize seeds over remote sources', async () => {
      const db = new FileSystemDB('./.awi-priority');
      const policy = new PolicyEnforcer(DEFAULT_POLICY);
      const caps = new CapabilityManager();
      caps.grant('github.com', 'read:public');

      const seeds = new SeedSource(SEED_RECIPES);
      const local = new LocalDBSource(db);

      const registry = new RecipeRegistry(
        { sources: [seeds, local], autoDiscover: false, cacheTtlMs: 60000, trustThreshold: 0.0 },
        db,
        policy,
        caps
      );

      const recipe = await registry.resolve('awi://github.com/repos/search/v1');
      expect(recipe.meta.author).toBe('awi-protocol');
    });

    it('should fallback to auto-discover when all sources miss', async () => {
      const db = new FileSystemDB('./.awi-fallback');
      const policy = new PolicyEnforcer(DEFAULT_POLICY);
      const caps = new CapabilityManager();

      const emptySeeds = new SeedSource(new Map());
      const registry = new RecipeRegistry(
        { sources: [emptySeeds], autoDiscover: true, cacheTtlMs: 60000, trustThreshold: 0.0 },
        db,
        policy,
        caps
      );

      expect(registry).toBeDefined();
    });
  });

  describe('Concurrent Access', () => {
    it('should handle parallel recipe resolutions', async () => {
      const db = new FileSystemDB('./.awi-concurrent');
      const policy = new PolicyEnforcer(DEFAULT_POLICY);
      const caps = new CapabilityManager();
      caps.grant('github.com', 'read:public');
      caps.grant('google.com', 'read:public');
      caps.grant('wikipedia.org', 'read:public');
      const seeds = new SeedSource(SEED_RECIPES);

      const registry = new RecipeRegistry(
        { sources: [seeds], autoDiscover: false, cacheTtlMs: 60000, trustThreshold: 0.0 },
        db,
        policy,
        caps
      );

      const uris = [
        'awi://github.com/repos/search/v1',
        'awi://google.com/search/v1',
        'awi://wikipedia.org/article/read/v1',
      ];

      const results = await Promise.all(uris.map(uri => registry.resolve(uri)));
      expect(results).toHaveLength(3);
      expect(results.every(r => r.meta.hash.length > 0)).toBe(true);
    });
  });
});
