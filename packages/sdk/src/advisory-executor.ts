/**
 * Advisory Mode Executor
 * 
 * Executes recipe blueprints locally in a browser or Node.js environment.
 * Useful when you want to control the browser yourself but use AWI selectors.
 */

import type { Recipe, RecipeStep, SelectorSet, ExecutionMetrics } from './types';

export interface LocalExecutionContext {
  document: Document;
  window: Window;
  console: Console;
}

export class AdvisoryExecutor {
  private context: LocalExecutionContext;
  private metrics: ExecutionMetrics;

  constructor(context: LocalExecutionContext) {
    this.context = context;
    this.metrics = {
      latency_ms: 0,
      fallback_count: 0,
      selectors_used: [],
      cache_status: 'bypass',
    };
  }

  /**
   * Execute a recipe blueprint locally.
   */
  async execute<T = unknown>(recipe: Recipe, params: Record<string, unknown>): Promise<{
    success: boolean;
    data: T | null;
    errors: Array<{ code: string; message: string }>;
    metrics: ExecutionMetrics;
  }> {
    const startTime = Date.now();
    const errors: Array<{ code: string; message: string }> = [];
    const executionPath: string[] = [];

    try {
      // Execute steps
      for (const step of recipe.steps) {
        const stepResult = await this._executeStep(step, params, recipe);

        if (stepResult.error) {
          errors.push(stepResult.error);
          break;
        }

        executionPath.push(`${step.type}:${step.name || 'unnamed'}`);
      }

      // Extract data if all steps passed
      let data: T | null = null;
      if (errors.length === 0 && recipe.extraction) {
        data = await this._extractData<T>(recipe);
      }

      this.metrics.latency_ms = Date.now() - startTime;

      return {
        success: errors.length === 0,
        data,
        errors,
        metrics: { ...this.metrics },
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        errors: [{
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        }],
        metrics: { ...this.metrics },
      };
    }
  }

  private async _executeStep(
    step: RecipeStep,
    params: Record<string, unknown>,
    recipe: Recipe
  ): Promise<{ error?: { code: string; message: string } }> {
    try {
      switch (step.type) {
        case 'navigate':
          if (step.url) {
            const url = this._interpolate(step.url, params);
            this.context.window.location.href = url;
          }
          break;

        case 'wait':
          if (step.selector) {
            const selectorSet = recipe.selectors[step.selector];
            if (selectorSet) {
              await this._waitForSelector(selectorSet);
            }
          } else {
            await this._sleep(1000);
          }
          break;

        case 'click':
          if (step.selector) {
            const element = this._resolveSelector(recipe.selectors[step.selector]);
            if (element) {
              element.click();
            } else {
              return { error: { code: 'CLICK_FAILED', message: `Selector not found: ${step.selector}` } };
            }
          }
          break;

        case 'type':
          if (step.selector && step.value) {
            const element = this._resolveSelector(recipe.selectors[step.selector]) as HTMLInputElement | null;
            if (element) {
              const value = this._interpolate(step.value, params);
              element.value = value;
              element.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
              return { error: { code: 'TYPE_FAILED', message: `Selector not found: ${step.selector}` } };
            }
          }
          break;

        case 'scroll':
          const amount = step.amount || 500;
          this.context.window.scrollBy(0, amount);
          break;

        case 'extract_list':
        case 'extract_one':
          // Extraction happens after all steps
          break;
      }

      return {};
    } catch (error) {
      return {
        error: {
          code: 'STEP_ERROR',
          message: error instanceof Error ? error.message : 'Unknown step error',
        },
      };
    }
  }

  private async _extractData<T>(recipe: Recipe): Promise<T | null> {
    const extraction = recipe.extraction;
    if (!extraction) return null;

    const containerSet = recipe.selectors[extraction.container];
    if (!containerSet) return null;

    const container = this._resolveSelector(containerSet);
    if (!container) return null;

    const items = extraction.mode === 'list' 
      ? Array.from(container.children)
      : [container];

    const results: Array<Record<string, unknown>> = [];

    for (const item of items) {
      const record: Record<string, unknown> = {};

      for (const field of extraction.fields) {
        const fieldSet = recipe.selectors[field.selector];
        if (fieldSet) {
          const fieldElement = this._resolveSelectorWithin(item as HTMLElement, fieldSet);
          if (fieldElement) {
            let value = fieldElement.textContent || '';

            // Apply transform
            if (field.transform) {
              value = String(this._applyTransform(value, field.transform));
            }

            record[field.name] = value;
          } else {
            record[field.name] = null;
          }
        }
      }

      results.push(record);
    }

    return (extraction.mode === 'one' ? results[0] : results) as T;
  }

  private _resolveSelector(selectorSet: SelectorSet): HTMLElement | null {
    for (const selector of selectorSet.selectors) {
      const element = this._trySelector(selector.type, selector.value);
      if (element) {
        this.metrics.selectors_used.push(selectorSet.name);
        return element;
      }
      this.metrics.fallback_count++;
    }
    return null;
  }

  private _resolveSelectorWithin(parent: HTMLElement, selectorSet: SelectorSet): HTMLElement | null {
    for (const selector of selectorSet.selectors) {
      try {
        const element = parent.querySelector(selector.value) as HTMLElement | null;
        if (element) {
          this.metrics.selectors_used.push(selectorSet.name);
          return element;
        }
      } catch {
        // Invalid selector, try next
      }
    }
    return null;
  }

  private _trySelector(type: string, value: string): HTMLElement | null {
    try {
      switch (type) {
        case 'css':
          return this.context.document.querySelector(value) as HTMLElement | null;
        case 'semantic':
          // Try data-testid
          return this.context.document.querySelector(`[data-testid="${value}"]`) as HTMLElement | null;
        case 'text':
          // XPath or text content search
          const xpath = `//*[contains(text(), "${value}")]`;
          const result = this.context.document.evaluate(
            xpath,
            this.context.document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
          );
          return result.singleNodeValue as HTMLElement | null;
        case 'attribute':
          return this.context.document.querySelector(`[${value}]`) as HTMLElement | null;
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  private async _waitForSelector(selectorSet: SelectorSet, timeout: number = 10000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (this._resolveSelector(selectorSet)) {
        return;
      }
      await this._sleep(100);
    }
    throw new Error(`Timeout waiting for selector: ${selectorSet.name}`);
  }

  private _interpolate(template: string, params: Record<string, unknown>): string {
    return template.replace(/\{([^}]+)\}/g, (match, key) => {
      const value = params[key];
      return value !== undefined ? String(value) : match;
    });
  }

  private _applyTransform(value: string, transform: string): string | number {
    switch (transform) {
      case 'strip':
        return value.trim();
      case 'strip_currency':
        return value.replace(/[$€,\s]/g, '').trim();
      case 'number':
        const digits = value.replace(/[^0-9.]/g, '');
        return digits.includes('.') ? parseFloat(digits) : parseInt(digits, 10);
      case 'lower':
        return value.toLowerCase();
      case 'upper':
        return value.toUpperCase();
      default:
        return value;
    }
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default AdvisoryExecutor;
