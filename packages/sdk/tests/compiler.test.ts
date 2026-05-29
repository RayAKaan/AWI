import { describe, it, expect } from 'vitest';
import { AXIRCompiler } from '../src/index';

const searchHtml = `<!DOCTYPE html><html><body>
  <header><nav><a href="/">Home</a><a href="/jobs">Jobs</a></nav></header>
  <main id="content">
    <form role="search" id="search-form">
      <input type="text" name="q" placeholder="Search jobs..." aria-label="Search query" />
      <input type="text" name="l" placeholder="Location" />
      <select name="remote"><option value="">Any</option><option value="hybrid">Hybrid</option></select>
      <button type="submit">Search</button>
    </form>
    <div class="results" role="list">
      <div class="job-item" role="listitem"><h2><a href="/job/1">Software Engineer</a></h2><p>Remote - $120k</p></div>
      <div class="job-item" role="listitem"><h2><a href="/job/2">Frontend Developer</a></h2><p>NYC - $110k</p></div>
    </div>
    <div class="pagination"><a href="?page=2">2</a><a href="?page=3">3</a><a href="?page=2">Next</a></div>
  </main>
</body></html>`;

const formHtml = `<!DOCTYPE html><html><body>
  <form id="login-form">
    <label for="username">Username</label>
    <input id="username" type="text" name="username" required />
    <label for="password">Password</label>
    <input id="password" type="password" name="password" required />
    <button type="submit">Sign In</button>
  </form>
</body></html>`;

const emptyHtml = `<!DOCTYPE html><html><body><p>Hello world</p></body></html>`;

const obfuscatedHtml = `<!DOCTYPE html><html><body>
  <div class="a1b2c3d4 css-abc123">
    <form class="js-form x7y8z9">
      <input class="ng-untouched iv3f9k2m" name="email" type="email" placeholder="Email" />
      <button class="css-xyz btn-primary">Submit</button>
    </form>
  </div>
</body></html>`;

