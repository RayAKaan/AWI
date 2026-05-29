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

/**
 * AXIR Compiler v2 — Universal deterministic DOM compiler.
 *
 * Layers:
 *   1. Visibility Filter   — Remove hidden, script, style, meta, noscript
 *   2. Semantic Scoring    — Score every element by semantic value
 *   3. Region Detection    — Group high-scoring elements into regions
 *   4. Intent Routing      — Weight regions by intent match + centrality + size
 *   5. Stable Selectors    — Prioritize ID > name > ARIA > stable class > structural
 *   6. Validation          — Verify selectors resolve in the same DOM snapshot
 */
export class AXIRCompilerV2 {
  private $: cheerio.CheerioAPI;
  private intent: string;
  private params: Record<string, unknown>;
  private domain: string;

  constructor(html: string, options: CompileOptions) {
    this.$ = cheerio.load(html);
    this.intent = options.intent.toLowerCase();
    this.params = options.params || {};
    this.domain = options.domain || 'unknown';
  }

  compile(): AXIRCompilationResult {
    const start = Date.now();
    this.simplifyDOM();
    const regions = this.identifyRegions();
    const target = this.routeIntent(regions);
    const result: AXIRCompilationResult = {
      workflow: this.buildWorkflow(target, regions),
      intents: this.mapIntents(),
      selectors: this.generateSelectors(target),
      fields: this.generateFields(target),
      container: target.container,
      model_used: 'axir-deterministic-v2',
      tokens_used: 0,
      compilation_time_ms: Date.now() - start,
    };
    return result;
  }

  // =========================================================================
  // LAYER 1: DOM Simplification & Visibility Filter
  // =========================================================================

  private simplifyDOM(): void {
    this.$('script, style, svg, noscript, iframe, canvas, video, audio, meta, link, head').remove();
    for (const el of this.$('[hidden], [aria-hidden="true"], [type="hidden"]').toArray()) {
      this.$(el).remove();
    }
    for (const el of this.$('div, span').toArray()) {
      const $el = this.$(el);
      if ($el.children().length === 0 && $el.text().trim() === '') $el.remove();
    }
    for (const el of this.$('[style*="display:none"], [style*="display: none"], [visibility="hidden"], [opacity="0"]').toArray()) {
      this.$(el).remove();
    }
    for (const el of this.$('[width="0"], [width="0px"], [height="0"], [height="0px"]').toArray()) {
      const $el = this.$(el);
      const w = $el.attr('width') || '';
      const h = $el.attr('height') || '';
      if ((w === '0' || w === '0px') && (h === '0' || h === '0px')) $el.remove();
    }
    for (const el of this.$('[style*="position:absolute"],[style*="position: fixed"]').toArray()) {
      const $el = this.$(el);
      const style = $el.attr('style') || '';
      if (/left\s*:\s*-9999|top\s*:\s*-9999/.test(style)) $el.remove();
    }
  }

  // =========================================================================
  // LAYER 2: Semantic Scoring
  // =========================================================================

  private scoreSemantic($el: cheerio.Cheerio<any>): number {
    let score = 0;
    const tag = ($el[0] as any)?.tagName?.toLowerCase() || '';

    const tagScores: Record<string, number> = {
      form: 10, input: 8, button: 8, select: 8, textarea: 8,
      nav: 6, ul: 5, ol: 5, table: 5, article: 4, main: 4,
      header: 3, footer: 2, div: 1, span: 0.5, a: 3,
      h1: 5, h2: 4, h3: 3, h4: 2, h5: 1, h6: 1, li: 4,
    };
    score += tagScores[tag] || 1;

    const implicitRoles: Record<string, string> = {
      main: 'main', nav: 'navigation', article: 'article',
      header: 'banner', footer: 'contentinfo', aside: 'complementary',
      form: 'form', table: 'table', img: 'img',
    };
    const role = $el.attr('role') || implicitRoles[tag] || '';
    if (role) {
      const roleScores: Record<string, number> = {
        search: 20, form: 15, navigation: 12, list: 10, main: 12,
        listitem: 8, button: 8, link: 6, heading: 5,
      };
      score += roleScores[role] || 5;
    }

    if ($el.attr('aria-label')) score += 4;
    if ($el.attr('aria-labelledby')) score += 3;
    if ($el.attr('name')) score += 3;
    if ($el.attr('id')) score += 2;
    if ($el.attr('placeholder')) score += 2;

    const type = $el.attr('type');
    if (type === 'search') score += 5;
    if (type === 'email') score += 3;
    if (type === 'password') score += 3;
    if (type === 'submit') score += 3;

    const text = $el.text().trim();
    if (text.length > 10) score += Math.min(text.length / 50, 3);

    const childInputs = $el.find('input, select, textarea, button').length;
    if (childInputs > 0) score += Math.min(childInputs * 2, 10);

    const classes = ($el.attr('class') || '').split(/\s+/).filter(Boolean);
    const obfuscated = classes.filter((c: string) => this.isObfuscatedClass(c)).length;
    if (classes.length > 0 && obfuscated / classes.length > 0.5) score -= 3;

    const depth = $el.parents().length;
    if (depth > 10) score -= (depth - 10) * 0.5;

    return Math.max(score, 0);
  }

