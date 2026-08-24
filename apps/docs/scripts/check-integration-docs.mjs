import {existsSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {load} from 'js-yaml';
import {collectIntegrationDocIssues} from '@/lib/integration-docs-completeness';
import {registeredIntegrationProviders} from '@/lib/registered-integration-providers';

const docsRoot = fileURLToPath(new URL('..', import.meta.url));
const integrationsRoot = path.join(docsRoot, 'content', 'docs', 'integrations');
const generatedCatalogPath = path.join(
  docsRoot,
  'content',
  'generated',
  'integrations',
  'catalog.json',
);
const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u;

const issues = collectIntegrationDocIssues({
  providers: registeredIntegrationProviders,
  generatedCatalog: JSON.parse(readFileSync(generatedCatalogPath, 'utf8')),
  integrationDirectories: readIntegrationDirectories(),
  builtInSourceDocs: readBuiltInSourceDocs(),
});

if (issues.length > 0) {
  process.stderr.write(
    `Integration documentation completeness check failed:\n${issues.join('\n')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write('Integration documentation matches the registered provider manifest.\n');
}

function readIntegrationDirectories() {
  return Object.fromEntries(
    readdirSync(integrationsRoot, {withFileTypes: true})
      .filter((entry) => entry.isDirectory())
      .map((entry) => [entry.name, readIntegrationDirectory(entry.name)]),
  );
}

function readIntegrationDirectory(slug) {
  const directory = path.join(integrationsRoot, slug);
  const pages = readdirSync(directory, {withFileTypes: true})
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mdx'))
    .map((entry) => entry.name.slice(0, -'.mdx'.length));
  const pageBodies = Object.fromEntries(
    pages.map((page) => [page, readFileSync(path.join(directory, `${page}.mdx`), 'utf8')]),
  );
  const overview = pageBodies.index ? parseOverview(pageBodies.index) : undefined;
  const metaPath = path.join(directory, 'meta.json');

  return {
    pages,
    metaPages: existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')).pages : undefined,
    pageBodies,
    overview,
  };
}

function parseOverview(content) {
  const match = frontmatterPattern.exec(content);
  if (!match) return {body: content};
  const frontmatter = load(match[1]);
  const data = typeof frontmatter === 'object' && frontmatter !== null ? frontmatter : {};
  return {catalog: data.catalog, body: match[2]};
}

function readIfExists(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

function readBuiltInSourceDocs() {
  return Object.fromEntries(
    registeredIntegrationProviders
      .filter((provider) => provider.kind === 'built-in-source')
      .map((provider) => [
        provider.slug,
        readIfExists(path.join(docsRoot, 'content', 'docs', `${provider.docRoute.slice(1)}.mdx`)),
      ])
      .filter((entry) => entry[1] !== undefined),
  );
}
