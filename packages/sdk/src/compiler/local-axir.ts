import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

import type {
  AXIRCompilationResult,
  AXIRHealingResult,
} from './types';

// ---------------------------------------------------------------------------
// ESM-compatible lazy loading of node-llama-cpp
// node-llama-cpp v3+ is ESM-only with top-level await.
// We use dynamic import() instead of require() to avoid
// ERR_REQUIRE_ASYNC_MODULE in both CJS and ESM builds.
// ---------------------------------------------------------------------------
let nativeAvailable = false;
let getLlama: any;
let LlamaModel: any;
let LlamaContext: any;
let LlamaGrammar: any;

const llamaPromise = import('node-llama-cpp').then((m) => {
  nativeAvailable = true;
  getLlama = m.getLlama;
  LlamaModel = m.LlamaModel;
  LlamaContext = m.LlamaContext;
  LlamaGrammar = m.LlamaGrammar;
  return m;
}).catch((err) => {
  nativeAvailable = false;
  if (process.env.AWI_DEBUG) {
    console.error('[AWI] node-llama-cpp load error:', err.message);
  }
  return null;
});

// ---------------------------------------------------------------------------
// Default model -- Phi-3-mini-128k-instruct Q4_K_M (~2.7 GB)
// Hosted on GitHub Releases (no auth required, permanent URL)
// ---------------------------------------------------------------------------
const DEFAULT_MODEL_URL =
  'https://github.com/RayAKaan/AWI/releases/download/v0.0.0-models/Phi-3-mini-128k-instruct-Q4_K_M.gguf';

const DEFAULT_MODEL_FILENAME = 'phi3-128k-q4.gguf';

export interface LocalAXIRCompilerOptions {
  modelPath?: string;
  modelUrl?: string;
  contextSize?: number;
  gpuLayers?: number;
  onDownloadProgress?: (downloaded: number, total: number) => void;
  onStatus?: (message: string) => void;
}

export class LocalAXIRCompiler {
  private modelPath: string;
  private modelUrl: string;
  private contextSize: number;
  private gpuLayers: number | undefined;
  private onDownloadProgress?: (downloaded: number, total: number) => void;
  private onStatus?: (message: string) => void;

  private model: any = null;
  private context: any = null;
  private grammar: any = null;
  private ready = false;

  constructor(options: LocalAXIRCompilerOptions = {}) {
    if (!nativeAvailable) {
      throw new Error(
        'Local AXIR compilation requires node-llama-cpp.\n' +
        'Install it:  npm install node-llama-cpp\n' +
        'Note: this package contains native C++ bindings and needs build tools.\n' +
        '  * macOS: Xcode Command Line Tools (xcode-select --install)\n' +
        '  * Linux: build-essential / gcc-c++ / python3\n' +
        '  * Windows: Visual Studio Build Tools or windows-build-tools npm package\n' +
        'Docs: https://github.com/withcatai/node-llama-cpp#installation'
      );
    }

    const cacheDir = path.join(os.homedir(), '.awi', 'models');
    this.modelPath =
      options.modelPath || path.join(cacheDir, DEFAULT_MODEL_FILENAME);
    this.modelUrl = options.modelUrl || DEFAULT_MODEL_URL;
    this.contextSize = options.contextSize || 32768;
    this.gpuLayers = options.gpuLayers;
    this.onDownloadProgress = options.onDownloadProgress;
    this.onStatus = options.onStatus;
  }

  async compile(
    domHTML: string,
    a11yTree: string | undefined,
    intent: string,
    params?: Record<string, unknown>
  ): Promise<AXIRCompilationResult> {
    await this._ensureModel();
    await this._ensureGrammar();

    const prompt = this._buildCompilePrompt(domHTML, a11yTree, intent, params);
    const start = Date.now();

    this._status('Compiling AXIR locally...');
    const resultText = await this._complete(prompt, 4096, 0.3);
    const parsed = JSON.parse(resultText) as AXIRCompilationResult;

    parsed.model_used = 'phi-3-mini-128k-q4-local';
    parsed.tokens_used = this._estimateTokens(prompt, resultText);
    parsed.compilation_time_ms = Date.now() - start;

    this._status(`AXIR compiled in ${parsed.compilation_time_ms}ms`);
    return parsed;
  }