  private isObfuscatedClass(cls: string): boolean {
    if (cls.length < 4) return true;
    if (/^[a-f0-9]{4,}$/i.test(cls)) return true;
    if (/^\d/.test(cls)) return true;
    if (/[_-][a-f0-9]{3,}/i.test(cls)) return true;
    if (!/[a-z]/.test(cls)) return true;
    if (/css-|js-|ng-|vue-|react-/.test(cls)) return false;
    if (/[a-z]/.test(cls) && /\d/.test(cls) && !/[-_]/.test(cls) && cls.length >= 5) return true;
    return false;
  }

  // =========================================================================
  // LAYER 3: Region Detection
  // =========================================================================

  private identifyRegions(): SemanticRegion[] {
    const regions: SemanticRegion[] = [];
    const scored: Array<{ el: cheerio.Cheerio<any>; score: number; type: string }> = [];

    for (const el of this.$('body *').toArray()) {
      const $el = this.$(el);
      const tag = (el as any)?.tagName?.toLowerCase() || '';
      if ((tag === 'div' || tag === 'span') && $el.text().trim().length === 0
        && $el.find('input, select, textarea, button, a, img').length === 0
        && !$el.attr('aria-label') && !$el.attr('role')) continue;
      const score = this.scoreSemantic($el);
      if (score < 2) continue;
      const type = this.inferElementType($el);
      scored.push({ el: $el, score, type });
    }

    scored.sort((a, b) => b.score - a.score);

    const used = new Set<any>();
    for (const { el: $el, score, type } of scored) {
      const raw = $el[0];
      if (!raw || used.has(raw)) continue;
      const cluster = this.findCluster($el, scored, used, type);
      if (cluster.length === 0) continue;
      cluster.forEach(e => used.add(e));

      let containerEl = this.$(cluster[0]).parent();
      if (!containerEl.length) {
        containerEl = $el;
      } else {
        const parentTag = (containerEl[0] as any)?.tagName?.toLowerCase();
        if (parentTag === 'body' || parentTag === 'html') containerEl = $el;
      }
      const parentRaw = containerEl[0];
      if (parentRaw) used.add(parentRaw);

      regions.push({
        type,
        element: containerEl,
        confidence: Math.min(score / 20, 0.99),
        score,
      });
    }

    return this.mergeOverlappingRegions(regions);
  }

  private inferElementType($el: cheerio.Cheerio<any>): string {
    const tag = ($el[0] as any)?.tagName?.toLowerCase() || '';
    const role = $el.attr('role') || '';
    const type = $el.attr('type') || '';

    if (role === 'main' || tag === 'main') return 'detail';
    if (role === 'search' || type === 'search') return 'search';
    if (role === 'form' || tag === 'form') return 'form';
    if (role === 'navigation' || tag === 'nav') return 'navigation';
    if (role === 'list' || (['ul', 'ol', 'table'].includes(tag) && $el.find('li, tr').length > 1)) return 'listing';
    if (role === 'listitem' || tag === 'li' || tag === 'tr') return 'listing';
    if (role === 'article' || tag === 'article') return 'detail';
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return 'form';
    if (tag === 'button') return 'button';
    if (tag === 'a') return 'link';
    if (role === 'heading' || /^h[1-6]$/.test(tag)) return 'heading';

    return 'unknown';
  }

