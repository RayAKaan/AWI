#!/usr/bin/env node
import { AWISDK } from './sdk';

const awi = new AWISDK();

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'discover':
    case 'inspect': {
      const target = args[1];
      if (!target) { console.error('Usage: npx awi discover <url>'); process.exit(1); }
      const result = await awi.discover(target);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'run':
    case 'execute': {
      const uri = args[1];
      if (!uri) { console.error('Usage: npx awi run <awi://uri> [--key value ...]'); process.exit(1); }

      const params: Record<string, string> = {};
      for (let i = 2; i < args.length; i++) {
        if (args[i].startsWith('--')) {
          const key = args[i].slice(2);
          if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
            params[key] = args[i + 1];
            i++;
          } else {
            params[key] = 'true';
          }
        }
      }

      console.log(`Running ${uri}...`);
      const result = await awi.run(uri, params);
      console.log(result.success ? 'SUCCESS' : 'FAILED');
      if (result.data) console.log(JSON.stringify(result.data, null, 2));
      if (result.errors.length > 0) console.error('Errors:', result.errors);
      process.exit(result.success ? 0 : 1);
    }

    case 'list': {
      const domain = args[1];
      const recipes = await awi.listRecipes(domain);
      console.table(recipes.map(r => ({
        domain: r.domain,
        action: r.action,
        version: r.version,
        trust: r.trustScore,
        author: r.author,
        tags: r.tags.join(', '),
      })));
      break;
    }

    case 'stats': {
      const stats = await awi.stats();
      console.log('AWI-P2P Status');
      console.log(`  Recipes cached: ${stats.recipes}`);
      console.log(`  Domains:        ${stats.domains.join(', ') || '(none)'}`);
      console.log(`  Last sync:      ${stats.lastSync || 'never'}`);
      console.log(`  Node:           ${process.version}`);
      break;
    }

    case 'grant': {
      const domain = args[1];
      const perm = args[2];
      if (!domain || !perm) { console.error('Usage: npx awi grant <domain> <permission>'); process.exit(1); }
      awi.grantCapability(domain, perm);
      console.log(`Granted ${perm} on ${domain}`);
      break;
    }

    default:
      console.log(`
AWI Protocol SDK v3.0.0-p2p — Decentralized Web Automation

Usage:
  npx awi discover <url>              Inspect a website locally (no auth)
  npx awi run <awi://uri>             Execute a recipe in local browser
  npx awi list [domain]               List cached recipes
  npx awi stats                       Show local node status
  npx awi grant <domain> <perm>       Grant capability

Examples:
  npx awi discover https://github.com
  npx awi run awi://github.com/repos/search/v1 --query "machine learning"
  npx awi run awi://wikipedia.org/article/read/v1 --title "Artificial_intelligence"

Environment:
  AWI_DATA_DIR    Local storage path (default: ./.awi)
      `.trim());
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
}).finally(() => {
  awi.stop();
});
