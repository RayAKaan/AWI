/**
 * React hooks for AWI
 * 
 * @example
 * ```tsx
 * import { useAWI } from '@awi-protocol/react';
 * 
 * function JobSearch() {
 *   const { execute, loading, data, error } = useAWI({
 *     endpoint: 'https://awi.example.com',
 *     certificate: 'your-jwt',
 *   });
 * 
 *   const search = async (query: string) => {
 *     await execute({
 *       target: 'awi://linkedin.com/jobs/search/v1',
 *       params: { query },
 *     });
 *   };
 * 
 *   return (
 *     <div>
 *       {loading && <Spinner />}
 *       {error && <Error message={error.message} />}
 *       {data && <JobList jobs={data} />}
 *     </div>
 *   );
 * }
 * ```
 */

import { useState, useCallback } from 'react';
import { AWIClient, type AgentRequest, type AgentResponse, type AWIClientOptions } from '@awi-protocol/sdk';

export interface UseAWIResult<T = unknown> {
  execute: (request: Omit<AgentRequest, 'mode'>) => Promise<AgentResponse<T>>;
  explore: (domain: string, action: string) => Promise<AgentResponse<unknown>>;
  loading: boolean;
  data: T | null;
  error: Error | null;
  metrics: {
    latency_ms: number;
    fallback_count: number;
  } | null;
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

    try {
      const result = await client.execute<T>(request);

      if (result.success) {
        setData(result.data);
      } else {
        setError(new Error(result.errors[0]?.message || 'Execution failed'));
      }

      setMetrics({
        latency_ms: result.metadata?.latency_ms || 0,
        fallback_count: (result.metadata?.fallback_count as number) || 0,
      });

      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client]);

  const explore = useCallback(async (domain: string, action: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await client.explore(domain, action);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client]);

  return {
    execute,
    explore,
    loading,
    data,
    error,
    metrics,
  };
}

export { AWIClient } from '@awi-protocol/sdk';
export type { AgentRequest, AgentResponse, Recipe, RegistryEntry } from '@awi-protocol/sdk';
