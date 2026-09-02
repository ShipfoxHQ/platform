import {createRelativeLink} from 'fumadocs-ui/mdx';
import {DocsBody, DocsDescription, DocsPage, DocsTitle} from 'fumadocs-ui/page';
import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {PageFeedback} from '@/app/components/page-feedback';
import {source} from '@/lib/source';
import {getMDXComponents} from '@/mdx-components';
import {toMarkdownUrl, toUrl, url} from '@/url';

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

  const title = `${page.data.title} | Shipfox`;
  const canonicalUrl = toUrl(page.url);
  // toUrl carries the /docs basePath, which Next does not apply to manually
  // built metadata URLs.
  const image = toUrl('/shipfox-og.jpg');
  return {
    title,
    description: page.data.description,
    metadataBase: new URL(url),
    alternates: {
      canonical: canonicalUrl,
      types: {'text/markdown': toMarkdownUrl(page.url)},
    },
    openGraph: {
      title,
      description: page.data.description,
      url: canonicalUrl,
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: 'Shipfox: Your AI software factory',
        },
      ],
      siteName: 'Shipfox',
      type: 'website',
      locale: 'en_US',
    },
    twitter: {
      card: 'summary_large_image',
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: 'Shipfox: Your AI software factory',
        },
      ],
    },
  };
}
