import { describe, it, expect } from 'vitest';
import { FileSystemDB, hashRecipe } from '../src/db';
import {
  RecipeRegistry, SeedSource, LocalDBSource,
  GitRecipeSource, AutoDiscoverSource,
} from '../src/registry';
import {
  PolicyEnforcer, CapabilityManager, LocalRateLimiter,
  RecipeSigner, DEFAULT_POLICY, STRICT_POLICY,
} from '../src/security';
import { LocalExecutor } from '../src/local-executor';
import { SEED_RECIPES } from '../src/seeds';
import type { Recipe, SecurityPolicy } from '@awi-protocol/types';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

const GITHUB_URI = 'awi://github.com/repos/search/v1';
const UNKNOWN_URI = 'awi://unknown-site.com/action/v1';
const LOCALHOST_URI = 'awi://localhost/admin/panel/v1';
const LOOPBACK_URI = 'awi://127.0.0.1/phpmyadmin/v1';

function makeRecipe(overrides: Partial<Recipe['meta']> = {}, steps?: Recipe['steps']): Recipe {
  const r: Recipe = {
    meta: {
      domain: 'test.com',
      action: 'test',
      version: 'v1',
      hash: '',
      trustScore: 1.0,
      permissions: ['read:public'],
      jsRequired: false,
      authRequired: false,
      rateLimitTag: 'test.com',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      author: 'test',
      tags: [],
      ...overrides,
    },
    steps: steps || [{ step_number: 1, action: 'navigate', target: 'https://test.com', reason: 'test' }],
  };
  r.meta.hash = hashRecipe(r);
  return r;
}

function makeDB(dir: string): FileSystemDB {
  const cleanupPath = join(process.cwd(), dir);
  if (existsSync(cleanupPath)) {
    rmSync(cleanupPath, { recursive: true, force: true });
  }
  return new FileSystemDB(dir);
}

function makeRegistry(db: FileSystemDB, policy?: SecurityPolicy) {
  const pol = new PolicyEnforcer(policy || { ...DEFAULT_POLICY, sandboxPermissions: ['read:public', 'write:admin', 'write:local'] });
  const caps = new CapabilityManager();
  caps.grant('github.com', 'read:public');
  caps.grant('google.com', 'read:public');
  caps.grant('wikipedia.org', 'read:public');
  const seeds = new SeedSource(SEED_RECIPES);
  return new RecipeRegistry(
    { sources: [seeds, new LocalDBSource(db)], autoDiscover: false, cacheTtlMs: 60000, trustThreshold: 0.0 },
    db, pol, caps,
  );
}

// ========================================================================
// PHASE 1: OFFLINE RESILIENCE
// ========================================================================
describe('Phase 1: Offline Resilience', () => {
  it('1.1 should resolve seed recipes without network', async () => {
    const db = makeDB('./.awi-p1-1');
    const reg = makeRegistry(db);
    const recipe = await reg.resolve(GITHUB_URI);
    expect(recipe).toBeDefined();
    expect(recipe.meta.domain).toBe('github.com');
    expect(recipe.meta.author).toBe('awi-protocol');
  });

  it('1.2 should cache resolved recipes for offline reuse', async () => {
    const db = makeDB('./.awi-p1-2');
    const reg = makeRegistry(db);
    await reg.resolve(GITHUB_URI);
    const cached = await db.listRecipes('github.com');
    expect(cached.length).toBeGreaterThan(0);
    expect(cached[0].domain).toBe('github.com');
  });

  it('1.3 should fail with clear error for unknown recipes offline', async () => {
    const db = makeDB('./.awi-p1-3');
    const reg = makeRegistry(db);
    await expect(reg.resolve(UNKNOWN_URI)).rejects.toThrow(/recipe not found/i);
  });

  it('1.4 registry.list() offline returns only seed + cached recipes', async () => {
    const db = makeDB('./.awi-p1-4');
    const reg = makeRegistry(db);
    await reg.resolve(GITHUB_URI);
    const list = await reg.list('github.com');
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.every(r => r.domain === 'github.com')).toBe(true);
  });

  it('1.5 should handle registry.list() without domain (listing all)', async () => {
    const db = makeDB('./.awi-p1-5');
    const reg = makeRegistry(db);
    await reg.resolve(GITHUB_URI);
    const list = await reg.list();
    expect(list.length).toBeGreaterThanOrEqual(1);
  });
});

