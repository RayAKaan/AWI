import type { Recipe } from '@awi-protocol/types';
import { hashRecipe } from './db';

export const SEED_RECIPES: Map<string, Recipe> = new Map([
  ['github.com/repos/search/v1', {
    meta: {
      domain: 'github.com',
      action: 'repos/search',
      version: 'v1',
      hash: 'sha256:placeholder',
      trustScore: 1.0,
      permissions: ['read:public'],
      jsRequired: true,
      authRequired: false,
      rateLimitTag: 'github.com',
      createdAt: '2026-05-28T00:00:00Z',
      updatedAt: '2026-05-28T00:00:00Z',
      author: 'awi-protocol',
      tags: ['search', 'repositories', 'public'],
    },
    steps: [
      {
        step_number: 1,
        action: 'navigate',
        target: 'https://github.com/search',
        reason: 'Open GitHub search page',
        timeout: 10000,
      },
      {
        step_number: 2,
        action: 'type',
        target: 'input[name="q"]',
        value: '{{query}}',
        reason: 'Enter search query',
      },
      {
        step_number: 3,
        action: 'submit',
        target: 'form[action="/search"]',
        reason: 'Submit search form',
      },
      {
        step_number: 4,
        action: 'wait',
        target: '1000',
        reason: 'Wait for results to load',
      },
      {
        step_number: 5,
        action: 'extract',
        target: '[data-testid="results-list"] .repo-list-item, .repo-list-item',
        reason: 'Extract repository results',
        fallback: '.repo-list-item',
      },
    ],
  }],

  ['linkedin.com/jobs/search/v1', {
    meta: {
      domain: 'linkedin.com',
      action: 'jobs/search',
      version: 'v1',
      hash: 'sha256:placeholder',
      trustScore: 0.9,
      permissions: ['read:public'],
      jsRequired: true,
      authRequired: true,
      rateLimitTag: 'linkedin.com',
      createdAt: '2026-05-28T00:00:00Z',
      updatedAt: '2026-05-28T00:00:00Z',
      author: 'awi-protocol',
      tags: ['jobs', 'search', 'careers'],
    },
    steps: [
      {
        step_number: 1,
        action: 'navigate',
        target: 'https://www.linkedin.com/jobs/search',
        reason: 'Open LinkedIn jobs search',
        timeout: 15000,
      },
      {
        step_number: 2,
        action: 'type',
        target: 'input[aria-label*="Search by title"], input[placeholder*="Search" i]',
        value: '{{query}}',
        reason: 'Enter job title/keyword',
        fallback: 'input[type="text"]',
      },
      {
        step_number: 3,
        action: 'type',
        target: 'input[aria-label*="location" i], input[placeholder*="location" i]',
        value: '{{location}}',
        reason: 'Enter location (optional)',
        optional: true,
        fallback: 'input[type="text"]',
      },
      {
        step_number: 4,
        action: 'press',
        target: 'Enter',
        reason: 'Submit search',
      },
      {
        step_number: 5,
        action: 'wait',
        target: '2000',
        reason: 'Wait for job listings',
      },
      {
        step_number: 6,
        action: 'extract',
        target: '.jobs-search__results-list li, [data-job-id]',
        reason: 'Extract job listings',
      },
    ],
  }],

  ['google.com/search/v1', {
    meta: {
      domain: 'google.com',
      action: 'search',
      version: 'v1',
      hash: 'sha256:placeholder',
      trustScore: 1.0,
      permissions: ['read:public'],
      jsRequired: false,
      authRequired: false,
      rateLimitTag: 'google.com',
      createdAt: '2026-05-28T00:00:00Z',
      updatedAt: '2026-05-28T00:00:00Z',
      author: 'awi-protocol',
      tags: ['search', 'web', 'public'],
    },
    steps: [
      {
        step_number: 1,
        action: 'navigate',
        target: 'https://www.google.com/search?q={{query}}',
        reason: 'Navigate to search results directly',
        timeout: 10000,
      },
      {
        step_number: 2,
        action: 'wait',
        target: '1500',
        reason: 'Wait for results',
      },
      {
        step_number: 3,
        action: 'extract',
        target: '#search .g, [data-header-feature]',
        reason: 'Extract search results',
        fallback: '.g',
      },
    ],
  }],

  ['news.ycombinator.com/frontpage/v1', {
    meta: {
      domain: 'news.ycombinator.com',
      action: 'frontpage',
      version: 'v1',
      hash: 'sha256:placeholder',
      trustScore: 1.0,
      permissions: ['read:public'],
      jsRequired: false,
      authRequired: false,
      rateLimitTag: 'news.ycombinator.com',
      createdAt: '2026-05-28T00:00:00Z',
      updatedAt: '2026-05-28T00:00:00Z',
      author: 'awi-protocol',
      tags: ['news', 'tech', 'public'],
    },
    steps: [
      {
        step_number: 1,
        action: 'navigate',
        target: 'https://news.ycombinator.com',
        reason: 'Open HN frontpage',
        timeout: 5000,
      },
      {
        step_number: 2,
        action: 'extract',
        target: '.athing',
        reason: 'Extract story titles, URLs, and scores',
      },
    ],
  }],

  ['wikipedia.org/article/read/v1', {
    meta: {
      domain: 'wikipedia.org',
      action: 'article/read',
      version: 'v1',
      hash: 'sha256:placeholder',
      trustScore: 1.0,
      permissions: ['read:public'],
      jsRequired: false,
      authRequired: false,
      rateLimitTag: 'wikipedia.org',
      createdAt: '2026-05-28T00:00:00Z',
      updatedAt: '2026-05-28T00:00:00Z',
      author: 'awi-protocol',
      tags: ['knowledge', 'reference', 'public'],
    },
    steps: [
      {
        step_number: 1,
        action: 'navigate',
        target: 'https://en.wikipedia.org/wiki/{{title}}',
        reason: 'Navigate to article',
        timeout: 10000,
      },
      {
        step_number: 2,
        action: 'extract',
        target: '#mw-content-text p, .mw-parser-output p',
        reason: 'Extract article paragraphs',
      },
    ],
  }],
]);

for (const [, recipe] of SEED_RECIPES) {
  recipe.meta.hash = hashRecipe(recipe);
}
