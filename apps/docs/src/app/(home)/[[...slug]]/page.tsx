import {createRelativeLink} from 'fumadocs-ui/mdx';
import {DocsBody, DocsDescription, DocsPage, DocsTitle} from 'fumadocs-ui/page';
import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {PageFeedback} from '@/app/components/page-feedback';
import {buildPageMetadata} from '@/lib/page-metadata';
import {source} from '@/lib/source';
import {getMDXComponents} from '@/mdx-components';

export default async function Page(props: {params: Promise<{slug?: string[]}>}) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDXContent = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDXContent
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
        <PageFeedback pageUrl={page.url} filePath={page.path} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{slug?: string[]}>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return buildPageMetadata(page);
}
