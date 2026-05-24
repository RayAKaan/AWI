/**
 * AWI Client
 * 
 * Main SDK class for interacting with AWI servers.
 * Supports proxy mode (server executes browser) and advisory mode (returns blueprint).
 */

import fetch from 'cross-fetch';
import type {
  AgentRequest,
  AgentResponse,
  AWIClientOptions,
  Recipe,
  RegistryEntry,
  FeedbackRequest,
  DelegationRequest,
  ExecutionMetrics,
} from './types';

export class AWIError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, statusCode: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AWIError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class AWIClient {
  private endpoint: string;
  private certificate: string;
  private timeout: number;
  private retries: number;

  constructor(options: AWIClientOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, '');
    this.certificate = options.certificate;
    this.timeout = options.timeout || 30000;
    this.retries = options.retries || 3;
  }

  /**
   * Execute a recipe in proxy mode.
   * The server runs the browser and returns structured data.
   */
  async execute<T = unknown>(request: Omit<AgentRequest, 'mode'>): Promise<AgentResponse<T>> {
    return this._request<AgentResponse<T>>('/v1/execute', {
      ...request,
      mode: 'proxy',
    });
  }

  /**
   * Get advisory blueprint for agent-side execution.
   * Returns the recipe structure without running the browser.
   */
  async getAdvisory(target: string): Promise<AgentResponse<Recipe>> {
    return this._request<AgentResponse<Recipe>>('/v1/advisory', {
      target,
    });
  }

  /**
   * Execute in advisory mode - get blueprint then run locally.
   * This is useful when you want to control the browser yourself.
   */
  async executeAdvisory<T = unknown>(
    request: Omit<AgentRequest, 'mode'>,
    localExecutor: (blueprint: Recipe, params: Record<string, unknown>) => Promise<T>
  ): Promise<AgentResponse<T>> {
    // Get blueprint
    const advisory = await this.getAdvisory(request.target);

    if (!advisory.success || !advisory.data) {
      return {
        ...advisory,
        data: null,
      } as AgentResponse<T>;
    }

    // Execute locally
    const startTime = Date.now();
    try {
      const data = await localExecutor(advisory.data, request.params);
      const latency = Date.now() - startTime;

      return {
        success: true,
        data,
        errors: [],
        metadata: {
          ...advisory.metadata,
          latency_ms: latency,
          mode: 'advisory-local',
        },
        execution_path: ['advisory', 'local-execution'],
        axir_intent: advisory.axir_intent,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        errors: [{
          code: 'LOCAL_EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        }],
        metadata: advisory.metadata,
        execution_path: ['advisory', 'local-execution-failed'],
      };
    }
  }

  /**
   * Submit feedback on execution quality.
   */
  async feedback(request: FeedbackRequest): Promise<AgentResponse<{ feedback_received: boolean }>> {
    return this._request('/v1/feedback', request);
  }

  /**
   * Explore an unknown domain and generate a recipe.
   */
  async explore(domain: string, action: string, resource?: string): Promise<AgentResponse<Recipe>> {
    const target = `awi://${domain}/${resource || action}/${action}/v1`;
    return this._request('/v1/execute', {
      target,
      params: {},
      mode: 'proxy',
      options: { explore: true },
    });
  }

  /**
   * List supported sites in the registry.
   */
  async listRegistry(options?: {
    category?: string;
    certifiedOnly?: boolean;
    minConfidence?: number;
    search?: string;
    limit?: number;
  }): Promise<AgentResponse<{ sites: RegistryEntry[]; stats: Record<string, unknown> }>> {
    const params = new URLSearchParams();
    if (options?.category) params.set('category', options.category);
    if (options?.certifiedOnly) params.set('certified_only', 'true');
    if (options?.minConfidence) params.set('min_confidence', String(options.minConfidence));
    if (options?.search) params.set('search', options.search);
    if (options?.limit) params.set('limit', String(options.limit));

    return this._request(`/v1/registry?${params.toString()}`, undefined, 'GET');
  }

  /**
   * Search registry.
   */
  async searchRegistry(query: string, limit?: number): Promise<AgentResponse<{ results: RegistryEntry[] }>> {
    const params = new URLSearchParams();
    params.set('q', query);
    if (limit) params.set('limit', String(limit));

    return this._request(`/v1/registry/search?${params.toString()}`, undefined, 'GET');
  }

  /**
   * Delegate execution to another agent.
   */
  async delegate(request: DelegationRequest): Promise<AgentResponse<{ delegation_id: string }>> {
    return this._request('/v1/delegate', request);
  }

  /**
   * Join a multi-agent session.
   */
  async joinSession(sessionId: string): Promise<AgentResponse<{ session_id: string; participants: string[] }>> {
    return this._request('/v1/session/join', { session_id: sessionId });
  }

  /**
   * Check server health.
   */
  async health(): Promise<{ status: string; version: string }> {
    const response = await fetch(`${this.endpoint}/health`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new AWIError('HEALTH_CHECK_FAILED', 'Server health check failed', response.status);
    }

    return response.json();
  }

  /**
   * Get execution metrics from a response.
   */
  getMetrics(response: AgentResponse<unknown>): ExecutionMetrics {
    return {
      latency_ms: response.metadata?.latency_ms || 0,
      fallback_count: (response.metadata?.fallback_count as number) || 0,
      selectors_used: (response.metadata?.selectors_used as string[]) || [],
      cache_status: response.metadata?.cache_status || 'miss',
    };
  }

  private async _request<T>(
    path: string,
    body?: unknown,
    method: string = 'POST'
  ): Promise<T> {
    const url = `${this.endpoint}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'AWI-Agent-Certificate': this.certificate,
    };

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new AWIError(
            errorData.errors?.[0]?.code || 'REQUEST_FAILED',
            errorData.errors?.[0]?.message || `HTTP ${response.status}`,
            response.status,
            errorData
          );
        }

        return response.json() as Promise<T>;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on 4xx errors (client errors)
        if (error instanceof AWIError && error.statusCode >= 400 && error.statusCode < 500) {
          throw error;
        }

        // Wait before retry (exponential backoff)
        if (attempt < this.retries - 1) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw lastError || new AWIError('MAX_RETRIES', 'Max retries exceeded', 502);
  }
}

export default AWIClient;