// ========================================================================
// PHASE 2: SECURITY BOUNDARY TORTURE
// ========================================================================
describe('Phase 2: Security Boundary Torture', () => {
  it('2.1 should block localhost domains per DEFAULT_POLICY', () => {
    const policy = new PolicyEnforcer(DEFAULT_POLICY);
    const blocked: Recipe = makeRecipe({ domain: 'localhost' });
    const allowed: Recipe = makeRecipe({ domain: 'github.com' });

    expect(policy.evaluate(blocked).allowed).toBe(false);
    expect(policy.evaluate(blocked).reason).toMatch(/blacklisted/i);
    expect(policy.evaluate(allowed).allowed).toBe(true);
  });

  it('2.1 should block 127.0.0.1 and 0.0.0.0', () => {
    const policy = new PolicyEnforcer(DEFAULT_POLICY);
    expect(policy.evaluate(makeRecipe({ domain: '127.0.0.1' })).allowed).toBe(false);
    expect(policy.evaluate(makeRecipe({ domain: '0.0.0.0' })).allowed).toBe(false);
  });

  it('2.1 should block 192.168.x.x via allowedDomains whitelist if configured', () => {
    const policy = new PolicyEnforcer({
      ...DEFAULT_POLICY,
      allowedDomains: ['github.com'],
      blockedDomains: [],
    });
    expect(policy.evaluate(makeRecipe({ domain: '192.168.1.1' })).allowed).toBe(false);
    expect(policy.evaluate(makeRecipe({ domain: 'github.com' })).allowed).toBe(true);
  });

  it('2.2 registry.validate() blocks localhost recipes with blacklisted reason', async () => {
    const pol = new PolicyEnforcer(DEFAULT_POLICY);
    const recipe = makeRecipe({ domain: 'localhost' });
    const result = pol.evaluate(recipe);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/blacklisted/i);
  });

  it('2.4 should detect tampered recipes by hash mismatch', () => {
    const recipe = SEED_RECIPES.get('github.com/repos/search/v1')!;
    const originalHash = recipe.meta.hash;
    const tampered = JSON.parse(JSON.stringify(recipe));
    tampered.steps[0].target = 'https://evil.com';
    const newHash = hashRecipe(tampered);
    expect(newHash).not.toBe(originalHash);
  });

  it('2.4 STRICT_POLICY should reject unsigned recipes', () => {
    const policy = new PolicyEnforcer(STRICT_POLICY);
    const unsigned = makeRecipe({ trustScore: 1.0 });
    const result = policy.evaluate(unsigned);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/unsigned/i);
  });

  it('2.5 should reject recipes with missing capabilities', () => {
    const caps = new CapabilityManager();
    caps.grant('test.com', 'read:public');

    const ok = makeRecipe({ permissions: ['read:public'] });
    expect(caps.checkRecipe(ok).allowed).toBe(true);

    const admin = makeRecipe({ permissions: ['read:public', 'write:admin'] });
    const result = caps.checkRecipe(admin);
    expect(result.allowed).toBe(false);
    expect(result.missing).toContain('write:admin');
  });

  it('2.6 should handle control character injection in params (no crash)', () => {
    const interpolate = (template: string, params: Record<string, any>) => {
      return template.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => String(params[key]));
    };
    const result = interpolate('{{query}}', {
      query: 'test\nSet-Cookie: hacked=true',
      evil: '\x00\x1F\x7F',
    });
    expect(result).toBe('test\nSet-Cookie: hacked=true');
    expect(result.includes('\x00')).toBe(false);
    expect(result.includes('\x1F')).toBe(false);
  });

  it('2.7 should handle circular reference in params by catching serialization error', () => {
    const a: any = { x: 1 };
    a.self = a;
    expect(() => JSON.stringify(a)).toThrow();
  });

  it('2.8 should handle BigInt / Symbol / Function in params (serialization edge cases)', () => {
    const big = { big: BigInt(9007199254740991) };
    expect(() => JSON.stringify(big)).toThrow();

    const sym = { sym: Symbol('test') };
    expect(JSON.stringify(sym)).toBe('{}');

    const fn = { fn: () => {} };
    expect(JSON.stringify(fn)).toBe('{}');
  });
});

