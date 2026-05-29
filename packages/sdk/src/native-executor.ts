import type { Recipe, RecipeStep, ExecutionResult, ExecutionLog } from '@awi-protocol/types';
import { load as cheerioLoad } from 'cheerio';

export interface NativeExecutorConfig {
  timeout: number;
  headers?: Record<string, string>;
}

export class NativeExecutor {
  private config: NativeExecutorConfig;

  constructor(config: NativeExecutorConfig) {
    this.config = {
      timeout: config.timeout || 30000,
      headers: config.headers || {},
    };
  }

  supports(recipe: Recipe): boolean {
    if (recipe.meta.jsRequired) return false;
    for (const step of recipe.steps) {
      if (!this.isNativeAction(step.action)) return false;
    }
    return true;
  }

  private isNativeAction(action: string): boolean {
    return ['navigate', 'extract', 'wait', 'native_http'].includes(action);
  }

  async run(recipe: Recipe, params: Record<string, any> = {}): Promise<ExecutionResult> {
    const startedAt = new Date().toISOString();
    const logs: ExecutionLog[] = [];
    const errors: string[] = [];
    let lastHtml = '';
    let data: any = null;

    for (const step of recipe.steps) {
      const log = await this.executeStep(step, params, lastHtml);
      logs.push(log);

      if (log.success) {
        if (log.extracted !== undefined) {
          data = log.extracted;
        }
        if (log.html) {
          lastHtml = log.html;
        }
      } else {
        if (!step.optional) {
          errors.push(`Step ${step.step_number} failed: ${log.error}`);
          break;
        }
        errors.push(`Step ${step.step_number} failed (optional): ${log.error}`);
      }
    }

    const finishedAt = new Date().toISOString();
    const totalDurationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();

    return {
      success: errors.length === 0,
      data,
      logs,
      errors,
      metadata: {
        recipeURI: `awi://${recipe.meta.domain}/${recipe.meta.action}/${recipe.meta.version}`,
        recipeHash: recipe.meta.hash,
        startedAt,
        finishedAt,
        totalDurationMs,
        stepsCompleted: logs.filter(l => l.success).length,
        stepsTotal: recipe.steps.length,
      },
    };
  }

  private async executeStep(
    step: RecipeStep,
    params: Record<string, any>,
    lastHtml: string,
  ): Promise<ExecutionLog & { html?: string }> {
    const start = Date.now();
    const log: ExecutionLog & { html?: string } = {
      step: step.step_number,
      action: step.action,
      target: step.target || '',
      success: false,
      timestamp: start,
      durationMs: 0,
    };

    try {
      const resolvedValue = step.value ? this.interpolate(step.value, params) : undefined;
      const timeout = step.timeout || this.config.timeout;

      switch (step.action) {
        case 'navigate': {
          const url = resolvedValue || this.interpolate(step.target || '', params);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);
          const response = await fetch(url, {
            headers: { 'User-Agent': 'AWI-Agent/3.0 (Native)', ...this.config.headers },
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          log.html = await response.text();
          break;
        }

        case 'extract': {
          if (!lastHtml) throw new Error('No HTML loaded — navigate first');
          const $ = cheerioLoad(lastHtml);
          const selector = step.target || '';
          const elements: any[] = [];
          $(selector).each((_i: number, el: any) => {
            const $el = $(el);
            elements.push({
              text: $el.text().trim(),
              href: $el.attr('href') || undefined,
              html: $el.html()?.trim(),
            });
          });
          log.extracted = elements;
          break;
        }

        case 'wait': {
          const ms = parseInt(resolvedValue || '1000', 10);
          await new Promise(r => setTimeout(r, ms));
          break;
        }

        case 'native_http': {
          const endpoint = step.target || '';
          const method = (resolvedValue || 'GET').toUpperCase();
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);
          const response = await fetch(endpoint, {
            method,
            headers: { 'Content-Type': 'application/json', ...this.config.headers },
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          log.extracted = await response.json();
          break;
        }

        default:
          throw new Error(`Action '${step.action}' requires a browser — use LocalExecutor instead`);
      }

      log.success = true;
    } catch (err: any) {
      log.success = false;
      log.error = err.message;
    }

    log.durationMs = Date.now() - start;
    return log;
  }

  private interpolate(template: string, params: Record<string, any>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (!(key in params)) throw new Error(`Missing parameter: ${key}`);
      return String(params[key]);
    });
  }
}
