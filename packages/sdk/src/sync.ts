import type { DBAdapter } from './db';
import type { SyncConfig, SyncPatch, RecipeMeta } from '@awi-protocol/types';

export class RecipeSync {
  private config: SyncConfig;
  private db: DBAdapter;
  private timer: NodeJS.Timeout | null = null;

  constructor(db: DBAdapter, config: SyncConfig) {
    this.db = db;
    this.config = {
      remoteURL: config.remoteURL || 'https://recipes.awi.network/sync',
      intervalMs: config.intervalMs || 300000,
      autoSync: config.autoSync !== false,
      compression: config.compression !== false,
    };
  }

  start(): void {
    if (!this.config.autoSync) return;
    this.sync();
    this.timer = setInterval(() => this.sync(), this.config.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async sync(): Promise<SyncPatch> {
    const checkpoint = await this.db.getCheckpoint();
    const url = new URL(this.config.remoteURL);
    url.searchParams.set('since', checkpoint);

    try {
      const res = await fetch(url.toString(), {
        headers: this.config.compression ? { 'Accept-Encoding': 'gzip' } : {},
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        throw new Error(`Sync failed: ${res.status}`);
      }

      const patch: SyncPatch = await res.json();
      await this.db.applyPatch(patch);
      return patch;
    } catch (err: any) {
      console.warn(`[AWI Sync] ${err.message}`);
      return { added: [], updated: [], removed: [], checkpoint };
    }
  }

  async publish(recipeMeta: RecipeMeta): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.remoteURL}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recipeMeta),
        signal: AbortSignal.timeout(30000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
