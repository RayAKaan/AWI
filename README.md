# AWI Protocol

**Turn a website into something an AI agent can use deterministically, without scraping it blind every time.**

AWI (Agent Web Interface) is a small protocol plus a TypeScript SDK for describing *how to do a thing on a website* — search, log in, submit a form — as a structured, hashable, optionally-signed **Recipe**, instead of re-deriving it from raw HTML on every agent run. A recipe is resolved once, then reused, verified, and executed locally.

```
@awi-protocol/types     canonical Recipe / RecipeStep / ExecutionResult definitions
@awi-protocol/sdk       resolve, verify, execute, sign, sync, and author recipes
@awi-protocol/site-sdk  expose agent-native endpoints from your own site
@awi-protocol/react     React hooks over the SDK
```

## Why a recipe instead of a scraper

A scraper re-parses a page's DOM every time it runs and breaks the moment a class name changes. A recipe is a small, typed description of a workflow — the steps, the selectors, a content hash, optionally a signature — that an agent resolves once and replays deterministically. If the recipe's hash doesn't match its own content, or its signature doesn't verify against its claimed public key, the SDK refuses to run it rather than executing something tampered with.

That's not a marketing description — it's what `RecipeSigner.verify()` and the hash check in the registry actually do, and it's exercised directly in the test suite (tamper a signed recipe's steps, confirm verification fails; corrupt a recipe's hash, confirm the registry rejects it).

## Packages

| Package | What it is | Version |
|---|---|---|
| [`@awi-protocol/types`](./packages/types) | Shared `Recipe`, `RecipeStep`, `ExecutionResult`, `SecurityPolicy` and related types every other package builds on | 0.3.0 |
| [`@awi-protocol/sdk`](./packages/sdk) | The actual engine: recipe registry, local + native executors, the AXIR compiler, signing, capability-based security, rate limiting, P2P sync | 0.3.0 |
| [`@awi-protocol/site-sdk`](./packages/site-sdk) | Helpers for a site owner to publish agent-native endpoints and export recipes, with CORS handling | 0.3.0 |
| [`@awi-protocol/react`](./packages/react) | `useAWI` / `useAWIP2P` hooks for wiring the SDK into a React app | 0.3.0 |

## Quickstart

These packages are published on npm under the `@awi-protocol` scope:

```bash
npm install @awi-protocol/sdk
```

The published package currently sits at `1.0.1` on the npm registry, a few versions ahead of the `0.3.0` snapshot this README otherwise describes (`0.1.0` → `0.1.1` → `0.2.0` → `0.2.1` → `0.3.0` → `1.0.0` → `1.0.1` — a real, steady release history, all maintained from this repo). If you're reading the source directly rather than installing from npm, the API shapes below match what's in `main` as of this README, not necessarily `1.0.1` on the wire — worth a quick diff if precision matters for your use case.

To build from source instead:

```bash
git clone https://github.com/RayAKaan/AWI.git
cd AWI
pnpm install
pnpm build
```

```bash
pnpm test
```

This builds all four packages with `tsup` and runs the suite with `vitest`. As of this README, that's **104 passing tests** across compiler, registry, executor, security, sync, and concurrency coverage. One test file (`client.test.ts`, exercising the legacy `AWIClient`) currently fails to *load* — not fail its assertions — because the `msw` mocking package isn't yet listed as a devDependency; the other 104 are unaffected by this and run clean. Filed here rather than smoothed over, because that's the kind of gap that should be visible, not discovered later.

### Using the SDK

The canonical v0.3.0 surface runs recipes locally — no server in the loop unless the recipe itself calls one:

```typescript
import { AWI } from '@awi-protocol/sdk';

// Resolve and run a recipe by its awi:// URI
const result = await AWI.run('awi://github.com/repos/search/v1', {
  query: 'machine learning',
});

if (result.success) {
  console.log(result.data);
}

// Or hand it a Recipe object directly
const recipe = await AWI.discoverSite('https://example.com');
await AWI.runRecipe(recipe[0], { query: 'test' });
```

Capability grants and rate limits are explicit, not implicit:

```typescript
AWI.grantCapability('github.com', 'read', /* ttlDays */ 30);
```

### Recipe authoring & signing

```bash
npx awi-author sign-recipe ./my-recipe.json --key ./private.pem
npx awi-author verify ./my-recipe.signed.json
```

Signing uses Node's built-in `crypto` module (`SHA256`, PEM keys) — `RecipeSigner.sign()` writes a hash and signature into the recipe's `meta`, and `RecipeSigner.verify()` is a static check anyone can run against a recipe without holding the private key.

### Security boundary

The default policy blocks recipes targeting `localhost`, `127.0.0.1`, `0.0.0.0`, and private ranges unless explicitly whitelisted — this is enforced in `PolicyEnforcer`, not just documented, and it's what the "Security Boundary Torture" section of the test suite is actually torturing.

```typescript
import { DEFAULT_POLICY, STRICT_POLICY } from '@awi-protocol/sdk';
```

`STRICT_POLICY` additionally rejects any recipe without a valid signature.

## A note on versions in this repo

You'll see two API shapes if you read the source: a current, local-first one (`AWISDK`, `run`, `runRecipe`, `NativeExecutor` / `LocalExecutor`) and a legacy client/server one (`AWIClient`, `client.execute()` against a remote endpoint). Both are real and both are exported — the legacy path is kept as a backward-compatible alias layer, not removed code. `examples/node-scraper` currently shows the legacy `AWIClient` shape; if you're starting fresh, prefer the `AWISDK` examples above. `packages/sdk/README.md` documents the legacy v2.1 surface in more depth and is due for a pass to reflect v0.3.0 — noting that here so it's a known gap rather than a silent inconsistency.

## Architecture, briefly

- **Registry** (`registry.ts`) resolves recipes from seed data, a local DB, or remote sources, in that priority order, and deduplicates by content hash.
- **Executors**: `LocalExecutor` runs steps via Playwright/cheerio in-process; `NativeExecutor` handles `jsRequired: false` recipes over plain HTTP without spinning up a browser. The SDK picks one automatically per recipe via `supports()`.
- **AXIR compiler** (`compiler/axir-compiler-v2.ts`) compiles higher-level intent into the executable recipe graph; v1 is kept alongside it, not deleted.
- **Sync** (`sync.ts`) applies patches from a remote registry and persists a checkpoint, designed to degrade safely — a bad remote URL or a failed fetch doesn't crash the SDK, it's just absorbed and logged.
- **FileSystemDB** (`db.ts`) is the local persistence layer; it's specifically tested to recover from a corrupted `index.json` by resetting rather than crashing the process.

## Examples

- [`examples/node-scraper`](./examples/node-scraper) — minimal Node script using the legacy client
- [`examples/nextjs-agent`](./examples/nextjs-agent) — Next.js integration

## Contributing

This is a `pnpm` + `turbo` monorepo using `changesets` for versioning. `pnpm build` and `pnpm test` at the root run across all four packages via Turborepo's task graph; `.changeset/config.json` governs how version bumps and changelogs are generated on release.

## License

MIT
