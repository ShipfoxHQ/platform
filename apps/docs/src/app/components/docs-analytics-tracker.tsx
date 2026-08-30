'use client';

import {useEffect} from 'react';
import {captureDocsEvent} from '@/lib/docs-analytics';
import {destinationFromHref} from '@/lib/docs-analytics-core';

const EDIT_ON_GITHUB_BASE =
  'https://github.com/ShipfoxHQ/shipfox/edit/main/apps/docs/content/docs/';
const CODE_BLOCK_SELECTOR = 'figure[data-docs-code-block]';

function captureCodeCopy(target: Element): boolean {
  const copyButton = target.closest(
    `${CODE_BLOCK_SELECTOR} button[aria-label="Copy Text"], ${CODE_BLOCK_SELECTOR} button[aria-label="Copied Text"]`,
  );
  if (!copyButton) return false;

  const codeBlock = copyButton.closest(CODE_BLOCK_SELECTOR);
  if (!codeBlock) return true;
  const blocks = Array.from(document.querySelectorAll(CODE_BLOCK_SELECTOR));
  const code = codeBlock.querySelector('code');
  const languageClass = code
    ? Array.from(code.classList).find((name) => name.startsWith('language-'))
    : undefined;
  captureDocsEvent('docs_code_copy_clicked', {
    language: languageClass?.slice('language-'.length) || 'unknown',
    block_index: blocks.indexOf(codeBlock),
  });
  return true;
}

function captureOutboundLink(target: Element): void {
  const anchor = target.closest<HTMLAnchorElement>('a[href]');
  if (!anchor || anchor.dataset.docsAnalyticsCta !== undefined) return;
  if (anchor.href.startsWith(EDIT_ON_GITHUB_BASE)) return;

  const destination = destinationFromHref(anchor.href, window.location.href);
  if (!destination || destination.origin === window.location.origin) return;
  captureDocsEvent('docs_outbound_link_clicked', {
    destination_origin: destination.origin,
    destination_path: destination.pathname,
  });
}

export function DocsAnalyticsTracker() {
  useEffect(() => {
    function captureClick(event: MouseEvent) {
      if (!(event.target instanceof Element)) return;
      if (captureCodeCopy(event.target)) return;
      captureOutboundLink(event.target);
    }

    document.addEventListener('click', captureClick);
    return () => document.removeEventListener('click', captureClick);
  }, []);

  return null;
}
