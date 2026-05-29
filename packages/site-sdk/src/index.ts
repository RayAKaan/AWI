import type { Request, Response, NextFunction } from 'express';
import type {
  RouteHandler, RouteDefinition, RouteParameter,
  SiteManifest, SiteBlueprint, Recipe,
} from '@awi-protocol/types';
import { createHash } from 'crypto';

export interface SiteSDKConfig {
  prefix?: string;
  requireAuth?: boolean;
  httpsOnly?: boolean;
  allowedOrigins?: string[];
}

export class AWISite {
  private routes: Map<string, RouteDefinition> = new Map();
  private axirRegistry: Map<string, any> = new Map();
  private config: Required<SiteSDKConfig>;

  constructor(config: SiteSDKConfig = {}) {
    this.config = {
      prefix: '/awi',
      requireAuth: false,
      httpsOnly: false,
      allowedOrigins: [],
      ...config,
    };
  }

  route(path: string, handler: RouteHandler, methods: string[] = ['POST']): this {
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
      action: path.replace(/\//g, '_').replace(/^_/, ''),
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

    if (this.config.allowedOrigins.length > 0) {
      router.use((req: any, res: any, next: any) => {
        const origin = req.headers.origin;
        if (this.config.allowedOrigins.includes(origin)) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, AWI-Agent-Version');
        }
        if (req.method === 'OPTIONS') {
          res.status(204).end();
          return;
        }
        next();
      });
    }

    for (const [path, def] of this.routes) {
      for (const method of def.methods) {
        const m = method.toLowerCase();
        if (['get', 'post', 'put', 'patch', 'delete'].includes(m)) {
          router[m](path, def.handler);
        }
      }
    }

    router.get('/manifest', (_req: Request, res: Response) => {
      res.json(this.generateManifest());
    });

    router.post('/blueprint', (req: Request, res: Response) => {
      try {
        const { path: routePath } = req.body || {};
        if (!routePath) {
          res.status(400).json({ error: 'Missing path in request body' });
          return;
        }
        const blueprint = this.getRecipeBlueprint(req.hostname, routePath);
        res.json(blueprint);
      } catch (err: any) {
        res.status(404).json({ error: err.message });
      }
    });

    return router;
  }

  getRecipeBlueprint(domain: string, path: string): SiteBlueprint {
    const route = this.routes.get(path);
    if (!route) {
      throw new Error(`Route not found: ${path}`);
    }

    const protocol = this.config.httpsOnly ? 'https' : 'https';
    const baseURL = `${protocol}://${domain}${this.config.prefix}`;

    return {
      recipe_id: `${domain.replace(/\./g, '_')}${path.replace(/\//g, '_')}_v1`,
      target: `awi://${domain}${path}/v1`,
      native: true,
      endpoint: `${baseURL}${path}`,
      method: route.methods[0],
      parameters: route.parameters,
      return_schema: route.returnType,
      axir: this.axirRegistry.get(path),
      estimated_latency_ms: 50,
    };
  }

  generateManifest(): SiteManifest {
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

  exportRecipes(domain: string): Recipe[] {
    const recipes: Recipe[] = [];
    const now = new Date().toISOString();

    for (const [path, route] of this.routes) {
      const blueprint = this.getRecipeBlueprint(domain, path);
      const recipe: Recipe = {
        meta: {
          domain,
          action: path.replace(/^\//, '').replace(/\//g, '_'),
          version: 'v1',
          hash: '',
          trustScore: 1.0,
          permissions: route.parameters.length > 0 ? ['read:public', 'write:data'] : ['read:public'],
          jsRequired: false,
          authRequired: false,
          rateLimitTag: domain,
          createdAt: now,
          updatedAt: now,
          author: 'site-sdk',
          tags: ['native', 'site-sdk', route.intent],
          native: true,
          endpoint: blueprint.endpoint,
          method: blueprint.method,
          estimatedLatencyMs: blueprint.estimated_latency_ms,
        },
        steps: [
          {
            step_number: 1,
            action: 'native_http',
            target: blueprint.endpoint,
            value: blueprint.method,
            reason: `Native API endpoint for ${route.intent}`,
          },
        ],
      };

      const canonical = JSON.stringify({
        domain: recipe.meta.domain,
        action: recipe.meta.action,
        version: recipe.meta.version,
        permissions: recipe.meta.permissions,
      }) + '|' + JSON.stringify(recipe.steps);
      recipe.meta.hash = 'sha256:' + createHash('sha256').update(canonical).digest('hex');

      recipes.push(recipe);
    }

    return recipes;
  }

  private _extractParamNames(handler: Function): string[] {
    const fnStr = handler.toString();

    if (fnStr.includes('[native code]')) {
      return [];
    }

    const params = this._extractParamsBalanced(fnStr);
    if (!params) return [];

    return this._parseParamList(params);
  }

  private _extractParamsBalanced(fnStr: string): string | null {
    const funcMatch = fnStr.match(/(?:async\s+)?(?:function\s*\w*\s*|\w+\s*=>\s*|\(?)\s*\(/);
    if (!funcMatch) return null;

    const startIdx = fnStr.indexOf('(', funcMatch.index);
    if (startIdx === -1) return null;

    let depth = 1;
    let endIdx = startIdx + 1;

    while (depth > 0 && endIdx < fnStr.length) {
      if (fnStr[endIdx] === '(') depth++;
      else if (fnStr[endIdx] === ')') depth--;
      endIdx++;
    }

    if (depth !== 0) return null;
    return fnStr.slice(startIdx + 1, endIdx - 1);
  }

  private _parseParamList(params: string): string[] {
    const identifiers: string[] = [];
    let current = '';
    let depth = 0;

    for (let i = 0; i < params.length; i++) {
      const char = params[i];

      if (char === '{' || char === '[' || char === '(') {
        depth++;
        current += char;
      } else if (char === '}' || char === ']' || char === ')') {
        depth--;
        current += char;
      } else if (char === ',' && depth === 0) {
        const id = this._extractIdentifier(current.trim());
        if (id) identifiers.push(id);
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      const id = this._extractIdentifier(current.trim());
      if (id) identifiers.push(id);
    }

    return identifiers;
  }

  private _extractIdentifier(param: string): string | null {
    param = param.trim();
    if (!param) return null;

    const firstWord = param.split(/[=:\s]/)[0];
    if (['req', 'res', 'next', 'request', 'response'].includes(firstWord)) {
      return null;
    }

    if (param.startsWith('{')) {
      return this._extractFromDestructuring(param);
    }

    if (param.startsWith('[')) {
      return this._extractFromArrayDestructuring(param);
    }

    return firstWord;
  }

  private _extractFromDestructuring(pattern: string): string | null {
    const inner = pattern.slice(1, -1).trim();
    if (!inner) return null;

    const keys: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of inner) {
      if (char === '{' || char === '[') depth++;
      else if (char === '}' || char === ']') depth--;
      else if (char === ',' && depth === 0) {
        const key = current.trim().split(/[=:\s]/)[0];
        if (key) keys.push(key);
        current = '';
        continue;
      }
      current += char;
    }

    const lastKey = current.trim().split(/[=:\s]/)[0];
    if (lastKey) keys.push(lastKey);

    return keys.length > 0 ? `{ ${keys.join(', ')} }` : null;
  }

  private _extractFromArrayDestructuring(pattern: string): string | null {
    const inner = pattern.slice(1, -1).trim();
    if (!inner) return null;
    return `[${inner}]`;
  }
}

export default AWISite;