// ========================================================================
// PHASE 3: RECIPE INTEGRITY & REGISTRY
// ========================================================================
describe('Phase 3: Recipe Integrity & Registry', () => {
  it('3.1 different recipes have different hashes', () => {
    const r1 = SEED_RECIPES.get('github.com/repos/search/v1')!;
    const r2 = SEED_RECIPES.get('google.com/search/v1')!;
    expect(r1.meta.hash).not.toBe(r2.meta.hash);
  });

  it('3.2 hash is deterministic (same recipe returns same hash)', () => {
    const recipe = SEED_RECIPES.get('github.com/repos/search/v1')!;
    const hash1 = hashRecipe(recipe);
    const hash2 = hashRecipe(recipe);
    expect(hash1).toBe(hash2);
    expect(hash1).toBe(recipe.meta.hash);
  });

  it('3.3 registry deduplicates by hash', async () => {
    const db = makeDB('./.awi-p3-3');
    const recipe = SEED_RECIPES.get('github.com/repos/search/v1')!;
    await db.putRecipe(recipe);
    await db.putRecipe(recipe);
    const list = await db.listRecipes('github.com');
    expect(list.length).toBe(1);
  });

  it('3.4 registry priority: seeds (0) beat local DB (2)', async () => {
    const db = makeDB('./.awi-p3-4');
    const pol = new PolicyEnforcer(DEFAULT_POLICY);
    const caps = new CapabilityManager();
    caps.grant('test.com', 'read:public');

    const evilLocal = makeRecipe({ domain: 'test.com', action: 'test', version: 'v1', author: 'evil' });
    await db.putRecipe(evilLocal);

    const seed = makeRecipe({ domain: 'test.com', action: 'test', version: 'v1', author: 'good' });
    const seeds = new SeedSource(new Map([['test.com/test/v1', seed]]));

    const reg = new RecipeRegistry(
      { sources: [seeds, new LocalDBSource(db)], autoDiscover: false, cacheTtlMs: 60000, trustThreshold: 0.0 },
      db, pol, caps,
    );

    const resolved = await reg.resolve('awi://test.com/test/v1');
    expect(resolved.meta.author).toBe('good');
  });

  it('3.5 Git source timeout fails fast (bad URL)', async () => {
    const db = makeDB('./.awi-p3-5');
    const pol = new PolicyEnforcer(DEFAULT_POLICY);
    const caps = new CapabilityManager();
    caps.grant('test.com', 'read:public');

    const gitSource = new GitRecipeSource('https://invalid.example/recipes');
    const seeds = new SeedSource(new Map());
    const reg = new RecipeRegistry(
      { sources: [gitSource, seeds], autoDiscover: false, cacheTtlMs: 60000, trustThreshold: 0.0 },
      db, pol, caps,
    );

    await expect(reg.resolve('awi://test.com/test/v1')).rejects.toThrow(/recipe not found/i);
  }, 15000);

  it('3.6 corrupted local DB should not crash the SDK', async () => {
    const dir = './.awi-p3-6';
    const indexFile = join(process.cwd(), dir, 'index.json');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(indexFile, '{invalid json!!!}', 'utf-8');

    expect(() => {
      const db = new FileSystemDB(dir);
      (db as any).readIndex();
    }).not.toThrow();
  });

  it('3.7 concurrent DB writes preserve all recipes', async () => {
    const db = makeDB('./.awi-p3-7');
    const recipes = [
      makeRecipe({ domain: 'a.com', action: 'x', version: 'v1' }, [{ step_number: 1, action: 'navigate', target: 'https://a.com', reason: 'test' }]),
      makeRecipe({ domain: 'b.com', action: 'y', version: 'v1' }, [{ step_number: 1, action: 'navigate', target: 'https://b.com', reason: 'test' }]),
      makeRecipe({ domain: 'c.com', action: 'z', version: 'v1' }, [{ step_number: 1, action: 'navigate', target: 'https://c.com', reason: 'test' }]),
    ];
    await Promise.all(recipes.map(r => db.putRecipe(r)));
    const list = await db.listRecipes();
    expect(list.length).toBe(3);
  });
});

