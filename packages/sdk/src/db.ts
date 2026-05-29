import type { Recipe, RecipeMeta, SyncPatch } from '@awi-protocol/types';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface DBAdapter {
  getRecipe(hash: string): Promise<Recipe | null>;
  putRecipe(recipe: Recipe): Promise<void>;
  listRecipes(domain?: string): Promise<RecipeMeta[]>;
  deleteRecipe(hash: string): Promise<void>;
  getCheckpoint(): Promise<string>;
  setCheckpoint(checkpoint: string): Promise<void>;
  applyPatch(patch: SyncPatch): Promise<void>;
  getStats(): Promise<{ recipes: number; domains: string[]; lastSync: string | null }>;
}

export class FileSystemDB implements DBAdapter {
  private indexPath: string;
  private checkpointPath: string;

  constructor(dataDir: string = './.awi') {
    this.indexPath = join(dataDir, 'index.json');
    this.checkpointPath = join(dataDir, 'checkpoint.txt');
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  }

  private readIndex(): Record<string, Recipe> {
    if (!existsSync(this.indexPath)) return {};
    try {
      return JSON.parse(readFileSync(this.indexPath, 'utf-8'));
    } catch {
      console.warn('[AWI DB] Corrupted index.json — resetting');
      return {};
    }
  }

  private writeIndex(index: Record<string, Recipe>) {
    writeFileSync(this.indexPath, JSON.stringify(index, null, 2));
  }

  async getRecipe(hash: string): Promise<Recipe | null> {
    const index = this.readIndex();
    return index[hash] || null;
  }

  async putRecipe(recipe: Recipe): Promise<void> {
    const index = this.readIndex();
    index[recipe.meta.hash] = recipe;
    this.writeIndex(index);
  }

  async listRecipes(domain?: string): Promise<RecipeMeta[]> {
    const index = this.readIndex();
    const recipes = Object.values(index);
    const filtered = domain
      ? recipes.filter(r => r.meta.domain === domain)
      : recipes;
    return filtered.map(r => r.meta).sort((a, b) => b.trustScore - a.trustScore);
  }

  async deleteRecipe(hash: string): Promise<void> {
    const index = this.readIndex();
    delete index[hash];
    this.writeIndex(index);
  }

  async getCheckpoint(): Promise<string> {
    if (!existsSync(this.checkpointPath)) return '1970-01-01T00:00:00Z';
    return readFileSync(this.checkpointPath, 'utf-8').trim();
  }

  async setCheckpoint(checkpoint: string): Promise<void> {
    writeFileSync(this.checkpointPath, checkpoint);
  }

  async applyPatch(patch: SyncPatch): Promise<void> {
    const index = this.readIndex();
    for (const recipe of patch.added) {
      if (!index[recipe.meta.hash]) {
        index[recipe.meta.hash] = recipe;
      }
    }
    for (const hash of patch.removed) {
      delete index[hash];
    }
    this.writeIndex(index);
    await this.setCheckpoint(patch.checkpoint);
  }

  async getStats(): Promise<{ recipes: number; domains: string[]; lastSync: string | null }> {
    const index = this.readIndex();
    const recipes = Object.values(index);
    const domains = [...new Set(recipes.map(r => r.meta.domain))];
    const lastSync = existsSync(this.checkpointPath)
      ? readFileSync(this.checkpointPath, 'utf-8').trim()
      : null;
    return { recipes: recipes.length, domains, lastSync };
  }
}

export function hashRecipe(recipe: Recipe): string {
  const { hash, signature, publicKey, ...identity } = recipe.meta;
  const canonical = JSON.stringify({ ...identity, steps: recipe.steps }, (_, v) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v).sort().reduce((sorted, key) => {
        (sorted as Record<string, any>)[key] = v[key];
        return sorted;
      }, {} as Record<string, any>);
    }
    return v;
  });
  return 'sha256:' + createHash('sha256').update(canonical).digest('hex');
}