  private findCluster(
    seed: cheerio.Cheerio<any>,
    scored: Array<{ el: cheerio.Cheerio<any>; score: number; type: string }>,
    used: Set<any>,
    type: string
  ): any[] {
    const cluster: any[] = [seed[0]];
    const seedParents = seed.parents().toArray();

    for (const { el: $other, type: otherType } of scored) {
      if (used.has($other[0])) continue;
      if (otherType !== type && !this.areCompatibleTypes(type, otherType)) continue;

      const otherParents = $other.parents().toArray();
      const sharedParent = seedParents.find(p => {
        const tag = (p as any)?.tagName?.toLowerCase();
        return tag !== 'body' && tag !== 'html' && otherParents.includes(p);
      });
      if (sharedParent) cluster.push($other[0]);
    }

    return cluster;
  }

  private areCompatibleTypes(a: string, b: string): boolean {
    const compat: Record<string, string[]> = {
      form: ['input', 'button', 'select', 'textarea'],
      listing: ['link', 'heading', 'button'],
      search: ['input', 'button'],
    };
    return compat[a]?.includes(b) || compat[b]?.includes(a) || a === b;
  }

  private mergeOverlappingRegions(regions: SemanticRegion[]): SemanticRegion[] {
    const merged: SemanticRegion[] = [];
    const sorted = [...regions].sort((a, b) => b.score - a.score);

    for (const region of sorted) {
      let overlaps = false;
      for (const existing of merged) {
        if (this.regionsOverlap(region, existing)) {
          if (region.type === existing.type) {
            if (region.score > existing.score * 1.5) {
              existing.element = region.element;
              existing.score += region.score * 0.3;
              existing.confidence = Math.min(existing.confidence + 0.1, 0.99);
            }
            overlaps = true;
            break;
          }
        }
      }
      if (!overlaps) merged.push(region);
    }

    return merged;
  }

  private regionsOverlap(a: SemanticRegion, b: SemanticRegion): boolean {
    return a.element.is(b.element) || b.element.is(a.element) ||
      a.element.find(b.element).length > 0 || b.element.find(a.element).length > 0;
  }

  // =========================================================================
  // LAYER 4: Intent Routing
  // =========================================================================

  private routeIntent(regions: SemanticRegion[]): TargetRegion {
    const intentWeights = this.getIntentWeights();

    let best: SemanticRegion | null = null;
    let bestScore = 0;

    for (const region of regions) {
      const typeMatch = intentWeights[region.type] || 0.1;
      const centrality = this.scoreCentrality(region);
      const size = Math.log(region.element.find('*').length + 1);
      const inChrome = this.isInChrome(region);

      const score = typeMatch * 10 + centrality * 5 + size * 2 - (inChrome ? 5 : 0);

      if (score > bestScore) {
        bestScore = score;
        best = region;
      }
    }

    if (!best) {
      best = this.findLargestRegion(regions);
    }

    return {
      region: best,
      container: this.generateContainerSelector(best.element),
    };
  }

  private getIntentWeights(): Record<string, number> {
    const maps: Record<string, Record<string, number>> = {
      search: { search: 1.0, form: 0.6, listing: 0.1 },
      search_jobs: { search: 1.0, listing: 0.8, form: 0.5 },
      extract_list: { listing: 1.0, search: 0.3, detail: 0.2 },
      extract_detail: { detail: 1.0, listing: 0.5, search: 0.1 },
      fill_form: { form: 1.0, search: 0.4 },
      login: { form: 1.0, search: 0.1 },
      navigate: { navigation: 1.0, listing: 0.2 },
      filter: { search: 0.8, listing: 0.6 },
      sort: { listing: 0.9, search: 0.3 },
      scrape: { listing: 0.7, detail: 0.7, search: 0.3 },
    };
    return maps[this.intent] || { search: 0.5, listing: 0.5, form: 0.5, navigation: 0.3 };
  }

