import * as cheerio from 'cheerio';
import type {
  AXIRCompilationResult, AXIRNode, AXIREdge, AXIRWorkflow,
  AXIRIntentMapping, AXIRField, SelectorCandidate,
} from './types';

export interface CompileOptions {
  intent: string;
  params?: Record<string, unknown>;
  domain?: string;
}

export class AXIRCompiler {
  private $: cheerio.CheerioAPI;
  private intent: string;
  private params: Record<string, unknown>;
  private domain: string;

  constructor(html: string, options: CompileOptions) {
    this.$ = cheerio.load(html);
    this.intent = options.intent;
    this.params = options.params || {};
    this.domain = options.domain || 'unknown';
  }

  compile(): AXIRCompilationResult {
    const start = Date.now();
    this.simplifyDOM();
    const regions = this.identifyRegions();
    const target = this.routeIntent(regions);
    return {
      workflow: this.buildWorkflow(target, regions),
      intents: this.mapIntents(),
      selectors: this.generateSelectors(target),
      fields: this.generateFields(target),
      container: target.container,
      model_used: 'axir-deterministic-v1',
      tokens_used: 0,
      compilation_time_ms: Date.now() - start,
    };
  }

  private simplifyDOM(): void {
    this.$('script, style, svg, noscript, iframe, canvas, video, audio').remove();
    for (const el of this.$('div, span').toArray()) {
      const $el = this.$(el);
      if ($el.children().length === 0 && $el.text().trim() === '') $el.remove();
    }
    this.$('[style*="display:none"], [style*="display: none"], [hidden], [aria-hidden="true"]').remove();
  }

  private identifyRegions(): SemanticRegion[] {
    const regions: SemanticRegion[] = [];
    for (const el of this.$('form, [role="search"], input[type="search"]').toArray()) {
      const r = this.analyzeSearchRegion(this.$(el));
      if (r) regions.push(r);
    }
    for (const el of this.$('nav, [role="navigation"], header, .nav, .navbar, .menu').toArray()) {
      regions.push({ type: 'navigation', element: this.$(el), confidence: 0.9 });
    }
    for (const el of this.$('ul, ol, [role="list"], .list, .results, .items, table, [role="grid"]').toArray()) {
      const $el = this.$(el);
      if ($el.find('li, tr, .item, [role="listitem"]').length > 1) {
        regions.push({ type: 'listing', element: $el, confidence: 0.85 });
      }
    }
    for (const el of this.$('form').toArray()) {
      const $el = this.$(el);
      if (!regions.some(r => r.element.is!($el))) regions.push({ type: 'form', element: $el, confidence: 0.9 });
    }
    for (const el of this.$('.pagination, .pager, .pages').toArray()) {
      if (this.isPagination(this.$(el))) regions.push({ type: 'pagination', element: this.$(el), confidence: 0.8 });
    }
    for (const el of this.$('article, [role="article"], .content, .main, main, .detail').toArray()) {
      regions.push({ type: 'detail', element: this.$(el), confidence: 0.75 });
    }
    return regions;
  }

  private analyzeSearchRegion($el: cheerio.Cheerio<any>): SemanticRegion | null {
    const hasInput = $el.find('input[type="text"], input[type="search"], input:not([type])').length > 0;
    const hasButton = $el.find('button, input[type="submit"]').length > 0;
    if (hasInput || hasButton) return { type: 'search', element: $el, confidence: hasInput && hasButton ? 0.95 : 0.7 };
    return null;
  }

  private isPagination($el: cheerio.Cheerio<any>): boolean {
    const text = $el.text().toLowerCase();
    return /\d+/.test(text) && (/next|>|\u203a|\u2192|\u00bb/.test(text) || /prev|previous|<|\u2039|\u2190|\u00ab/.test(text));
  }

  private routeIntent(regions: SemanticRegion[]): TargetRegion {
    const intentMap: Record<string, string[]> = {
      search: ['search', 'form'],
      search_jobs: ['search', 'listing', 'form'],
      extract_list: ['listing', 'search', 'detail'],
      extract_detail: ['detail', 'listing'],
      fill_form: ['form', 'search'],
      navigate: ['navigation', 'listing'],
      login: ['form'],
      filter: ['search', 'listing'],
      sort: ['listing', 'search'],
      scrape: ['listing', 'detail', 'search'],
    };
    const targetTypes = intentMap[this.intent.toLowerCase()] || ['search', 'listing', 'form'];
    let best: SemanticRegion | null = null;
    let bestScore = 0;
    for (const r of regions) {
      const match = targetTypes.indexOf(r.type);
      const score = match >= 0 ? (targetTypes.length - match) * r.confidence : 0;
      if (score > bestScore) { bestScore = score; best = r; }
    }
    if (!best) best = this.findLargestRegion(regions);
    return { region: best, container: this.generateContainerSelector(best.element) };
  }

