import { useState, useCallback } from 'react';
import type {
  AgentRequest, AgentResponse, AWIClientOptions,
  ExecutionResult, Recipe,
} from '@awi-protocol/types';

export interface UseAWIResult<T = unknown> {
  execute: (request: Omit<AgentRequest, 'mode'>) => Promise<AgentResponse<T>>;
  explore: (domain: string, resource: string, action?: string) => Promise<AgentResponse<unknown>>;
  run: (uri: string, params?: Record<string, any>) => Promise<ExecutionResult>;
  loading: boolean;
  data: T | null;
  error: Error | null;
  metrics: { latency_ms: number; fallback_count: number } | null;
}

class AWIClient {
  private endpoint: string;
  private certificate?: string;
  private timeout: number;

  constructor(options: AWIClientOptions) {
    if (!options.endpoint) {
      throw new Error('AWIClient requires an endpoint in server proxy mode');
    }
    this.endpoint = options.endpoint.replace(/\/$/, '');
    this.certificate = options.certificate;
    this.timeout = options.timeout || 30000;
  }

  async execute<T>(request: AgentRequest): Promise<AgentResponse<T>> {
    const url = `${this.endpoint}/v1/execute`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.certificate ? { 'Authorization': `Bearer ${this.certificate}` } : {}),
        },
        body: JSON.stringify({ ...request, mode: 'proxy' }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`AWI ${response.status}: ${text}`);
      }

      return await response.json();
    } catch (err: any) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  async explore(domain: string, resource?: string, action?: string): Promise<AgentResponse<unknown>> {
    const res = resource || action || 'discover';
    const act = action || res;
    const target = `awi://${domain}/${res}/${act}/v1`;

    return this.execute({
      target,
      params: { domain, resource: res, action: act },
      mode: 'proxy',
    });
  }
}

export function useAWI<T = unknown>(options: AWIClientOptions): UseAWIResult<T> {
  const [client] = useState(() => new AWIClient(options));

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [metrics, setMetrics] = useState<UseAWIResult['metrics']>(null);

  const execute = useCallback(async (request: Omit<AgentRequest, 'mode'>) => {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const result = await client.execute<T>(request);

      if (result.success) {
        setData(result.data ?? null);
      } else {
        const msg = result.errors?.[0]?.message || 'Execution failed';
        setError(new Error(msg));
      }

      const latency = typeof result.metadata?.latency_ms === 'number'
        ? result.metadata.latency_ms
        : 0;
      const fallback = typeof result.metadata?.fallback_count === 'number'
        ? result.metadata.fallback_count
        : 0;

      setMetrics({ latency_ms: latency, fallback_count: fallback });
      return result;

    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client]);

  const explore = useCallback(async (domain: string, resource: string, action?: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await client.explore(domain, resource, action);

      if (!result.success) {
        const msg = result.errors?.[0]?.message || 'Explore failed';
        setError(new Error(msg));
      } else {
        setData(result.data as T ?? null);
      }

      const latency = typeof result.metadata?.latency_ms === 'number'
        ? result.metadata.latency_ms
        : 0;
      const fallback = typeof result.metadata?.fallback_count === 'number'
        ? result.metadata.fallback_count
        : 0;
      setMetrics({ latency_ms: latency, fallback_count: fallback });

      return result;

    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client]);

  const run = useCallback(async (uri: string, params?: Record<string, any>) => {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const { AWI } = await import('@awi-protocol/sdk');
      const result = await AWI.run(uri, params || {});

      if (result.success) {
        setData(result.data ?? null);
      } else {
        setError(new Error(result.errors.join('; ')));
      }

      setMetrics({
        latency_ms: result.metadata.totalDurationMs,
        fallback_count: 0,
      });

      return result;
    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    execute,
    explore,
    run,
    loading,
    data,
    error,
    metrics,
  };
}

export interface UseAWIP2PResult<T = unknown> {
  run: (uri: string, params?: Record<string, any>) => Promise<ExecutionResult>;
  discover: (url: string) => Promise<any>;
  discoverSite: (url: string) => Promise<Recipe[]>;
  listRecipes: (domain?: string) => Promise<any[]>;
  loading: boolean;
  data: T | null;
  error: Error | null;
  metrics: { latency_ms: number; fallback_count: number } | null;
}

export function useAWIP2P<T = unknown>(): UseAWIP2PResult<T> {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [metrics, setMetrics] = useState<UseAWIP2PResult['metrics']>(null);

  const getSDK = useCallback(async () => {
    const { AWI } = await import('@awi-protocol/sdk');
    return AWI;
  }, []);

  const run = useCallback(async (uri: string, params?: Record<string, any>) => {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const AWI = await getSDK();
      const result = await AWI.run(uri, params || {});

      if (result.success) {
        setData(result.data ?? null);
      } else {
        setError(new Error(result.errors.join('; ')));
      }

      setMetrics({
        latency_ms: result.metadata.totalDurationMs,
        fallback_count: 0,
      });

      return result;
    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [getSDK]);

  const discover = useCallback(async (url: string) => {
    setLoading(true);
    setError(null);

    try {
      const AWI = await getSDK();
      const result = await AWI.discover(url);
      setData(result as any);
      return result;
    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [getSDK]);

  const discoverSite = useCallback(async (url: string) => {
    setLoading(true);
    setError(null);

    try {
      const AWI = await getSDK();
      const result = await AWI.discoverSite(url);
      setData(result as any);
      return result;
    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [getSDK]);

  const listRecipes = useCallback(async (domain?: string) => {
    const AWI = await getSDK();
    return AWI.listRecipes(domain);
  }, [getSDK]);

  return {
    run,
    discover,
    discoverSite,
    listRecipes,
    loading,
    data,
    error,
    metrics,
  };
}

export { AWIClient };
export type { AgentRequest, AgentResponse, AWIClientOptions, ExecutionResult };
