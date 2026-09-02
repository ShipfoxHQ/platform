import type {Metadata} from 'next';
import {basePath, toMarkdownUrl, toUrl, url} from '@/url';

type DocsPage = {
  url: string;
  data: {
    title: string;
    description?: string;
  };
};

export function buildPageMetadata(
  page: DocsPage,
  origin: string = url,
  prefix: string = basePath,
): Metadata {
  const title = `${page.data.title} | Shipfox`;
  const canonicalUrl = toUrl(page.url, origin, prefix);
  // toUrl carries the /docs basePath, which Next does not apply to manually
  // built metadata URLs.
  const image = toUrl('/shipfox-og.jpg', origin, prefix);
  return {
    title,
    description: page.data.description,
    metadataBase: new URL(origin),
    alternates: {
      canonical: canonicalUrl,
      types: {'text/markdown': toMarkdownUrl(page.url, origin, prefix)},
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
