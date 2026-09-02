import {readFile} from 'node:fs/promises';
import {dirname, relative, resolve, sep} from 'node:path';
import {GENERATED_MANIFEST_FILE, type GeneratedArtifactManifest} from './generated-artifacts';

interface ImportedComponent {
  localName: string;
  source: string;
}

interface WorkflowMarkdownMap {
  [componentName: string]: string;
}

interface MdxEsmNode {
  type: 'mdxjsEsm';
  value: string;
  children?: unknown[];
}

interface MdxElementNode {
  type: 'mdxJsxFlowElement' | 'mdxJsxTextElement';
  name: string | null;
  children: unknown[];
  data?: Record<string, unknown>;
}

interface RootNode {
  children: unknown[];
}

interface VFileLike {
  dirname?: string | null;
  path?: string;
}

const IMPORT_PATTERN = /^\s*import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\2\s*;?\s*$/gm;
const IMPORT_ALIAS_PATTERN = /\s+as\s+/;
const LOCAL_NAME_PATTERN = /^[A-Za-z_$][\w$]*$/;
const GENERATED_MDX_COMPONENT_PATTERN = /<\/?[A-Z][A-Za-z0-9]*(?:\s[^<>]*)?\/?>(?:\s|$)/m;
let generatedManifestPromise: Promise<GeneratedArtifactManifest> | undefined;

export function remarkGeneratedComponents() {
  return async (tree: RootNode, file: VFileLike) => {
    const imports = new Map<string, string>();
    walk(tree, (node) => {
      if (node.type !== 'mdxjsEsm') return;
      for (const binding of generatedImports(node)) {
        const target = resolveGeneratedImport(file, binding.source);
        if (target) imports.set(binding.localName, target);
      }
    });

    if (imports.size === 0) return;

    const serialized = new Map<string, string>();
    await Promise.all(
      [...imports.entries()].map(async ([localName, target]) => {
        serialized.set(localName, await readGeneratedComponent(target, localName));
      }),
    );

    walk(tree, (node) => {
      if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') return;
      const element = node;
      if (!element.name) return;
      const text = serialized.get(element.name);
      if (!text) return;
      element.data ??= {};
      element.data._stringify = {text};
    });
  };
}

function generatedImports(node: MdxEsmNode): ImportedComponent[] {
  const imports: ImportedComponent[] = [];
  for (const match of node.value.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1]?.trim();
    const source = match[3];
    if (!specifier || !source) continue;

    imports.push(...bindingsForSpecifier(specifier, source));
  }
  return imports;
}

function bindingsForSpecifier(specifier: string, source: string): ImportedComponent[] {
  if (specifier.startsWith('{') && specifier.endsWith('}')) {
    return specifier
      .slice(1, -1)
      .split(',')
      .flatMap((item) => namedBinding(item, source));
  }

  const localName = specifier.split(',')[0]?.trim();
  return localName && LOCAL_NAME_PATTERN.test(localName) ? [{localName, source}] : [];
}

function namedBinding(item: string, source: string): ImportedComponent[] {
  const parts = item.trim().split(IMPORT_ALIAS_PATTERN);
  const imported = parts[0]?.trim();
  const localName = parts[1]?.trim() || imported;
  return imported && localName ? [{localName, source}] : [];
}

function resolveGeneratedImport(file: VFileLike, source: string): string | undefined {
  if (!source.startsWith('.') || !source.endsWith('.mdx')) return undefined;
  const base = file.dirname ?? (file.path ? dirname(file.path) : undefined);
  if (!base) return undefined;
  const target = resolve(base, source);
  const normalized = target.split(sep).join('/');
  return normalized.includes('/content/generated/') ? target : undefined;
}

async function readGeneratedComponent(target: string, localName: string): Promise<string> {
  const {docsRoot, generatedRoot} = generatedPathsFor(target);
  const source = relative(docsRoot, target).split(sep).join('/');
  const artifact = (
    await readGeneratedManifest(resolve(generatedRoot, 'generated-artifacts.json'))
  )[source];
  if (!artifact) {
    throw new Error(
      `Generated component "${localName}" from ${source} is not declared in ${GENERATED_MANIFEST_FILE}.`,
    );
  }

  if (artifact.format === 'json') {
    if (!artifact.file) {
      throw new Error(`Generated component "${localName}" from ${source} has no JSON artifact.`);
    }
    const map = JSON.parse(
      await readFile(resolve(docsRoot, artifact.file), 'utf8'),
    ) as WorkflowMarkdownMap;
    const text = map[localName];
    if (typeof text !== 'string') {
      throw new Error(
        `Generated workflow schema component "${localName}" has no machine-readable serialization.`,
      );
    }
    return text.trim();
  }

  const text = (await readFile(target, 'utf8')).trim();
  if (GENERATED_MDX_COMPONENT_PATTERN.test(text)) {
    throw new Error(
      `Generated component "${localName}" from ${source} contains MDX but has no machine-readable artifact.`,
    );
  }
  return text;
}

function readGeneratedManifest(path: string): Promise<GeneratedArtifactManifest> {
  generatedManifestPromise ??= readFile(path, 'utf8').then(
    (content) => JSON.parse(content) as GeneratedArtifactManifest,
  );
  return generatedManifestPromise;
}

function generatedPathsFor(target: string): {docsRoot: string; generatedRoot: string} {
  const marker = `${sep}content${sep}generated${sep}`;
  const markerIndex = target.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`Generated component path is outside the docs generated directory: ${target}`);
  }

  const docsRoot = target.slice(0, markerIndex);
  return {docsRoot, generatedRoot: resolve(docsRoot, 'content/generated')};
}

function walk(value: unknown, callback: (node: MdxEsmNode | MdxElementNode) => void): void {
  if (!isRecord(value)) return;
  if (isNode(value)) callback(value);
  if (!Array.isArray(value.children)) return;
  for (const child of value.children) walk(child, callback);
}

function isNode(value: unknown): value is MdxEsmNode | MdxElementNode {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'mdxjsEsm') return typeof value.value === 'string';
  return (
    (value.type === 'mdxJsxFlowElement' || value.type === 'mdxJsxTextElement') &&
    (typeof value.name === 'string' || value.name === null) &&
    Array.isArray(value.children)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
