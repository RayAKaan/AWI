/**
 * AWI Site SDK for JavaScript/TypeScript
 * 
 * Build agent-native endpoints for your website.
 * 
 * @example
 * ```typescript
 * import { AWISite } from '@awi-protocol/site-sdk';
 * import express from 'express';
 * 
 * const app = new AWISite();
 * 
 * app.route('/jobs/search', (req, res) => {
 *   const { query, location } = req.body.params;
 *   const jobs = db.search(query, location);
 *   res.json({ success: true, data: jobs });
 * });
 * 
 * // Mount on your Express app
 * express().use('/awi', app.middleware());
 * ```
 */

import type { Request, Response, NextFunction } from 'express';

export interface RouteHandler {
  (req: Request, res: Response, next: NextFunction): void;
}

export interface RouteDefinition {
  path: string;
  methods: string[];
  handler: RouteHandler;
  parameters: Array<{
    name: string;
    type: string;
    required: boolean;
  }>;
  returnType: string;
  intent: string;
}

export class AWISite {
  private routes: Map<string, RouteDefinition> = new Map();
  private axirRegistry: Map<string, any> = new Map();

  route(path: string, handler: RouteHandler, methods: string[] = ['POST']): this {
    // Extract parameter info from handler
    const paramNames = this._extractParamNames(handler);

    this.routes.set(path, {
      path,
      methods,
      handler,
      parameters: paramNames.map(name => ({
        name,
        type: 'string',
        required: true,
      })),
      returnType: 'unknown',
      intent: handler.name || 'unnamed',
    });

    this.axirRegistry.set(path, {
      intent: handler.name || 'unnamed',
      action: path.replace(/\//g, '_').replace(/^_/,''),
      parameters: paramNames,
      semantic_context: {
        native: true,
        return_schema: 'unknown',
      },
    });

    return this;
  }

  middleware(): any {
    const express = require('express');
    const router = express.Router();

    // Register all routes
    for (const [path, def] of this.routes) {
      for (const method of def.methods) {
        router[method.toLowerCase()](path, def.handler);
      }
    }

    // Add manifest endpoint
    router.get('/manifest', (_req: Request, res: Response) => {
      res.json(this.generateManifest());
    });

    // Add blueprint endpoint
    router.post('/blueprint', (req: Request, res: Response) => {
      const { path: routePath } = req.body;
      const blueprint = this.getRecipeBlueprint(req.hostname, routePath);
      res.json(blueprint);
    });

    return router;
  }

  getRecipeBlueprint(domain: string, path: string): any {
    const route = this.routes.get(path);
    if (!route) {
      throw new Error(`Route not found: ${path}`);
    }

    return {
      recipe_id: `${domain.replace(/\./g, '_')}${path.replace(/\//g, '_')}_v1`,
      target: `awi://${domain}${path}/v1`,
      native: true,
      endpoint: `https://${domain}/awi${path}`,
      method: route.methods[0],
      parameters: route.parameters,
      return_schema: route.returnType,
      axir: this.axirRegistry.get(path),
      estimated_latency_ms: 50,
    };
  }

  generateManifest(): any {
    return {
      version: '1.0.0',
      native: true,
      routes: Array.from(this.routes.values()).map(route => ({
        path: route.path,
        intent: route.intent,
        parameters: route.parameters,
        methods: route.methods,
      })),
    };
  }

  private _extractParamNames(handler: Function): string[] {
    const fnStr = handler.toString();
    const match = fnStr.match(/\(([^)]*)\)/);
    if (!match) return [];

    return match[1]
      .split(',')
      .map(p => p.trim().split(/[=:\s]/)[0])
      .filter(p => p && p !== 'req' && p !== 'res' && p !== 'next');
  }
}

export default AWISite;