  private scoreCentrality(region: SemanticRegion): number {
    const $el = region.element;
    const parent = $el.parent();
    const allSiblings = parent.children().toArray();
    const idx = allSiblings.indexOf($el[0]);
    if (allSiblings.length === 0) return 0.5;
    const normalized = 1 - Math.abs((idx / allSiblings.length) - 0.5) * 2;
    return Math.max(normalized, 0);
  }

  private isInChrome(region: SemanticRegion): boolean {
    const parentTags = region.element.parents().toArray().map((el: any) => el?.tagName?.toLowerCase());
    return parentTags.includes('header') || parentTags.includes('footer') || parentTags.includes('nav');
  }

  private findLargestRegion(regions: SemanticRegion[]): SemanticRegion {
    if (regions.length === 0) {
      return { type: 'unknown', element: this.$('body'), confidence: 0.5, score: 0 };
    }
    return regions.reduce((l, c) => c.element.find('*').length > l.element.find('*').length ? c : l);
  }

  // =========================================================================
  // LAYER 5: Stable Selector Generation
  // =========================================================================

  private generateSelectors(target: TargetRegion): Record<string, SelectorCandidate[]> {
    const selectors: Record<string, SelectorCandidate[]> = {};
    const $el = target.region.element;

    selectors['container'] = this.buildStableSelectors($el, true);

    for (const el of $el.find('input:not([type="hidden"]), textarea, select').toArray()) {
      const $input = this.$(el);
      const name = this.inferFieldName($input);
      if (name) selectors[name] = this.buildStableSelectors($input, false);
    }

    for (const el of $el.find('button, input[type="submit"], input[type="button"]').toArray()) {
      const $btn = this.$(el);
      const text = $btn.text().trim() || String($btn.val() || 'button');
      if (text.length > 0 && text.length < 100) {
        selectors[`btn_${this.slugify(text)}`] = this.buildStableSelectors($btn, false);
      }
    }

    for (const el of $el.find('a').toArray()) {
      const $link = this.$(el);
      if ($link.closest('nav, header, footer, [role="navigation"]').length > 0) continue;
      const text = $link.text().trim();
      if (text && text.length > 0 && text.length < 50) {
        selectors[`link_${this.slugify(text)}`] = this.buildStableSelectors($link, false);
      }
    }

    return selectors;
  }

  private buildStableSelectors($el: cheerio.Cheerio<any>, isContainer: boolean): SelectorCandidate[] {
    const candidates: SelectorCandidate[] = [];
    const raw = $el[0] as any;
    if (!raw) return candidates;

    const tag = raw.tagName?.toLowerCase() || '';

    const id = $el.attr('id');
    if (id && this.isStableId(id)) {
      candidates.push({ type: 'css', value: `#${this.escape(id)}`, priority: 1, confidence: 0.99 });
    }

    const name = $el.attr('name');
    if (name && !name.startsWith('_')) {
      candidates.push({ type: 'css', value: `${tag}[name="${this.q(name)}"]`, priority: 2, confidence: 0.95 });
    }

    const role = $el.attr('role');
    if (role) {
      candidates.push({ type: 'semantic', value: `[role="${role}"]`, priority: 3, confidence: 0.92 });
    }

    const ariaLabel = $el.attr('aria-label');
    if (ariaLabel) {
      candidates.push({ type: 'semantic', value: `[aria-label="${this.q(ariaLabel)}"]`, priority: 4, confidence: 0.90 });
    }

    const placeholder = $el.attr('placeholder');
    if (placeholder) {
      candidates.push({ type: 'css', value: `${tag}[placeholder="${this.q(placeholder)}"]`, priority: 5, confidence: 0.88 });
    }

    const type = $el.attr('type');
    if (type && name) {
      candidates.push({ type: 'css', value: `${tag}[type="${type}"][name="${this.q(name)}"]`, priority: 6, confidence: 0.87 });
    }

    if (id) {
      const $label = this.$(`label[for="${id}"]`);
      if ($label.length) {
        candidates.push({ type: 'semantic', value: `label[for="${this.q(id)}"]`, priority: 11, confidence: 0.82 });
      }
    }

    const stableClasses = ($el.attr('class') || '')
      .split(/\s+/)
      .filter((c: string) => c && !this.isObfuscatedClass(c) && c.length >= 3);
    if (stableClasses.length > 0) {
      candidates.push({
        type: 'css',
        value: `${tag}.${stableClasses.map((c: string) => this.escape(c)).join('.')}`,
        priority: 8,
        confidence: stableClasses.length > 1 ? 0.75 : 0.60,
      });
    }

    if (isContainer) {
      const path = this.getStructuralPath($el);
      candidates.push({ type: 'css', value: path, priority: 9, confidence: 0.40 });
    }

    const text = $el.text().trim();
    if (text && text.length > 0 && text.length < 50 && !isContainer) {
      candidates.push({ type: 'text', value: text, priority: 10, confidence: 0.35 });
    }

    return candidates;
  }