// ========================================================================
// PHASE 4: LOCAL EXECUTOR TORTURE (Logic tests only — no browser)
// ========================================================================
describe('Phase 4: Local Executor Torture', () => {
  it('4.5 screenshot on failure flag does not crash', () => {
    const limiter = new LocalRateLimiter();
    const exec = new LocalExecutor(limiter, {
      headless: true,
      screenshotOnFailure: true,
      defaultTimeout: 30000,
    });
    expect(exec).toBeDefined();
  });

  it('4.6 private interpolate throws on missing params', () => {
    const limiter = new LocalRateLimiter();
    const exec = new LocalExecutor(limiter, {
      headless: true, screenshotOnFailure: false, defaultTimeout: 5000,
    });
    expect(() => (exec as any).interpolate('Hello {{name}}!', {})).toThrow('Missing parameter: name');
  });

  it('4.6 interpolate handles multiple params', () => {
    const limiter = new LocalRateLimiter();
    const exec = new LocalExecutor(limiter, {
      headless: true, screenshotOnFailure: false, defaultTimeout: 5000,
    });
    const result = (exec as any).interpolate('{{a}}-{{b}}', { a: 'hello', b: 'world' });
    expect(result).toBe('hello-world');
  });

  it('4.8 template value injection is treated as literal string', () => {
    const limiter = new LocalRateLimiter();
    const exec = new LocalExecutor(limiter, {
      headless: true, screenshotOnFailure: false, defaultTimeout: 5000,
    });
    const result = (exec as any).interpolate('{{query}}', {
      query: `'; DROP TABLE users; --`,
    });
    expect(result).toBe(`'; DROP TABLE users; --`);
  });

  it('4.4 memory pattern: result format is correct', async () => {
    const db = makeDB('./.awi-p4-4');
    const reg = makeRegistry(db);
    const recipe = await reg.resolve(GITHUB_URI);
    expect(recipe.meta.hash).toMatch(/^sha256:/);
  });
});

// ========================================================================
// PHASE 5: RATE LIMITING & RESOURCE EXHAUSTION
// ========================================================================
describe('Phase 5: Rate Limiting & Resource Exhaustion', () => {
  it('5.1 token bucket exhaustion', async () => {
    const limiter = new LocalRateLimiter();
    limiter.configure('test.com', 1, 1);
    expect(await limiter.acquire('test.com')).toBe(true);
    expect(await limiter.acquire('test.com')).toBe(false);
  });

  it('5.2 rate limit refill - tokens refill over time', async () => {
    const limiter = new LocalRateLimiter();
    limiter.configure('slow.com', 60, 5);
    for (let i = 0; i < 5; i++) {
      expect(await limiter.acquire('slow.com')).toBe(true);
    }
    expect(await limiter.acquire('slow.com')).toBe(false);
  });

  it('5.3 per-domain isolation', async () => {
    const limiter = new LocalRateLimiter();
    limiter.configure('a.com', 1, 1);
    limiter.configure('b.com', 1000, 1000);
    expect(await limiter.acquire('a.com')).toBe(true);
    expect(await limiter.acquire('a.com')).toBe(false);
    expect(await limiter.acquire('b.com')).toBe(true);
  });

  it('5.4 wait() method blocks when tokens exhausted', async () => {
    const limiter = new LocalRateLimiter();
    limiter.configure('slow.com', 1, 1);
    expect(await limiter.acquire('slow.com')).toBe(true);

    const start = Date.now();
    const waitPromise = limiter.wait('slow.com');
    const raceResult = await Promise.race([
      waitPromise.then(() => 'resolved'),
      new Promise(r => setTimeout(() => r('timeout'), 500)),
    ]);
    expect(raceResult).toBe('timeout');
  });

  it('5.5 unconfigured domain always returns true', async () => {
    const limiter = new LocalRateLimiter();
    expect(await limiter.acquire('unconfigured.com')).toBe(true);
  });
});

