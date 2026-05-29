import type { DiscoverResponse, InteractiveElement, RiskWarning } from './types';

export class DiscoverResult {
  private data: DiscoverResponse;

  constructor(data: DiscoverResponse) {
    this.data = data || {} as DiscoverResponse;
  }

  get target() { return this.data.target; }
  get summary() { return this.data.summary || ''; }
  get whatYouCanDo() { return this.data.what_you_can_do || []; }
  get interactiveElements() { return this.data.interactive_elements || []; }
  get extractableData() { return this.data.extractable_data || []; }
  get actionPlan() { return this.data.action_plan; }
  get risks() { return this.data.risks || []; }
  get site() { return this.data.site; }
  get bxlSummary() { return this.data.bxl_summary; }
  get executionResult() { return this.data.execution_result; }
  get metadata() { return this.data.metadata || {}; }
  get hasRecipe() { return this.data.site?.has_recipe; }
  get recipeConfidence() { return this.data.site?.recipe_confidence; }

  /** Find the first interactive element matching a type. */
  findElement(type: string): InteractiveElement | undefined {
    return this.data.interactive_elements?.find(e => e.element_type === type);
  }

  /** Find all interactive elements matching a type. */
  findElements(type: string): InteractiveElement[] {
    return (this.data.interactive_elements || []).filter(e => e.element_type === type);
  }

  /** Check if a specific risk type exists. */
  hasRisk(type: string): boolean {
    return (this.data.risks || []).some(r => r.risk_type === type);
  }

  /** Get the highest severity risk, or undefined if none. */
  get highestRisk(): RiskWarning | undefined {
    const severityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    return (this.data.risks || []).slice().sort(
      (a, b) => (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0)
    )[0];
  }

  toString(): string {
    const lines: string[] = [
      '='.repeat(60),
      `  AWI Discovery: ${this.site?.site_name || this.target}`,
      '='.repeat(60),
      '',
      `Summary: ${this.summary}`,
      '',
      'What you can do:',
    ];
    for (const item of this.whatYouCanDo || []) {
      lines.push(`  . ${item}`);
    }

    if (this.interactiveElements?.length) {
      lines.push('', 'Interactive elements:');
      for (const el of this.interactiveElements) {
        lines.push(`  [${el.element_type}] ${el.what_it_is}`);
        lines.push(`    ${el.purpose}`);
      }
    }

    if (this.actionPlan?.length) {
      lines.push('', 'Action plan:');
      for (const step of this.actionPlan) {
        lines.push(`  ${step.step_number}. ${step.action}: ${step.reason}`);
      }
    }

    if (this.risks?.length) {
      lines.push('', 'Risks:');
      for (const risk of this.risks) {
        lines.push(`  [${risk.severity}] ${risk.risk_type}: ${risk.description}`);
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  toJSON(): DiscoverResponse {
    return this.data;
  }
}
