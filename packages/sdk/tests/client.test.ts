/**
 * AWI Client Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AWIClient, AWIError } from '../src/client';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const server = setupServer();

beforeEach(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe('AWIClient', () => {
  const createClient = () => new AWIClient({
    endpoint: 'http://localhost:8000',
    certificate: 'test-jwt-token',
  });

  it('should execute a recipe successfully', async () => {
    const client = createClient();

    server.use(
      http.post('http://localhost:8000/v1/execute', async ({ request }) => {
        const body = await request.json();
        expect(body.target).toBe('awi://example.com/test/action/v1');
        expect(body.params).toEqual({ query: 'test' });

        return HttpResponse.json({
          success: true,
          data: [{ title: 'Test' }],
          errors: [],
          metadata: { latency_ms: 100 },
          execution_path: ['navigate', 'extract'],
        });
      })
    );

    const result = await client.execute({
      target: 'awi://example.com/test/action/v1',
      params: { query: 'test' },
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ title: 'Test' }]);
  });

  it('should handle errors', async () => {
    const client = createClient();

    server.use(
      http.post('http://localhost:8000/v1/execute', () => {
        return HttpResponse.json({
          success: false,
          errors: [{ code: 'RECIPE_NOT_FOUND', message: 'Recipe not found' }],
        }, { status: 404 });
      })
    );

    await expect(client.execute({
      target: 'awi://unknown.com/test/action/v1',
      params: {},
    })).rejects.toThrow(AWIError);
  });

  it('should get advisory blueprint', async () => {
    const client = createClient();

    server.use(
      http.post('http://localhost:8000/v1/advisory', () => {
        return HttpResponse.json({
          success: true,
          data: {
            id: 'test_recipe',
            steps: [{ type: 'navigate', url: 'https://example.com' }],
            selectors: {},
            extraction: { mode: 'list', container: 'results', fields: [] },
            validation: { required_fields: [], min_items: 0, custom_checks: [] },
          },
          metadata: {},
          execution_path: ['advisory'],
        });
      })
    );

    const result = await client.getAdvisory('awi://example.com/test/action/v1');
    expect(result.success).toBe(true);
    expect(result.data?.steps).toHaveLength(1);
  });

  it('should submit feedback', async () => {
    const client = createClient();

    server.use(
      http.post('http://localhost:8000/v1/feedback', async ({ request }) => {
        const body = await request.json();
        expect(body.rating).toBe('good');

        return HttpResponse.json({
          success: true,
          data: { feedback_received: true },
        });
      })
    );

    const result = await client.feedback({
      execution_id: 'test-123',
      rating: 'good',
    });

    expect(result.success).toBe(true);
    expect(result.data?.feedback_received).toBe(true);
  });

  it('should list registry', async () => {
    const client = createClient();

    server.use(
      http.get('http://localhost:8000/v1/registry', () => {
        return HttpResponse.json({
          success: true,
          data: {
            sites: [
              { domain: 'linkedin.com', confidence: 0.95, certified: true },
            ],
            stats: { total_sites: 1 },
          },
        });
      })
    );

    const result = await client.listRegistry();
    expect(result.success).toBe(true);
    expect(result.data?.sites).toHaveLength(1);
  });

  it('should calculate metrics from response', () => {
    const client = createClient();

    const response = {
      success: true,
      data: null,
      errors: [],
      metadata: {
        latency_ms: 1500,
        fallback_count: 2,
        selectors_used: ['search_form', 'results'],
        cache_status: 'miss',
      },
      execution_path: [],
    };

    const metrics = client.getMetrics(response);
    expect(metrics.latency_ms).toBe(1500);
    expect(metrics.fallback_count).toBe(2);
    expect(metrics.selectors_used).toEqual(['search_form', 'results']);
    expect(metrics.cache_status).toBe('miss');
  });
});