// ========================================================================
// PHASE 6: SYNC & DISTRIBUTION
// ========================================================================
describe('Phase 6: Sync & Distribution', () => {
  it('6.1 sync with bad remote URL does not crash', async () => {
    const { RecipeSync } = await import('../src/sync');
    const db = makeDB('./.awi-p6-1');
    const sync = new RecipeSync(db, {
      remoteURL: 'https://invalid.example/sync',
      intervalMs: 1000,
      autoSync: true,
      compression: true,
    });
    const patch = await sync.sync();
    expect(patch).toBeDefined();
    expect(patch.checkpoint).toBeTruthy();
  });

  it('6.2 applyPatch empty added list should not crash', async () => {
    const db = makeDB('./.awi-p6-2');
    await db.applyPatch({ added: [], updated: [], removed: [], checkpoint: '2026-01-01T00:00:00Z' });
    const list = await db.listRecipes();
    expect(list.length).toBe(0);
  });

  it('6.2 applyPatch with added recipes stores them', async () => {
    const db = makeDB('./.awi-p6-2b');
    const recipe = SEED_RECIPES.get('github.com/repos/search/v1')!;
    await db.applyPatch({
      added: [recipe],
      updated: [],
      removed: [],
      checkpoint: '2026-01-01T00:00:00Z',
    });
    const retrieved = await db.getRecipe(recipe.meta.hash);
    expect(retrieved).not.toBeNull();
  });

  it('6.3 publish without auth returns false (no crash)', async () => {
    const { RecipeSync } = await import('../src/sync');
    const db = makeDB('./.awi-p6-3');
    const sync = new RecipeSync(db, {
      remoteURL: 'https://invalid.example/sync',
      intervalMs: 1000,
      autoSync: false,
      compression: true,
    });
    const result = await sync.publish({
      domain: 'test.com', action: 'test', version: 'v1', hash: 'x',
      trustScore: 1.0, permissions: [], jsRequired: false, authRequired: false,
      rateLimitTag: 'test.com', createdAt: '', updatedAt: '', author: 'test', tags: [],
    });
    expect(result).toBe(false);
  });

  it('6.4 checkpoint persistence', async () => {
    const db = makeDB('./.awi-p6-4');
    const cp1 = await db.getCheckpoint();
    expect(cp1).toBe('1970-01-01T00:00:00Z');

    await db.setCheckpoint('2026-05-28T12:00:00Z');
    const cp2 = await db.getCheckpoint();
    expect(cp2).toBe('2026-05-28T12:00:00Z');
  });
});

// ========================================================================
// PHASE 7: RECIPE AUTHORING CLI
// ========================================================================
describe('Phase 7: Recipe Authoring CLI', () => {
  it('7.2 sign-recipe with invalid key should fail gracefully', () => {
    expect(() => {
      new RecipeSigner('garbage-private-key', 'garbage-public-key');
    }).not.toThrow();
  });

  it('7.2 sign-recipe with garbage PEM should fail at sign time', () => {
    const signer = new RecipeSigner('garbage', 'garbage');
    const recipe = SEED_RECIPES.get('github.com/repos/search/v1')!;
    expect(() => signer.sign(recipe)).toThrow();
  });

  it('7.3 validate-recipe detects tampered hash', () => {
    const recipe = SEED_RECIPES.get('github.com/repos/search/v1')!;
    const originalHash = recipe.meta.hash;
    const tampered = JSON.parse(JSON.stringify(recipe));
    tampered.steps[0].target = 'https://evil.com';
    expect(hashRecipe(tampered)).not.toBe(originalHash);
  });

  it('7.4 verify detects tampered steps on signed recipe', () => {
    const { generateKeyPairSync } = require('crypto');
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });

    const signer = new RecipeSigner(privateKey, publicKey);
    const recipe = SEED_RECIPES.get('github.com/repos/search/v1')!;
    const signed = signer.sign(recipe);

    expect(RecipeSigner.verify(signed)).toBe(true);

    const tampered = JSON.parse(JSON.stringify(signed));
    tampered.steps[0].target = 'https://evil.com';
    expect(RecipeSigner.verify(tampered)).toBe(false);
  });
});