  private findLargestRegion(regions: SemanticRegion[]): SemanticRegion {
    if (regions.length === 0) return { type: 'unknown', element: this.$('body'), confidence: 0.5 };
    return regions.reduce((l, c) => c.element.find('*').length > l.element.find('*').length ? c : l);
  }

  private buildWorkflow(_target: TargetRegion, all: SemanticRegion[]): AXIRWorkflow {
    const nodes: Record<string, AXIRNode> = {};
    const edges: AXIREdge[] = [];
    const entry: string[] = [];
    const exit: string[] = [];
    all.forEach((r, i) => {
      const id = `${r.type}_${i}`;
      const raw = r.element[0] as any;
      nodes[id] = {
        node_id: id,
        element_type: this.mapType(r.type),
        semantic_role: r.type,
        intent: this.intent,
        tag: raw?.tagName?.toLowerCase(),
        selector_candidates: this.buildCandidates(r.element),
        confidence: r.confidence,
      };
      if (r.type === 'navigation') entry.push(id);
      if (r.type === 'listing' || r.type === 'detail') exit.push(id);
    });
    all.forEach((f, fi) => all.forEach((t, ti) => {
      if (fi !== ti) {
        const e = this.inferEdge(f, t, fi, ti);
        if (e) edges.push(e);
      }
    }));
    if (entry.length === 0 && Object.keys(nodes).length > 0) entry.push(Object.keys(nodes)[0]);
    return { nodes, edges, entry_points: entry, exit_points: exit, domain: this.domain, page_type: this.inferPageType(all) };
  }

  private mapType(t: string): AXIRNode['element_type'] {
    const m: Record<string, AXIRNode['element_type']> = {
      search: 'search', navigation: 'navigation', listing: 'list',
      form: 'form', pagination: 'pagination', detail: 'container',
    };
    return m[t] || 'unknown';
  }

  private inferEdge(f: SemanticRegion, t: SemanticRegion, fi: number, ti: number): AXIREdge | null {
    if (f.type === 'search' && t.type === 'listing') return { from_node: `search_${fi}`, to_node: `listing_${ti}`, action: 'submit_search', probability: 0.9 };
    if (f.type === 'navigation' && t.type === 'search') return { from_node: `navigation_${fi}`, to_node: `search_${ti}`, action: 'navigate_to_search', probability: 0.7 };
    if (f.type === 'listing' && t.type === 'pagination') return { from_node: `listing_${fi}`, to_node: `pagination_${ti}`, action: 'next_page', probability: 0.8 };
    if (f.type === 'pagination' && t.type === 'listing') return { from_node: `pagination_${fi}`, to_node: `listing_${ti}`, action: 'load_results', probability: 0.95 };
    return null;
  }

  private inferPageType(regions: SemanticRegion[]): AXIRWorkflow['page_type'] {
    const t = regions.map(r => r.type);
    if (t.includes('search') && t.includes('listing')) return 'search';
    if (t.includes('listing')) return 'listing';
    if (t.includes('form')) return 'form';
    if (t.includes('search')) return 'search';
    if (t.includes('navigation')) return 'landing';
    return 'unknown';
  }

  private generateSelectors(target: TargetRegion): Record<string, SelectorCandidate[]> {
    const s: Record<string, SelectorCandidate[]> = {};
    const $el = target.region.element;
    s.container = this.buildCandidates($el);
    for (const el of $el.find('input, textarea, select').toArray()) {
      const n = this.inferFieldName(this.$(el));
      if (n) s[n] = this.buildCandidates(this.$(el));
    }
    for (const el of $el.find('button, input[type="submit"], input[type="button"]').toArray()) {
      const $btn = this.$(el);
      const label = $btn.text().trim() || String($btn.val() || 'button');
      s[`btn_${this.slugify(label)}`] = this.buildCandidates($btn);
    }
    for (const el of $el.find('a').toArray()) {
      const $a = this.$(el);
      const t = $a.text().trim();
      if (t && t.length < 50) s[`link_${this.slugify(t)}`] = this.buildCandidates($a);
    }
    return s;
  }

