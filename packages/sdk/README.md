# @awi-protocol/sdk

**Agent Web Interface SDK** — turn any website into a deterministic API for AI agents.

## Installation

```bash
npm install @awi-protocol/sdk
```

## Zero-Config Usage (v2.1)

Discover any website with zero setup — no API key needed:

```typescript
import { AWI } from '@awi-protocol/sdk';

// Discover a website — zero auth
const site = await AWI.discover('https://github.com');
console.log(site.summary);
// "GitHub is a development platform..."
console.log(site.whatYouCanDo);
// ["Search for content", "Explore repositories", ...]

// Get an action plan for a specific goal
const plan = await AWI.plan('https://linkedin.com/jobs', 'search for ML engineer jobs');
for (const step of plan.actionPlan) {
  console.log(`${step.step_number}. ${step.action}: ${step.reason}`);
}
```

### CLI — no code needed

```bash
# Discover any website
npx awi discover https://github.com

# Get an action plan
npx awi plan https://linkedin.com/jobs "search for ML jobs"

# Execute a recipe (requires API key)
npx awi execute awi://github.com/repos/search/v1 --query "machine learning"
```

### Result Helpers

```typescript
const result = await AWI.discover('https://github.com');

// Pretty-print everything
console.log(result.toString());

// Find interactive elements by type
const searchBar = result.findElement('search');
const allButtons = result.findElements('button');

// Check for risks
if (result.hasRisk('captcha')) {
  console.warn('CAPTCHA detected');
}

// Highest severity risk
console.log(result.highestRisk?.description);
```

### Progressive Disclosure

| Level | API | Auth Required |
|-------|-----|---------------|
| 0 — Discover | `AWI.discover(url)` | None |
| 1 — Plan | `AWI.plan(url, goal)` | None |
| 2 — Execute | `AWI.run(uri, params)` | API key |
| 3 — Custom | `new AWISDK({ ... })` | API key |

### Authentication (only for execution)

```typescript
// Option 1: Environment variable
export AWI_API_KEY=awi_your_key

// Option 2: Custom config
import { AWISDK } from '@awi-protocol/sdk';
const awi = new AWISDK({ apiKey: 'awi_your_key' });
await awi.run('awi://linkedin.com/jobs/search/v1', { query: 'ML' });
```

### Custom Configuration

```typescript
import { AWISDK } from '@awi-protocol/sdk';

const awi = new AWISDK({
  baseUrl: 'http://localhost:8000',  // Self-hosted server
  apiKey: process.env.AWI_API_KEY,
  timeout: 60000,
  retries: 3,
});
```

## Legacy API (v0.x — `AWIClient`)

Backward compatible — existing code continues to work:

```typescript
import { AWIClient } from '@awi-protocol/sdk';

const client = new AWIClient({
  endpoint: 'https://awi.example.com',
  certificate: 'your-awi-jwt-token',
});

const result = await client.execute({
  target: 'awi://linkedin.com/jobs/search/v1',
  params: { query: 'senior rust engineer' },
});
```

## Features

- **Zero-Friction**: Discover any website with no signup, no API key
- **Deterministic Execution**: Recipes guarantee consistent extraction
- **Self-Healing**: AXIR semantic intent regenerates selectors when sites redesign
- **Multi-Strategy Fallback**: CSS → semantic → text → attribute resolution
- **CLI Built-In**: `npx awi` works immediately, no install needed
- **Type-Safe**: Full TypeScript support with rich result types

## API Reference

### `AWI` (Global Singleton)

| Method | Description | Auth |
|--------|-------------|------|
| `discover(url, opts?)` | Discover a website — full site manual | None |
| `inspect(url)` | Quick summary of a website | None |
| `plan(url, goal)` | Get an action plan for a goal | None |
| `execute(url, goal, params?)` | Execute a plan (consumes resources) | API key |
| `run(uri, params?)` | Execute an AWI URI (full power) | API key |

### `AWISDK` (Configurable)

Same methods as `AWI` but takes a config object:

```typescript
new AWISDK({ baseUrl?, apiKey?, timeout?, retries? })
```

### `DiscoverResult` (returned by `discover`, `inspect`, `plan`, `execute`)

| Property | Type |
|----------|------|
| `site` | `SiteIdentity` |
| `summary` | `string` |
| `whatYouCanDo` | `string[]` |
| `interactiveElements` | `InteractiveElement[]` |
| `extractableData` | `ExtractableField[]` |
| `actionPlan` | `ActionPlanStep[]` (optional) |
| `risks` | `RiskWarning[]` |

| Method | Description |
|--------|-------------|
| `findElement(type)` | First element matching type |
| `findElements(type)` | All elements matching type |
| `hasRisk(type)` | Check if a risk type exists |
| `toString()` | Pretty-printed site manual |
| `toJSON()` | Raw response data |

### `ExecutionResult` (returned by `run`)

| Property | Description |
|----------|-------------|
| `ok` | Success and no errors |
| `data` | Execution response data |
| `latencyMs` | Execution latency in ms |
| `toString()` | Pretty-printed result |

## License

MIT
