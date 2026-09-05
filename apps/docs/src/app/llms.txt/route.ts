import {canonicalDocsUrl} from '@/lib/machine-readable';
import {PRODUCT_DEFINITION} from '@/lib/product-definition';
import {source} from '@/lib/source';

export const revalidate = false;

const SECTION_ORDER = [
  'get-started',
  'tutorials',
  'understand',
  'how-to',
  'integrations',
  'ai',
  'reference',
  'operations',
  'installation',
] as const;

const SECTION_LABELS: Record<(typeof SECTION_ORDER)[number], string> = {
  'get-started': 'Get Started',
  tutorials: 'Tutorials',
  understand: 'Understand',
  'how-to': 'How-to Guides',
  integrations: 'Integrations',
  ai: 'AI Assistance',
  reference: 'Reference',
  operations: 'Operations',
  installation: 'Installation',
};

// Root-level pages have no folder segment, so map them explicitly; everything
// else buckets by its first path segment. Keep this exhaustive so no page is
// dropped from llms.txt.
function sectionOf(url: string): (typeof SECTION_ORDER)[number] {
  if (url === '/' || url === '/getting-started') return 'get-started';
  const segment = url.split('/').filter(Boolean)[0];
  return (SECTION_ORDER as readonly string[]).includes(segment ?? '')
    ? (segment as (typeof SECTION_ORDER)[number])
    : 'get-started';
}

interface TreePage {
  type: 'page';
  url: string;
}
interface TreeFolder {
  type: 'folder';
  index?: TreePage;
  children: TreeNode[];
}
type TreeNode = TreePage | TreeFolder | {type: 'separator'};

// Flatten the sidebar tree (which honours each folder's meta.json order) into an
// ordered list of URLs, so llms.txt reads in the same order as the docs nav
// rather than alphabetically.
function collectNavOrder(nodes: TreeNode[], acc: string[]): string[] {
  for (const node of nodes) {
    if (node.type === 'page') acc.push(node.url);
    else if (node.type === 'folder') {
      if (node.index) acc.push(node.index.url);
      collectNavOrder(node.children, acc);
    }
  }
  return acc;
}

export function GET() {
  const pages = source.getPages();

  const navOrder = collectNavOrder(source.pageTree.children as unknown as TreeNode[], []);
  const orderIndex = new Map(navOrder.map((url, index) => [url, index]));

  const sections = new Map<string, typeof pages>();
  for (const section of SECTION_ORDER) {
    sections.set(section, []);
  }

  for (const page of pages) {
    sections.get(sectionOf(page.url))?.push(page);
  }

  for (const [, sectionPages] of sections) {
    sectionPages.sort(
      (a, b) => (orderIndex.get(a.url) ?? Infinity) - (orderIndex.get(b.url) ?? Infinity),
    );
  }

  const lines: string[] = [
    '# Shipfox Documentation',
    '',
    `> ${PRODUCT_DEFINITION} Define YAML workflows in your repository, run shell and AI agent steps on your own runners, and trigger workflows from GitHub, Sentry, and more.`,
    '',
  ];

  for (const sectionKey of SECTION_ORDER) {
    const sectionPages = sections.get(sectionKey);
    if (!sectionPages?.length) continue;

    lines.push(`## ${SECTION_LABELS[sectionKey]}`, '');

    for (const page of sectionPages) {
      const description = page.data.description;
      if (typeof description !== 'string' || description.length === 0) {
        throw new Error(
          `Documentation page "${page.path}" (${page.url}) is missing a description.`,
        );
      }
      lines.push(`- [${page.data.title}](${canonicalDocsUrl(page.url)}): ${description}`);
    }

    lines.push('');
  }

  return new Response(lines.join('\n'), {
    headers: {'Content-Type': 'text/plain; charset=utf-8'},
  });
}
