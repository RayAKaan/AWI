import { describe, it, expect, beforeEach } from 'vitest';
import { FileSystemDB, hashRecipe } from '../src/db';
import type { Recipe } from '@awi-protocol/types';

const TEST_RECIPE: Recipe = {
  meta: {
    domain: 'test.com',
    action: 'test',
    version: 'v1',
    hash: '',
    trustScore: 0.5,
    permissions: ['read:public'],
    jsRequired: false,
    authRequired: false,
    rateLimitTag: 'test.com',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    author: 'test',
    tags: [],
  },
  steps: [{ step_number: 1, action: 'navigate', target: 'https://test.com', reason: 'test' }],
};

TEST_RECIPE.meta.hash = hashRecipe(TEST_RECIPE);

describe('FileSystemDB', () => {
  let db: FileSystemDB;

  beforeEach(() => {
    db = new FileSystemDB('./.awi-test-db');
  });

  it('should store and retrieve recipes', async () => {
    await db.putRecipe(TEST_RECIPE);
    const retrieved = await db.getRecipe(TEST_RECIPE.meta.hash);
    expect(retrieved).toEqual(TEST_RECIPE);
  });

  it('should return null for missing recipes', async () => {
    const result = await db.getRecipe('sha256:nonexistent');
    expect(result).toBeNull();
  });

  it('should list recipes by domain', async () => {
    await db.putRecipe(TEST_RECIPE);
    const list = await db.listRecipes('test.com');
    expect(list.length).toBe(1);
    expect(list[0].domain).toBe('test.com');
  });

  it('should return empty list for unknown domain', async () => {
    const list = await db.listRecipes('nonexistent.com');
    expect(list).toEqual([]);
  });

  it('should delete recipes', async () => {
    await db.putRecipe(TEST_RECIPE);
    await db.deleteRecipe(TEST_RECIPE.meta.hash);
    const result = await db.getRecipe(TEST_RECIPE.meta.hash);
    expect(result).toBeNull();
  });

  it('should compute consistent hashes', () => {
    const hash1 = hashRecipe(TEST_RECIPE);
    const hash2 = hashRecipe(TEST_RECIPE);
    expect(hash1).toBe(hash2);
  });

  it('should detect hash changes when steps change', () => {
    const original = hashRecipe(TEST_RECIPE);
    const modified = { ...TEST_RECIPE, steps: [{ ...TEST_RECIPE.steps[0], target: 'https://evil.com' }] };
    const newHash = hashRecipe(modified);
    expect(newHash).not.toBe(original);
  });
});
