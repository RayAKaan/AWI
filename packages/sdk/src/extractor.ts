import type { DiscoverResponse } from '@awi-protocol/types';

export class DOMExtractor {
  async discover(url: string, _goal?: string): Promise<DiscoverResponse> {
    const bxl = await this.extract(url, _goal);
    return bxl;
  }

  getExtractionScript(): string {
    return `
      (() => {
        function inferType(el) {
          if (el.tagName === 'FORM') return 'form';
          if (el.tagName === 'SELECT') return 'dropdown';
          if (el.tagName === 'INPUT') {
            const type = el.type;
            if (type === 'checkbox' || type === 'radio') return 'checkbox';
            if (type === 'file') return 'upload';
            return 'input';
          }
          if (el.tagName === 'TEXTAREA') return 'input';
          if (el.tagName === 'BUTTON') return 'button';
          if (el.tagName === 'A') return 'link';
          if (el.querySelector('input[type="search"], input[placeholder*="search" i]')) return 'search';
          return 'unknown';
        }

        function getPurpose(el) {
          const text = (el.innerText || el.textContent || el.placeholder || el.title || el.ariaLabel || '').trim();
          if (text.length > 100) return text.slice(0, 100) + '...';
          return text;
        }

        function getSelector(el) {
          if (el.id) return '#' + el.id;
          if (el.className) {
            const classes = el.className.split(/\\s+/).filter(c => c.length > 3).slice(0, 2);
            if (classes.length) return '.' + classes.join('.');
          }
          return el.tagName.toLowerCase() + (el.type ? '[type="' + el.type + '"]' : '');
        }

        function detectRisks() {
          const risks = [];
          if (document.querySelector('input[type="password"], .login, .signin, #login')) {
            risks.push({ risk_type: 'auth_required', severity: 'medium', description: 'Login wall detected' });
          }
          if (document.querySelector('.captcha, #captcha, [class*="captcha" i]')) {
            risks.push({ risk_type: 'captcha', severity: 'high', description: 'CAPTCHA challenge present' });
          }
          if (document.querySelector('.paywall, [class*="paywall" i], [class*="subscription" i]')) {
            risks.push({ risk_type: 'paywall', severity: 'medium', description: 'Content may be behind paywall' });
          }
          const scripts = Array.from(document.querySelectorAll('script[src]'));
          if (scripts.some(s => s.src.includes('recaptcha') || s.src.includes('hcaptcha'))) {
            risks.push({ risk_type: 'anti_bot', severity: 'high', description: 'Bot detection scripts loaded' });
          }
          return risks;
        }

        const interactive = Array.from(document.querySelectorAll(
          'a, button, input, select, textarea, form, [role="button"], [role="link"], [role="searchbox"]'
        )).map((el, i) => ({
          element_id: 'el_' + i,
          what_it_is: el.tagName.toLowerCase() + (el.type ? ':' + el.type : ''),
          element_type: inferType(el),
          purpose: getPurpose(el),
          how_to_target: getSelector(el),
          selector_hint: el.id ? '#' + el.id : getSelector(el),
          confidence: el.id ? 0.95 : 0.6,
          required_params: el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'search') ? ['value'] : [],
        }));

        const extractable = Array.from(document.querySelectorAll('h1, h2, h3, p, td, li, [class*="title" i], [class*="name" i]')).map((el, i) => ({
          field_name: 'field_' + i,
          description: getPurpose(el),
          example_value: el.innerText?.trim()?.slice(0, 50),
          where_to_find: getSelector(el),
          data_type: 'text',
          cardinality: 'single',
        }));

        const siteName = document.querySelector('meta[property="og:site_name"]')?.content
          || document.querySelector('meta[name="application-name"]')?.content
          || location.hostname;

        return {
          target: location.href,
          site: {
            domain: location.hostname,
            site_name: siteName,
            category: 'unknown',
            has_recipe: false,
            page_types_detected: ['landing'],
          },
          summary: document.title || location.hostname,
          what_you_can_do: interactive.slice(0, 5).map(el => el.purpose).filter(Boolean),
          interactive_elements: interactive.slice(0, 20),
          extractable_data: extractable.slice(0, 10),
          risks: detectRisks(),
          metadata: {
            url: location.href,
            title: document.title,
            timestamp: new Date().toISOString(),
          },
        };
      })()
    `;
  }

  async extract(_url: string, _goal?: string): Promise<DiscoverResponse> {
    throw new Error('Use LocalExecutor or SDK.discover() to run extraction in a real browser');
  }
}
