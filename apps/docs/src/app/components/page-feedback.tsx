'use client';

import {useState} from 'react';
import {captureDocsEvent} from '@/lib/docs-analytics';

const GITHUB_EDIT_BASE = 'https://github.com/ShipfoxHQ/shipfox/edit/main/apps/docs/content/docs/';

export function PageFeedback({pageUrl, filePath}: {pageUrl: string; filePath: string}) {
  const [voted, setVoted] = useState(false);

  const vote = (helpful: boolean) => {
    setVoted(true);
    captureDocsEvent('docs_page_feedback', {page: pageUrl, helpful});
  };

  return (
    <div className="mt-page flex flex-wrap items-center justify-between gap-group border-t p-tight text-sm text-fd-muted-foreground">
      {voted ? (
        <span>Thanks for the feedback!</span>
      ) : (
        <div className="flex items-center gap-cluster">
          <span>Was this page helpful?</span>
          <button
            type="button"
            onClick={() => vote(true)}
            className="rounded-md border p-tight transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => vote(false)}
            className="rounded-md border p-tight transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
          >
            No
          </button>
        </div>
      )}
      <a
        href={`${GITHUB_EDIT_BASE}${filePath}`}
        target="_blank"
        rel="noreferrer"
        data-docs-edit-link=""
        onClick={() =>
          captureDocsEvent('docs_edit_on_github_clicked', {page: pageUrl, file_path: filePath})
        }
        className="underline underline-offset-4 transition-colors hover:text-fd-foreground"
      >
        Edit this page on GitHub
      </a>
    </div>
  );
}