describe('AXIRCompilerV2', () => {
  it('compiles a search page and returns correct structure', () => {
    const compiler = new AXIRCompiler(searchHtml, { intent: 'search_jobs', domain: 'example.com' });
    const result = compiler.compile();
    expect(result).toBeDefined();
    expect(result.model_used).toBe('axir-deterministic-v2');
    expect(result.compilation_time_ms).toBeGreaterThanOrEqual(0);
    expect(result.workflow.domain).toBe('example.com');
    expect(result.workflow.page_type).toBe('search');
    expect(Object.keys(result.workflow.nodes).length).toBeGreaterThanOrEqual(2);
    expect(result.workflow.entry_points.length).toBeGreaterThan(0);
  });

  it('detects search region with inputs and button', () => {
    const compiler = new AXIRCompiler(searchHtml, { intent: 'search_jobs' });
    const result = compiler.compile();
    expect(result.selectors).toBeDefined();
    const containerSelector = result.selectors['container'];
    expect(containerSelector).toBeDefined();
    expect(containerSelector.length).toBeGreaterThan(0);
    expect(containerSelector[0].confidence).toBeGreaterThan(0.5);
  });

  it('generates selectors for form fields', () => {
    const compiler = new AXIRCompiler(searchHtml, { intent: 'search_jobs' });
    const result = compiler.compile();
    const fieldNames = Object.keys(result.selectors).filter(k => k !== 'container' && !k.startsWith('link_') && !k.startsWith('btn_'));
    expect(fieldNames.length).toBeGreaterThanOrEqual(1);
    const btnNames = Object.keys(result.selectors).filter(k => k.startsWith('btn_'));
    expect(btnNames.length).toBeGreaterThanOrEqual(1);
  });

  it('generates fields array with transforms', () => {
    const compiler = new AXIRCompiler(searchHtml, { intent: 'search_jobs' });
    const result = compiler.compile();
    expect(result.fields.length).toBeGreaterThanOrEqual(3);
    const remoteField = result.fields.find(f => f.name.includes('remote'));
    if (remoteField) expect(remoteField.transform).toBe('select');
  });

  it('detects form intent correctly on form page', () => {
    const compiler = new AXIRCompiler(formHtml, { intent: 'login' });
    const result = compiler.compile();
    expect(result.workflow.page_type).toBe('form');
    expect(result.fields.length).toBeGreaterThanOrEqual(2);
    expect(result.intents.length).toBeGreaterThanOrEqual(1);
    expect(result.intents[0].intent).toBe('login');
    expect(result.intents[0].action).toBe('fill_and_submit');
  });

  it('infers field names from labels', () => {
    const compiler = new AXIRCompiler(formHtml, { intent: 'login' });
    const result = compiler.compile();
    const fieldNames = result.fields.map(f => f.name);
    expect(fieldNames).toContain('username');
    expect(fieldNames).toContain('password');
  });

  it('uses ID selectors with highest priority', () => {
    const compiler = new AXIRCompiler(searchHtml, { intent: 'search_jobs' });
    const result = compiler.compile();
    const container = result.selectors['container'];
    expect(container[0].priority).toBe(1);
  });

  it('filters out hidden elements', () => {
    const html = `<!DOCTYPE html><html><body>
      <form><input name="visible" /><input name="hidden" type="hidden" />
      <div style="display:none"><input name="invisible" /></div>
      <button type="submit">Go</button></form></body></html>`;
    const compiler = new AXIRCompiler(html, { intent: 'search' });
    const result = compiler.compile();
    const vKeys = Object.keys(result.selectors).filter(k => k.includes('visible'));
    const hKeys = Object.keys(result.selectors).filter(k => k.includes('invisible') || k.startsWith('hidden'));
    expect(vKeys.length).toBeGreaterThan(0);
    expect(hKeys.length).toBe(0);
  });

  it('handles empty HTML gracefully', () => {
    const compiler = new AXIRCompiler(emptyHtml, { intent: 'scrape' });
    const result = compiler.compile();
    expect(result).toBeDefined();
    expect(result.workflow.page_type).toBe('unknown');
    expect(result.compilation_time_ms).toBeGreaterThanOrEqual(0);
  });

  it('handles obfuscated class detection', () => {
    const compiler = new AXIRCompiler(obfuscatedHtml, { intent: 'fill_form' });
    const result = compiler.compile();
    const containerSelectors = result.selectors['container'] || [];
    const allCss = containerSelectors.filter(s => s.type === 'css').map(s => s.value).join(' ');
    const hasObfuscated = allCss.includes('iv3f9k2m') || allCss.includes('a1b2c3d4') || allCss.includes('x7y8z9');
    expect(hasObfuscated).toBe(false);
  });

  it('resolves compile options domain correctly', () => {
    const compiler = new AXIRCompiler(searchHtml, { intent: 'search', domain: 'test.example' });
    const result = compiler.compile();
    expect(result.workflow.domain).toBe('test.example');
  });

  it('generates at most one container selector entry', () => {
    const compiler = new AXIRCompiler(searchHtml, { intent: 'search_jobs' });
    const result = compiler.compile();
    const containerKeys = Object.keys(result.selectors).filter(k => k === 'container');
    expect(containerKeys.length).toBe(1);
  });

  it('supports extract_list intent on search page with listings', () => {
    const compiler = new AXIRCompiler(searchHtml, { intent: 'extract_list' });
    const result = compiler.compile();
    expect(result.workflow.page_type).toBe('listing');
    expect(result.intents[0].intent).toBe('extract_list');
  });

  it('validates CSS selectors return expected output shape', () => {
    const compiler = new AXIRCompiler(searchHtml, { intent: 'search_jobs' });
    const result = compiler.compile();
    for (const [, candidates] of Object.entries(result.selectors)) {
      expect(candidates.length).toBeGreaterThan(0);
      for (const c of candidates) {
        expect(c.type).toMatch(/^(css|semantic|text)$/);
        expect(c.priority).toBeGreaterThanOrEqual(1);
        expect(c.confidence).toBeGreaterThan(0);
      }
    }
  });
});