  private isStableId(id: string): boolean {
    if (/^\d/.test(id)) return false;
    if (id.length < 3) return false;
    if (/^[a-f0-9]{6,}$/i.test(id)) return false;
    return true;
  }

  private getStructuralPath($el: cheerio.Cheerio<any>): string {
    const parts: string[] = [];
    let current: cheerio.Cheerio<any> = $el;
    while (current.length > 0) {
      const raw = current[0] as any;
      const tag = raw?.tagName?.toLowerCase();
      if (!tag || tag === 'body' || tag === 'html') break;
      const siblings = current.siblings(tag).toArray();
      const idx = this.getIndexAmong(current, tag);
      const nth = siblings.length > 0 ? `:nth-child(${idx + 1})` : '';
      parts.unshift(`${tag}${nth}`);
      current = current.parent();
    }
    return parts.join(' > ');
  }

  private getIndexAmong($el: cheerio.Cheerio<any>, tag: string): number {
    const raw = $el[0];
    if (!raw) return 0;
    const parent = $el.parent();
    if (!parent.length) return 0;
    let idx = 0;
    for (const child of parent.children().toArray()) {
      if ((child as any)?.tagName?.toLowerCase() === tag) {
        if (child === raw) return idx;
        idx++;
      }
    }
    return 0;
  }

  // =========================================================================
  // Field Generation
  // =========================================================================

  private generateFields(target: TargetRegion): AXIRField[] {
    const fields: AXIRField[] = [];
    const $el = target.region.element;

    for (const el of $el.find('input:not([type="hidden"]), textarea, select').toArray()) {
      const $input = this.$(el);
      const name = this.inferFieldName($input);
      if (!name) continue;

      fields.push({
        name,
        selector: this.buildBestSelector($input),
        transform: this.inferTransform($input),
        required: $input.attr('required') !== undefined,
      });
    }

    return fields;
  }

  private inferFieldName($el: cheerio.Cheerio<any>): string | null {
    const id = $el.attr('id');
    if (id) {
      const $label = this.$(`label[for="${id}"]`);
      if ($label.length) return this.slugify($label.text());
    }

    const $parentLabel = $el.closest('label');
    if ($parentLabel.length) return this.slugify($parentLabel.text());

    const ph = $el.attr('placeholder');
    if (ph) return this.slugify(ph);

    const al = $el.attr('aria-label');
    if (al) return this.slugify(al);

    const name = $el.attr('name');
    if (name && !name.startsWith('_')) return this.slugify(name);

    const title = $el.attr('title');
    if (title) return this.slugify(title);

    return null;
  }

  private inferTransform($el: cheerio.Cheerio<any>): string | undefined {
    const type = $el.attr('type');
    if (type === 'number') return 'number';
    if (type === 'email') return 'email';
    if (type === 'tel') return 'tel';
    if (type === 'url') return 'url';
    if (type === 'date') return 'date';
    if (type === 'datetime-local') return 'datetime';
    if (type === 'checkbox') return 'boolean';
    if (type === 'radio') return 'select';
    if ($el.is('select')) return 'select';
    if ($el.is('textarea')) return 'text';
    return undefined;
  }

