import type { ExecutionResponse } from './types';

export class ExecutionResult {
  private response: ExecutionResponse;

  constructor(response: ExecutionResponse) {
    this.response = response || {} as ExecutionResponse;
  }

  get success() { return this.response.success; }
  get data() { return this.response.data; }
  get errors() { return this.response.errors; }
  get metadata() { return this.response.metadata; }
  get executionPath() { return this.response.execution_path; }

  get ok(): boolean {
    if (this.errors && this.errors.length > 0) return false;
    return this.success === true;
  }

  get latencyMs(): number | undefined {
    return this.response.metadata?.latency_ms as number | undefined;
  }

  get recipeVersion(): string | undefined {
    return this.response.metadata?.recipe_version as string | undefined;
  }

  toString(): string {
    const lines: string[] = [
      '='.repeat(60),
      '  AWI Execution Result',
      '='.repeat(60),
      '',
      `Status: ${this.ok ? 'SUCCESS' : 'FAILED'}`,
    ];

    if (this.response.data) {
      lines.push('', 'Data:', JSON.stringify(this.response.data, null, 2));
    }

    if (this.errors && this.errors.length > 0) {
      lines.push('', 'Errors:');
      for (const e of this.errors) {
        lines.push(`  ${e.code ? `[${e.code}] ` : ''}${e.message}`);
      }
    }

    if (this.executionPath) {
      lines.push('', 'Execution path:');
      for (let i = 0; i < this.executionPath.length; i++) {
        lines.push(`  ${i + 1}. ${this.executionPath[i]}`);
      }
    }

    if (this.response.metadata) {
      lines.push('', 'Metadata:');
      for (const [k, v] of Object.entries(this.response.metadata)) {
        lines.push(`  ${k}: ${v}`);
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  toJSON(): ExecutionResponse {
    return this.response;
  }
}
