import 'server-only';

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {CatalogCapability, CatalogProvider} from '@/lib/integration-catalog';
import {validateIntegrationCatalog} from '@/lib/integration-catalog-validation';
import {source} from '@/lib/source';

export {validateIntegrationCatalog} from '@/lib/integration-catalog-validation';

interface GeneratedCatalogData {
  capabilities: CatalogCapability[];
  eventCount: number;
  toolCount: number;
}

export function getIntegrationCatalog(): CatalogProvider[] {
  const generatedCatalogData = getGeneratedCatalogData();
  const providers: CatalogProvider[] = source
    .getPages()
    .filter((page) => page.slugs[0] === 'integrations' && page.slugs.length === 2)
    .map((page): CatalogProvider => {
      const catalog = page.data.catalog;
      const slug = page.slugs[1];
      if (!catalog)
        throw new Error(`Integration catalog metadata is missing for provider "${slug}".`);

      const generatedData = generatedCatalogData[slug];
      const setupPage = source.getPage([...page.slugs, 'setup']);

      return {
        slug,
        name: catalog.name,
        summary: catalog.summary,
        capabilities: catalog.capabilities,
        categories: catalog.categories,
        aliases: catalog.aliases,
        icon: catalog.icon,
        overviewHref: page.url,
        setupHref: setupPage?.url,
        eventCount: generatedData?.eventCount ?? 0,
        toolCount: generatedData?.toolCount ?? 0,
      };
    });

  validateIntegrationCatalog(
    providers,
    Object.fromEntries(
      Object.entries(generatedCatalogData).map(([slug, data]) => [slug, data.capabilities]),
    ),
  );

  return providers.toSorted((left, right) => left.name.localeCompare(right.name));
}

function getGeneratedCatalogData(): Record<string, GeneratedCatalogData> {
  const path = join(process.cwd(), 'content/generated/integrations/catalog.json');
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, GeneratedCatalogData>;
}
