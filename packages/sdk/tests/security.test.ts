import { describe, it, expect, beforeEach } from 'vitest';
import {
  RecipeSigner,
  CapabilityManager,
  PolicyEnforcer,
  LocalRateLimiter,
  DEFAULT_POLICY,
  STRICT_POLICY,
} from '../src/security';
import { hashRecipe } from '../src/db';
import type { Recipe } from '@awi-protocol/types';

const TEST_RECIPE: Recipe = {
  meta: {
    domain: 'example.com',
    action: 'test',
    version: 'v1',
    hash: '',
    trustScore: 0.9,
    permissions: ['read:public'],
    jsRequired: false,
    authRequired: false,
    rateLimitTag: 'example.com',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    author: 'test',
    tags: [],
  },
  steps: [
    { step_number: 1, action: 'navigate', target: 'https://example.com', reason: 'test' },
  ],
};

TEST_RECIPE.meta.hash = hashRecipe(TEST_RECIPE);

describe('RecipeSigner', () => {
  it('should sign and verify a recipe', () => {
    const { generateKeyPairSync } = require('crypto');
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const signer = new RecipeSigner(privateKey, publicKey);
    const signed = signer.sign(TEST_RECIPE);
    expect(signed.meta.signature).toBeDefined();
    expect(signed.meta.publicKey).toBe(publicKey);

    const verified = RecipeSigner.verify(signed);
    expect(verified).toBe(true);
  });

  it('should detect tampered recipes', () => {
    const result = RecipeSigner.verify(TEST_RECIPE);
    expect(result).toBe(false);
  });
});

describe('CapabilityManager', () => {
  let caps: CapabilityManager;

  beforeEach(() => {
    caps = new CapabilityManager();
  });

  it('should grant and check capabilities', () => {
    caps.grant('github.com', 'read:public');
    expect(caps.check('github.com', 'read:public')).toBe(true);
    expect(caps.check('github.com', 'write:issues')).toBe(false);
  });

  it('should expire capabilities', () => {
    caps.grant('github.com', 'read:public', -1);
    expect(caps.check('github.com', 'read:public')).toBe(false);
  });

  it('should check recipe permissions', () => {
    caps.grant('example.com', 'read:public');
    const result = caps.checkRecipe(TEST_RECIPE);
    expect(result.allowed).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('should report missing permissions', () => {
    const evilRecipe: Recipe = {
      ...TEST_RECIPE,
      meta: { ...TEST_RECIPE.meta, permissions: ['read:public', 'write:admin'] },
    };
    const result = caps.checkRecipe(evilRecipe);
    expect(result.allowed).toBe(false);
    expect(result.missing).toContain('write:admin');
  });
});

describe('PolicyEnforcer', () => {
  it('should allow trusted recipes by default', () => {
    const enforcer = new PolicyEnforcer(DEFAULT_POLICY);
    const result = enforcer.evaluate(TEST_RECIPE);
    expect(result.allowed).toBe(true);
  });

  it('should block blacklisted domains', () => {
    const enforcer = new PolicyEnforcer(DEFAULT_POLICY);
    const blocked: Recipe = {
      ...TEST_RECIPE,
      meta: { ...TEST_RECIPE.meta, domain: 'localhost' },
    };
    const result = enforcer.evaluate(blocked);
    expect(result.allowed).toBe(false);
  });

  it('should enforce strict policy', () => {
    const enforcer = new PolicyEnforcer(STRICT_POLICY);
    const unsigned = { ...TEST_RECIPE, meta: { ...TEST_RECIPE.meta, signature: undefined } };
    const result = enforcer.evaluate(unsigned);
    expect(result.allowed).toBe(false);
  });

  it('should block low-trust auto-generated recipes in strict mode', () => {
    const enforcer = new PolicyEnforcer(STRICT_POLICY);
    const auto: Recipe = {
      ...TEST_RECIPE,
      meta: { ...TEST_RECIPE.meta, trustScore: 0.0 },
    };
    const result = enforcer.evaluate(auto);
    expect(result.allowed).toBe(false);
  });
});

describe('LocalRateLimiter', () => {
  it('should allow requests under limit', async () => {
    const limiter = new LocalRateLimiter();
    limiter.configure('test.com', 60, 10);
    const allowed = await limiter.acquire('test.com');
    expect(allowed).toBe(true);
  });

  it('should block requests over burst limit', async () => {
    const limiter = new LocalRateLimiter();
    limiter.configure('test.com', 60, 1);
    await limiter.acquire('test.com');
    const blocked = await limiter.acquire('test.com');
    expect(blocked).toBe(false);
  });

  it('should refill tokens over time', async () => {
    const limiter = new LocalRateLimiter();
    limiter.configure('test.com', 1, 1); // 1 per minute
    await limiter.acquire('test.com');
    await new Promise(r => setTimeout(r, 100));
    const blocked = await limiter.acquire('test.com');
    expect(blocked).toBe(false);
  });
});