  async heal(
    domHTML: string,
    brokenSelector: string,
    semanticIntent: string
  ): Promise<AXIRHealingResult> {
    await this._ensureModel();

    const prompt = this._buildHealPrompt(domHTML, brokenSelector, semanticIntent);
    const start = Date.now();

    this._status('Healing selector locally...');
    const resultText = await this._complete(prompt, 256, 0.1);

    let selector: string;
    let confidence = 0.85;
    let reasoning: string | undefined;

    try {
      const parsed = JSON.parse(resultText);
      selector = parsed.selector ?? parsed;
      confidence = parsed.confidence ?? 0.85;
      reasoning = parsed.reasoning;
    } catch {
      selector = resultText.trim().replace(/^["']|["']$/g, '');
    }

    this._status(`Selector healed in ${Date.now() - start}ms`);
    return { selector, confidence, reasoning };
  }

  isModelCached(): boolean {
    return fs.existsSync(this.modelPath);
  }

  clearCache(): void {
    if (fs.existsSync(this.modelPath)) {
      fs.unlinkSync(this.modelPath);
      this.model = null;
      this.context = null;
      this.grammar = null;
      this.ready = false;
    }
  }

  private async _ensureModel(): Promise<void> {
    if (this.ready) return;

    await llamaPromise;

    if (!getLlama) {
      throw new Error('node-llama-cpp failed to load. Is it installed?');
    }

    if (!fs.existsSync(this.modelPath)) {
      await this._downloadModel();
    }

    this._status('Loading local model...');
    const llama = await getLlama();

    const gpuLayers = this.gpuLayers ?? this._autoDetectGPULayers();
    this.model = new LlamaModel({
      llama,
      modelPath: this.modelPath,
      gpuLayers,
    });

    this.context = new LlamaContext({
      llama,
      model: this.model,
      contextSize: this.contextSize,
    });

    this.ready = true;
    this._status('Local model ready.');
  }

  private async _ensureGrammar(): Promise<void> {
    if (this.grammar) return;
    const grammarPath = path.join(__dirname, 'grammar', 'axir-schema.gbnf');
    this.grammar = new LlamaGrammar({
      llama: await getLlama(),
      grammar: fs.readFileSync(grammarPath, 'utf-8'),
    });
  }

  private _autoDetectGPULayers(): number {
    if (process.env.AWI_GPU_LAYERS) {
      return parseInt(process.env.AWI_GPU_LAYERS, 10);
    }
    return 0;
  }

  private async _downloadModel(): Promise<void> {
    const dir = path.dirname(this.modelPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tempPath = `${this.modelPath}.tmp`;
    const url = new URL(this.modelUrl);
    const protocol = url.protocol === 'https:' ? https : http;

    let startByte = 0;
    if (fs.existsSync(tempPath)) {
      startByte = fs.statSync(tempPath).size;
      this._status(`Resuming download from ${startByte} bytes...`);
    } else {
      this._status('Downloading local compiler model (2.7GB, one-time)...');
    }

    return new Promise((resolve, reject) => {
      const headers: http.OutgoingHttpHeaders = {
        'User-Agent': 'AWI-SDK/1.0',
      };
      if (startByte > 0) {
        headers['Range'] = `bytes=${startByte}-`;
      }

      const request = protocol.get(
        url,
        { headers },
        (response) => {
          if (response.statusCode === 302 || response.statusCode === 301) {
            if (response.headers.location) {
              this.modelUrl = response.headers.location;
              return this._downloadModel().then(resolve).catch(reject);
            }
          }

          if (response.statusCode !== 200 && response.statusCode !== 206) {
            return reject(
              new Error(`Download failed: HTTP ${response.statusCode}`)
            );
          }

          const total = parseInt(
            response.headers['content-length'] || '0',
            10
          );
          const append = startByte > 0 && response.statusCode === 206;
          const file = fs.createWriteStream(tempPath, { flags: append ? 'a' : 'w' });
          let downloaded = startByte;

          response.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
            this.onDownloadProgress?.(downloaded, total + startByte);
          });

          response.pipe(file);
          file.on('finish', () => {
            file.close();
            fs.renameSync(tempPath, this.modelPath);
            this._status('Model download complete.');
            resolve();
          });

          file.on('error', (err) => {
            fs.unlinkSync(tempPath);
            reject(err);
          });
        }
      );

      request.on('error', reject);
      request.setTimeout(300_000, () => {
        request.destroy();
        reject(new Error('Model download timed out after 5 minutes'));
      });
    });
  }

  private async _complete(
    prompt: string,
    maxTokens: number,
    temperature: number
  ): Promise<string> {
    if (!this.context) throw new Error('Model not loaded');

    const sequence = this.context.getSequence();
    await sequence.evaluate(prompt);

    const result = await sequence.generateResponse(maxTokens, {
      temperature,
      grammar: this.grammar,
    });

    let text = '';
    for await (const token of result) {
      text += token;
    }
    return text;
  }

  private _buildCompilePrompt(
    domHTML: string,
    a11yTree: string | undefined,
    intent: string,
    params?: Record<string, unknown>
  ): string {
    const paramsJson = params ? JSON.stringify(params, null, 2) : '{}';
    const a11y = a11yTree || 'No accessibility tree available.';

    return `|<|system|>\n` +
`You are an expert web-scraping analyst. Your job is to read a simplified DOM and accessibility tree, then output a structured JSON object describing the page layout, interactive elements, and data extraction plan.\n` +
`\n` +
`Output MUST be valid JSON matching this schema:\n` +
`- workflow.nodes: map of node_id -> {element_type, semantic_role, intent, tag, selector_candidates[], parent_id?, children_ids?, aria_label?, aria_role?, text_content?, confidence, reasoning?}\n` +
`- workflow.edges: list of {from_node, to_node, action, condition?, probability}\n` +
`- workflow.entry_points: list of starting node_ids\n` +
`- workflow.exit_points: list of terminal node_ids\n` +
`- workflow.domain: the domain name\n` +
`- workflow.page_type: one of landing|search|listing|detail|form|checkout|dashboard|unknown\n` +
`- intents: list of {intent, action, parameters[], context}\n` +
`- selectors: map of selector_name -> list of {type, value, priority}\n` +
`- fields: list of {name, selector, transform?, required}\n` +
`- container?: string (optional container selector name)\n` +
`\n` +
`Element types: button, link, input, form, navigation, search, filter, sort, pagination, container, list, item, heading, text, image, unknown.\n` +
`Selector types: css, semantic, text, attribute.\n` +
`|<|user|>\n` +
`Intent: ${intent}\n` +
`Parameters: ${paramsJson}\n` +
`\n` +
`Simplified DOM:\n` +
`${this._truncate(domHTML, 40_000)}\n` +
`\n` +
`Accessibility Tree:\n` +
`${this._truncate(a11y, 8_000)}\n` +
`\n` +
`Compile AXIR:\n` +
`|<|assistant|>\n`;
  }

  private _buildHealPrompt(
    domHTML: string,
    brokenSelector: string,
    semanticIntent: string
  ): string {
    return `|<|system|>\n` +
`You are a CSS selector repair tool. Given a broken selector and the current DOM, output the new CSS selector that targets the same semantic element.\n` +
`\n` +
`Output JSON: {\"selector\": \"...\", \"confidence\": 0.0-1.0, \"reasoning\": \"...\"}\n` +
`|<|user|>\n` +
`Broken selector: ${brokenSelector}\n` +
`Semantic intent: ${semanticIntent}\n` +
`\n` +
`Current DOM (truncated):\n` +
`${this._truncate(domHTML, 20_000)}\n` +
`\n` +
`New selector:\n` +
`|<|assistant|>\n`;
  }

  private _truncate(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + '\n[...truncated...]';
  }

  private _estimateTokens(prompt: string, response: string): number {
    return Math.ceil((prompt.length + response.length) / 4);
  }

  private _status(message: string): void {
    this.onStatus?.(message);
  }
}
