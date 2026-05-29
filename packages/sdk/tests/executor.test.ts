import { describe, it, expect, vi } from 'vitest';
import { LocalExecutor } from '../src/local-executor';
import { LocalRateLimiter } from '../src/security';
import type { Recipe } from '@awi-protocol/types';

describe('LocalExecutor', () => {
  const limiter = new LocalRateLimiter();
  const executor = new LocalExecutor(limiter, {
    headless: true,
    screenshotOnFailure: false,
    defaultTimeout: 5000,
  });

  it('should interpolate template parameters', () => {
    const result = (executor as any).interpolate('Hello {{name}}!', { name: 'World' });
    expect(result).toBe('Hello World!');
  });

  it('should throw on missing parameters', () => {
    expect(() => {
      (executor as any).interpolate('Hello {{name}}!', {});
    }).toThrow('Missing parameter: name');
  });

  it('should handle recipes with no steps', async () => {
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

    limiter.configure('test.com', 9999, 9999);
    expect(emptyRecipe.steps).toEqual([]);
  });
});

describe('RateLimiter integration', () => {
  it('should throttle execution', async () => {
    const limiter = new LocalRateLimiter();
    limiter.configure('slow.com', 1, 1);

    const exec = new LocalExecutor(limiter, {
      headless: true,
      screenshotOnFailure: false,
      defaultTimeout: 5000,
    });

    expect(await limiter.acquire('slow.com')).toBe(true);
    expect(await limiter.acquire('slow.com')).toBe(false);
  });
});
