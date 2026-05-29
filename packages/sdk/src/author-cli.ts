#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { hashRecipe } from './db';
import { RecipeSigner } from './security';
import type { Recipe, RecipeStep, Action } from '@awi-protocol/types';

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(q: string): Promise<string> {
  return new Promise(resolve => rl.question(q, resolve));
}

async function createRecipe() {
  console.log('\nAWI Recipe Creator\n');

  const domain = await ask('Domain (e.g., github.com): ');
  const action = await ask('Action name (e.g., repos/search): ');
  const version = await ask('Version (e.g., v1): ') || 'v1';
  const author = await ask('Author (your name/handle): ') || 'anonymous';

  const steps: RecipeStep[] = [];
  let stepNum = 1;

  while (true) {
    console.log(`\n--- Step ${stepNum} ---`);
    const actionType = await ask('Action (navigate/type/click/wait/extract/submit/select/hover/press) [done]: ');
    if (!actionType || actionType === 'done') break;

    const target = await ask('Target (CSS selector or URL): ');
    const value = await ask('Value/template (or blank): ') || undefined;
    const reason = await ask('Reason/description: ');
    const fallback = await ask('Fallback selector (or blank): ') || undefined;
    const optional = (await ask('Optional? (y/n): ')).toLowerCase() === 'y';

    steps.push({
      step_number: stepNum,
      action: actionType as Action,
      target: target || undefined,
      value,
      reason,
      fallback,
      optional,
    });
    stepNum++;
  }

  const recipe: Recipe = {
    meta: {
      domain,
      action,
      version,
      hash: '',
      trustScore: 0.0,
      permissions: ['read:public'],
      jsRequired: steps.some(s => s.action === 'click' || s.action === 'type'),
      authRequired: false,
      rateLimitTag: domain,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      author,
      tags: [],
    },
    steps,
  };

  recipe.meta.hash = hashRecipe(recipe);

  const filename = `${domain.replace(/\./g, '-')}-${action.replace(/\//g, '-')}-${version}.json`;
  writeFileSync(filename, JSON.stringify(recipe, null, 2));
  console.log(`\nRecipe saved to ${filename}`);
  console.log(`   Hash: ${recipe.meta.hash}`);
  console.log(`   URI:  awi://${domain}/${action}/${version}`);
}

async function signRecipe(path: string) {
  if (!existsSync(path)) {
    console.error(`File not found: ${path}`);
    process.exit(1);
  }

  const recipe: Recipe = JSON.parse(readFileSync(path, 'utf-8'));
  const privateKey = await ask('Private key (PEM, or "mock" for testing): ');
  const publicKey = await ask('Public key (PEM, or "mock" for testing): ');

  const signer = new RecipeSigner(privateKey, publicKey);
  const signed = signer.sign(recipe);

  writeFileSync(path, JSON.stringify(signed, null, 2));
  console.log(`Signed recipe saved to ${path}`);
  console.log(`   Signature: ${signed.meta.signature?.slice(0, 32)}...`);
}

async function validateRecipe(path: string) {
  if (!existsSync(path)) {
    console.error(`File not found: ${path}`);
    process.exit(1);
  }

  const recipe: Recipe = JSON.parse(readFileSync(path, 'utf-8'));
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!recipe.meta?.domain) errors.push('Missing meta.domain');
  if (!recipe.meta?.action) errors.push('Missing meta.action');
  if (!recipe.meta?.version) errors.push('Missing meta.version');
  if (!recipe.steps || recipe.steps.length === 0) errors.push('No steps defined');

  recipe.steps?.forEach((step, i) => {
    if (!step.action) errors.push(`Step ${i + 1}: missing action`);
    if (!step.reason) warnings.push(`Step ${i + 1}: missing reason`);
    if (step.step_number !== i + 1) warnings.push(`Step ${i + 1}: step_number mismatch`);
  });

  const computed = hashRecipe(recipe);
  if (recipe.meta?.hash && recipe.meta.hash !== computed) {
    errors.push(`Hash mismatch: stored=${recipe.meta.hash}, computed=${computed}`);
  }

  if (recipe.meta?.signature) {
    const { RecipeSigner } = await import('./security');
    const valid = RecipeSigner.verify(recipe);
    if (!valid) errors.push('Signature verification failed');
  }

  console.log(`\nValidation Results for ${path}`);
  console.log(`   Errors:   ${errors.length}`);
  console.log(`   Warnings: ${warnings.length}`);

  if (errors.length > 0) {
    console.log('\n   Errors:');
    errors.forEach(e => console.log(`      ${e}`));
  }
  if (warnings.length > 0) {
    console.log('\n   Warnings:');
    warnings.forEach(w => console.log(`      ${w}`));
  }

  if (errors.length === 0) {
    console.log('\n   Recipe is valid');
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

async function main() {
  const command = process.argv[2];
  const arg = process.argv[3];

  switch (command) {
    case 'create-recipe':
      await createRecipe();
      break;
    case 'sign-recipe':
      if (!arg) { console.error('Usage: npx awi sign-recipe <file.json>'); process.exit(1); }
      await signRecipe(arg);
      break;
    case 'validate-recipe':
      if (!arg) { console.error('Usage: npx awi validate-recipe <file.json>'); process.exit(1); }
      await validateRecipe(arg);
      break;
    default:
      console.log(`
AWI Recipe Authoring Tools

Usage:
  npx awi create-recipe              Interactive recipe builder
  npx awi sign-recipe <file.json>   Sign with your key
  npx awi validate-recipe <file.json> Check recipe integrity

A recipe is a JSON file that tells an agent how to interact with a website.
Each step is a browser action: navigate, type, click, extract, wait, etc.
      `.trim());
  }

  rl.close();
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
