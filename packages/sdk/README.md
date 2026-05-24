# @awi-protocol/sdk

**AWI (Agent Web Interface) JavaScript SDK**

Deterministic web automation for AI agents. Transform any website into a structured, machine-readable API.

## Installation

```bash
npm install @awi-protocol/sdk
# or
yarn add @awi-protocol/sdk
# or
pnpm add @awi-protocol/sdk
```

## Quick Start

### Proxy Mode (Server Executes Browser)

```typescript
import { AWIClient } from '@awi-protocol/sdk';

const client = new AWIClient({
  endpoint: 'https://awi.example.com',
  certificate: 'your-awi-jwt-token',
});

// Execute a recipe - server runs the browser
const result = await client.execute({
  target: 'awi://linkedin.com/jobs/search/v1',
  params: {
    query: 'senior rust engineer',
    location: 'remote',
  },
});

if (result.success) {
  console.log(result.data);
  // [{ title: "Senior Rust Engineer", company: "TechCorp", location: "Remote" }, ...]
}
```

### Advisory Mode (Agent Executes Locally)

```typescript
// Get the recipe blueprint
const advisory = await client.getAdvisory('awi://linkedin.com/jobs/search/v1');

// Execute locally with your own browser automation
const result = await client.executeAdvisory(
  {
    target: 'awi://linkedin.com/jobs/search/v1',
    params: { query: 'rust' },
  },
  async (blueprint, params) => {
    // Your local execution logic
    // e.g., Puppeteer, Playwright, or DOM manipulation
    return localBrowser.execute(blueprint, params);
  }
);
```

### Explore Unknown Sites

```typescript
// Automatically explore and generate a recipe
const recipe = await client.explore('new-site.com', 'search', 'products');

if (recipe.success) {
  console.log('Generated recipe:', recipe.data);
}
```

## Features

- **Deterministic Execution**: Recipes guarantee consistent extraction
- **Self-Healing**: AXIR semantic intent regenerates selectors when sites redesign
- **Multi-Strategy Fallback**: CSS → semantic → text → attribute resolution
- **Stealth Browser**: Undetectable automation with fingerprint rotation
- **Agent Identity**: W3C did:key DIDs with tiered rate limiting
- **OpenTelemetry**: Full distributed tracing
- **Type-Safe**: Full TypeScript support with generic response types

## API Reference

### `AWIClient`

#### Constructor

```typescript
new AWIClient(options: {
  endpoint: string;      // AWI server URL
  certificate: string;   // JWT authentication token
  timeout?: number;      // Request timeout (ms) - default 30000
  retries?: number;      // Retry attempts - default 3
})
```

#### Methods

| Method | Description |
|--------|-------------|
| `execute(request)` | Execute recipe in proxy mode |
| `getAdvisory(target)` | Get recipe blueprint |
| `executeAdvisory(request, executor)` | Get blueprint + execute locally |
| `explore(domain, action, resource?)` | Explore unknown domain |
| `feedback(request)` | Submit execution feedback |
| `listRegistry(options?)` | List supported sites |
| `searchRegistry(query, limit?)` | Search registry |
| `delegate(request)` | Delegate to another agent |
| `joinSession(sessionId)` | Join multi-agent session |
| `health()` | Check server health |

### Error Handling

```typescript
import { AWIClient, AWIError } from '@awi-protocol/sdk';

try {
  const result = await client.execute({...});
} catch (error) {
  if (error instanceof AWIError) {
    console.log(error.code);      // 'RECIPE_NOT_FOUND'
    console.log(error.statusCode); // 404
    console.log(error.details);    // { recipe_id: '...' }
  }
}
```

## React Integration

```bash
npm install @awi-protocol/react
```

```tsx
import { useAWI } from '@awi-protocol/react';

function JobSearch() {
  const { execute, loading, data, error, metrics } = useAWI({
    endpoint: 'https://awi.example.com',
    certificate: 'your-jwt',
  });

  const search = async (query: string) => {
    await execute({
      target: 'awi://linkedin.com/jobs/search/v1',
      params: { query },
    });
  };

  return (
    <div>
      {loading && <Spinner />}
      {error && <Error message={error.message} />}
      {data && <JobList jobs={data} />}
      {metrics && <div>Latency: {metrics.latency_ms}ms</div>}
    </div>
  );
}
```

## Site SDK (For Website Operators)

```bash
npm install @awi-protocol/site-sdk
```

```typescript
import { AWISite } from '@awi-protocol/site-sdk';
import express from 'express';

const app = new AWISite();

// Define agent-native endpoints
app.route('/jobs/search', (req, res) => {
  const { query, location } = req.body.params;
  const jobs = database.search(query, location);

  res.json({
    success: true,
    data: jobs,
  });
});

// Mount on your Express app
const server = express();
server.use('/awi', app.middleware());
server.listen(3000);
```

## License

MIT