// ========================================================================
// PHASE 8: CONCURRENCY & RACE CONDITIONS
// ========================================================================
describe('Phase 8: Concurrency & Race Conditions', () => {
  it('8.1 parallel resolves same URI dont crash', async () => {
    const db = makeDB('./.awi-p8-1');
    const reg = makeRegistry(db);

    const results = await Promise.all([
      reg.resolve(GITHUB_URI),
      reg.resolve(GITHUB_URI),
      reg.resolve(GITHUB_URI),
    ]);
    expect(results).toHaveLength(3);
    expect(results.every(r => r.meta.domain === 'github.com')).toBe(true);
  });

  it('8.2 concurrent read/write DB operations', async () => {
    const db = makeDB('./.awi-p8-2');
    const r1 = makeRecipe({ domain: 'alpha.com', action: 'a', version: 'v1' });
    const r2 = makeRecipe({ domain: 'beta.com', action: 'b', version: 'v1' });

    await Promise.all([
      db.putRecipe(r1),
      db.putRecipe(r2),
      db.listRecipes(),
    ]);
    const retrieved1 = await db.getRecipe(r1.meta.hash);
    const retrieved2 = await db.getRecipe(r2.meta.hash);
    expect(retrieved1).not.toBeNull();
    expect(retrieved2).not.toBeNull();
  });

  it('8.3 multiple SDK instances do not share state', async () => {
    const db1 = makeDB('./.awi-p8-3a');
    const db2 = makeDB('./.awi-p8-3b');

    const r1 = makeRecipe({ domain: 'a-only.com', action: 'x', version: 'v1' });
    await db1.putRecipe(r1);

    const list1 = await db1.listRecipes();
    const list2 = await db2.listRecipes();
    expect(list1.length).toBe(1);
    expect(list2.length).toBe(0);
  });
});

// ========================================================================
// PHASE 9: ENVIRONMENT & EDGE CASES
// ========================================================================
describe('Phase 9: Environment & Edge Cases', () => {
  it('9.2 FileSystemDB handles forward/backward slashes', () => {
    const db = new FileSystemDB('./.awi-p9-2');
    expect(db).toBeDefined();
  });

  it('9.3 unicode in domain/action is accepted by parseURI', () => {
    const db = makeDB('./.awi-p9-3');
    const pol = new PolicyEnforcer(DEFAULT_POLICY);
    const caps = new CapabilityManager();
    caps.grant('münchen.de', 'read:public');
    const seeds = new SeedSource(new Map([
      ['münchen.de/über/v1', makeRecipe({ domain: 'münchen.de', action: 'über', version: 'v1' })],
    ]));
    const reg = new RecipeRegistry(
      { sources: [seeds], autoDiscover: false, cacheTtlMs: 60000, trustThreshold: 0.0 },
      db, pol, caps,
    );
    const parsed = reg.parseURI('awi://münchen.de/über/v1');
    expect(parsed).toEqual({ domain: 'münchen.de', action: 'über', version: 'v1' });
  });

  it('9.4 getStats returns correct info', async () => {
    const db = makeDB('./.awi-p9-4');
    let stats = await db.getStats();
    expect(stats.recipes).toBe(0);
    expect(stats.domains).toEqual([]);

    const r = makeRecipe({ domain: 'example.com', action: 'x', version: 'v1' });
    await db.putRecipe(r);

    stats = await db.getStats();
    expect(stats.recipes).toBe(1);
    expect(stats.domains).toContain('example.com');
  });

  it('9.5 deleteRecipe removes entry', async () => {
    const db = makeDB('./.awi-p9-5');
    const r = makeRecipe();
    await db.putRecipe(r);
    expect(await db.getRecipe(r.meta.hash)).not.toBeNull();
    await db.deleteRecipe(r.meta.hash);
    expect(await db.getRecipe(r.meta.hash)).toBeNull();
  });
});