  private buildCandidates($el: cheerio.Cheerio<any>): SelectorCandidate[] {
    const c: SelectorCandidate[] = [];
    const el = $el[0];
    if (!el) return c;
    const id = $el.attr('id');
    if (id && !id.match(/^\d/)) c.push({ type: 'css', value: `#${this.escape(id)}`, priority: 1, confidence: 0.99 });
    const classes = ($el.attr('class') || '').split(/\s+/).filter((x: string) => x && !x.match(/^js-|^ng-|^vue-|^data-/));
    if (classes.length) c.push({ type: 'css', value: `.${classes.map((x: string) => this.escape(x)).join('.')}`, priority: 2, confidence: 0.85 });
    const raw = el as any;
    const tag = raw.tagName?.toLowerCase() || '';
    const name = $el.attr('name');
    const type = $el.attr('type');
    const placeholder = $el.attr('placeholder');
    if (name) c.push({ type: 'css', value: `${tag}[name="${this.q(name)}"]`, priority: 3, confidence: 0.9 });
    if (type) c.push({ type: 'css', value: `${tag}[type="${type}"]`, priority: 4, confidence: 0.8 });
    if (placeholder) c.push({ type: 'css', value: `${tag}[placeholder="${this.q(placeholder)}"]`, priority: 5, confidence: 0.75 });
    const role = $el.attr('role');
    if (role) c.push({ type: 'semantic', value: `[role="${role}"]`, priority: 6, confidence: 0.9 });
    const al = $el.attr('aria-label');
    if (al) c.push({ type: 'semantic', value: `[aria-label="${this.q(al)}"]`, priority: 7, confidence: 0.85 });
    const text = $el.text().trim();
    if (text && text.length < 100) c.push({ type: 'text', value: text, priority: 8, confidence: 0.7 });
    return c;
  }

  private generateFields(target: TargetRegion): AXIRField[] {
    const f: AXIRField[] = [];
    for (const el of target.region.element.find('input, textarea, select').toArray()) {
      const $el = this.$(el);
      const name = this.inferFieldName($el);
      if (!name) continue;
      f.push({
        name,
        selector: this.bestSelector($el),
        transform: this.inferTransform($el),
        required: $el.attr('required') !== undefined,
      });
    }
    return f;
  }

  private inferFieldName($el: cheerio.Cheerio<any>): string | null {
    const id = $el.attr('id');
    if (id) {
      const $l = this.$(`label[for="${id}"]`);
      if ($l.length) return this.slugify($l.text());
    }
    const ph = $el.attr('placeholder');
    if (ph) return this.slugify(ph);
    const al = $el.attr('aria-label');
    if (al) return this.slugify(al);
    const n = $el.attr('name');
    if (n) return this.slugify(n);
    return null;
  }

  private inferTransform($el: cheerio.Cheerio<any>): string | undefined {
    const t = $el.attr('type');
    if (t === 'number') return 'number';
    if (t === 'email') return 'email';
    if (t === 'date') return 'date';
    if (t === 'checkbox') return 'boolean';
    if ($el.is('select')) return 'select';
    return undefined;
  }

  private bestSelector($el: cheerio.Cheerio<any>): string {
    const c = this.buildCandidates($el);
    if (c.length) return c[0].value;
    const raw = $el[0] as any;
    return raw?.tagName?.toLowerCase() || '*';
  }

  private generateContainerSelector($el: cheerio.Cheerio<any>): string {
    const c = this.buildCandidates($el);
    return c.length ? c[0].value : 'body';
  }

  private mapIntents(): AXIRIntentMapping[] {
    const m: Record<string, AXIRIntentMapping> = {
      search: { intent: 'search', action: 'fill_and_submit', parameters: ['query', 'location', 'filters'], context: 'Enter search terms and submit form' },
      search_jobs: { intent: 'search_jobs', action: 'fill_and_submit', parameters: ['query', 'location', 'experience_level', 'job_type'], context: 'Search for job listings with optional filters' },
      extract_list: { intent: 'extract_list', action: 'extract_fields', parameters: ['items', 'title', 'url', 'metadata'], context: 'Extract structured data from list items' },
      extract_detail: { intent: 'extract_detail', action: 'extract_fields', parameters: ['title', 'description', 'metadata', 'links'], context: 'Extract structured data from detail page' },
      fill_form: { intent: 'fill_form', action: 'fill_and_submit', parameters: Object.keys(this.params), context: 'Fill form fields with provided parameters' },
      navigate: { intent: 'navigate', action: 'click', parameters: ['target_url', 'link_text'], context: 'Click navigation link to target page' },
      login: { intent: 'login', action: 'fill_and_submit', parameters: ['username', 'password'], context: 'Enter credentials and submit login form' },
      scrape: { intent: 'scrape', action: 'extract_fields', parameters: ['all_visible_text', 'links', 'images', 'structured_data'], context: 'Extract all visible content from the page' },
    };
    const mapped = m[this.intent.toLowerCase()];
    if (mapped) return [mapped];
    return [{ intent: this.intent, action: 'interact', parameters: Object.keys(this.params), context: `Perform ${this.intent} on the page` }];
  }

  private slugify(t: string): string {
    return t.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '_').replace(/^_|_$/g, '').substring(0, 50);
  }

  private escape(s: string): string {
    return s.replace(/([:.])/g, '\\$1');
  }

  private q(s: string): string {
    return s.replace(/"/g, '\\"');
  }
}

interface SemanticRegion { type: string; element: cheerio.Cheerio<any>; confidence: number; }
interface TargetRegion { region: SemanticRegion; container: string; }
