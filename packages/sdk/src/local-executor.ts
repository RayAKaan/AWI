import type { Recipe, RecipeStep, ExecutionResult, ExecutionLog } from '@awi-protocol/types';
import { LocalRateLimiter } from './security';

export interface ExecutorConfig {
  headless: boolean;
  screenshotOnFailure: boolean;
  defaultTimeout: number;
  userDataDir?: string;
}

export class LocalExecutor {
  private playwright: any;
  private rateLimiter: LocalRateLimiter;
  private config: ExecutorConfig;

  constructor(rateLimiter: LocalRateLimiter, config: ExecutorConfig) {
    this.rateLimiter = rateLimiter;
    this.config = {
      headless: config.headless !== false,
      screenshotOnFailure: config.screenshotOnFailure !== false,
      defaultTimeout: config.defaultTimeout || 30000,
      userDataDir: config.userDataDir,
    };
  }

  private async ensurePlaywright() {
    if (!this.playwright) {
      this.playwright = await import('playwright');
    }
    return this.playwright;
  }

  async run(recipe: Recipe, params: Record<string, any> = {}): Promise<ExecutionResult> {
    const pw = await this.ensurePlaywright();
    const startedAt = new Date().toISOString();
    const logs: ExecutionLog[] = [];
    const errors: string[] = [];
    let data: any = null;

    await this.rateLimiter.wait(recipe.meta.rateLimitTag);

    const browser = await pw.chromium.launch({
      headless: this.config.headless,
    });

    const context = await browser.newContext({
      userAgent: 'AWI-Agent/3.0 (Automated Web Interface)',
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();
    let stepsCompleted = 0;

    try {
      for (const step of recipe.steps) {
        const log = await this.executeStep(page, step, params, recipe.meta.domain);
        logs.push(log);

        if (!log.success) {
          if (!step.optional) {
            errors.push(`Step ${step.step_number} failed: ${log.error}`);
            break;
          }
          errors.push(`Step ${step.step_number} failed (optional): ${log.error}`);
        } else {
          stepsCompleted++;
          if (log.extracted !== undefined) {
            data = log.extracted;
          }
        }
      }
    } catch (err: any) {
      errors.push(`Fatal execution error: ${err.message}`);
    } finally {
      await context.close();
      await browser.close();
    }

    const finishedAt = new Date().toISOString();
    const totalDurationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();

    return {
      success: errors.length === 0 || (errors.length > 0 && stepsCompleted === recipe.steps.length),
      data,
      logs,
      errors,
      metadata: {
        recipeURI: `awi://${recipe.meta.domain}/${recipe.meta.action}/${recipe.meta.version}`,
        recipeHash: recipe.meta.hash,
        startedAt,
        finishedAt,
        totalDurationMs,
        stepsCompleted,
        stepsTotal: recipe.steps.length,
      },
    };
  }

  private async executeStep(
    page: any,
    step: RecipeStep,
    params: Record<string, any>,
    domain: string
  ): Promise<ExecutionLog> {
    const start = Date.now();
    const log: ExecutionLog = {
      step: step.step_number,
      action: step.action,
      target: step.target || '',
      success: false,
      timestamp: start,
      durationMs: 0,
    };

    try {
      const resolvedValue = step.value ? this.interpolate(step.value, params) : undefined;
      const timeout = step.timeout || this.config.defaultTimeout;

      switch (step.action) {
        case 'navigate':
          await page.goto(resolvedValue || this.interpolate(step.target || `https://${domain}`, params), { timeout });
          break;

        case 'type':
          await page.fill(step.target!, resolvedValue || '', { timeout });
          break;

        case 'click':
          await page.click(step.target!, { timeout });
          break;

        case 'submit':
          await page.locator(step.target!).evaluate((el: HTMLFormElement) => el.submit());
          break;

        case 'wait':
          await page.waitForTimeout(parseInt(resolvedValue || '1000', 10));
          break;

        case 'scroll':
          await page.evaluate(() => window.scrollBy(0, window.innerHeight));
          break;

        case 'extract': {
          const selector = step.target!;
          const elements = await page.locator(selector).all();
          const extracted = await Promise.all(
            elements.map(async (el: any) => {
              const text = await el.textContent();
              const href = await el.getAttribute('href');
              return { text: text?.trim(), href };
            })
          );
          log.extracted = extracted;
          break;
        }

        case 'select':
          await page.selectOption(step.target!, resolvedValue || '');
          break;

        case 'hover':
          await page.hover(step.target!, { timeout });
          break;

        case 'press':
          await page.keyboard.press(resolvedValue || 'Enter');
          break;

        default:
          throw new Error(`Unknown action: ${step.action}`);
      }

      log.success = true;
    } catch (err: any) {
      log.success = false;
      log.error = err.message;

      if (step.fallback) {
        try {
          await page.waitForSelector(step.fallback, { timeout: 2000 });
          const fallbackStep = { ...step, target: step.fallback };
          return this.executeStep(page, fallbackStep, params, domain);
        } catch {
        }
      }

      if (this.config.screenshotOnFailure) {
        try {
          log.screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });
        } catch {
        }
      }
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