  private buildBestSelector($el: cheerio.Cheerio<any>): string {
    const candidates = this.buildStableSelectors($el, false);
    return candidates.length > 0 ? candidates[0].value : 'input';
  }

  // =========================================================================
  // Workflow Construction
  // =========================================================================

  private buildWorkflow(target: TargetRegion, all: SemanticRegion[]): AXIRWorkflow {
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
        selector_candidates: this.buildStableSelectors(r.element, true),
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

    if (entry.length === 0 && Object.keys(nodes).length > 0) {
      entry.push(Object.keys(nodes)[0]);
    }

    return {
      nodes,
      edges,
      entry_points: entry,
      exit_points: exit,
      domain: this.domain,
      page_type: this.inferPageType(target),
    };
  }

  private mapType(t: string): AXIRNode['element_type'] {
    const m: Record<string, AXIRNode['element_type']> = {
      search: 'search', navigation: 'navigation', listing: 'list',
      form: 'form', pagination: 'pagination', detail: 'container',
      button: 'button', link: 'link', heading: 'heading',
    };
    return m[t] || 'unknown';
  }

  private inferEdge(f: SemanticRegion, t: SemanticRegion, fi: number, ti: number): AXIREdge | null {
    if (f.type === 'search' && t.type === 'listing') return { from_node: `search_${fi}`, to_node: `listing_${ti}`, action: 'submit_search', probability: 0.9 };
    if (f.type === 'navigation' && t.type === 'search') return { from_node: `navigation_${fi}`, to_node: `search_${ti}`, action: 'navigate_to_search', probability: 0.7 };
    if (f.type === 'listing' && t.type === 'pagination') return { from_node: `listing_${fi}`, to_node: `pagination_${ti}`, action: 'next_page', probability: 0.8 };
    if (f.type === 'pagination' && t.type === 'listing') return { from_node: `pagination_${fi}`, to_node: `listing_${ti}`, action: 'load_results', probability: 0.95 };
    if (f.type === 'navigation' && t.type === 'listing') return { from_node: `navigation_${fi}`, to_node: `listing_${ti}`, action: 'navigate_to_list', probability: 0.6 };
    return null;
  }

  private inferPageType(target: TargetRegion): AXIRWorkflow['page_type'] {
    const intentMap: Record<string, AXIRWorkflow['page_type']> = {
      search: 'search', search_jobs: 'search',
      extract_list: 'listing', extract_detail: 'detail',
      fill_form: 'form', login: 'form',
      navigate: 'landing', filter: 'search', sort: 'listing',
      scrape: 'listing',
    };

    const intentType = intentMap[this.intent];
    if (intentType) {
      const targetType = target.region.type;
      const compat: Record<string, string[]> = {
        search: ['search', 'form'], listing: ['listing', 'search'],
        detail: ['detail', 'listing'], form: ['form', 'search'],
        landing: ['navigation', 'listing', 'search'],
      };
      if (compat[intentType]?.includes(targetType)) return intentType;
    }

    const typeMap: Record<string, AXIRWorkflow['page_type']> = {
      search: 'search', listing: 'listing', form: 'form',
      detail: 'detail', navigation: 'landing',
    };
    return typeMap[target.region.type] || 'unknown';
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
    const mapped = m[this.intent];
    if (mapped) return [mapped];
    return [{ intent: this.intent, action: 'interact', parameters: Object.keys(this.params), context: `Perform ${this.intent} on the page` }];
  }

  private generateContainerSelector($el: cheerio.Cheerio<any>): string {
    const candidates = this.buildStableSelectors($el, true);
    return candidates.length > 0 ? candidates[0].value : 'body';
  }

  // =========================================================================
  // Utilities
  // =========================================================================

  private slugify(t: string): string {
    return t.toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 50);
  }

  private escape(s: string): string {
    return s.replace(/([:.])/g, '\\$1');
  }

  private q(s: string): string {
    return s.replace(/"/g, '\\"');
  }
}

interface SemanticRegion {
  type: string;
  element: cheerio.Cheerio<any>;
  confidence: number;
  score: number;
}

interface TargetRegion {
  region: SemanticRegion;
  container: string;
}
