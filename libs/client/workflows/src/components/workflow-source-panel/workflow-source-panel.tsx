import {Button} from '@shipfox/react-ui/button';
import type {CodeBlockHighlightedLineRange} from '@shipfox/react-ui/code-block';
import {Sheet, SheetClose, SheetContent, SheetTitle} from '@shipfox/react-ui/sheet';
import {cn} from '@shipfox/react-ui/utils';
import type {WorkflowSourceSnapshot} from '#core/workflow-run.js';
import {WorkflowSourceContent} from './workflow-source-content.js';

export interface WorkflowSourcePanelProps {
  id: string;
  source: WorkflowSourceSnapshot | null;
  open: boolean;
  onClose: () => void;
  highlightedLineRange?: CodeBlockHighlightedLineRange | null | undefined;
  scrollHighlightedIntoView?: boolean | undefined;
  className?: string | undefined;
}

export function WorkflowSourcePanel({
  id,
  source,
  open,
  onClose,
  highlightedLineRange,
  scrollHighlightedIntoView,
  className,
}: WorkflowSourcePanelProps) {
  const sheetOpen = open && source !== null;

  if (!sheetOpen) return null;

  return (
    <Sheet
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      {source ? (
        <SheetContent
          id={id}
          side="right"
          aria-describedby={undefined}
          className={cn(
            'w-screen max-w-none border-l-0 bg-background-contrast-base p-0 shadow-none sm:w-[min(85vw,1120px)] sm:max-w-none [&_.shadow-separator-inset]:shadow-none',
            className,
          )}
        >
          <SheetTitle className="sr-only">Workflow source</SheetTitle>
          <WorkflowSourceContent
            source={source}
            highlightedLineRange={highlightedLineRange}
            scrollHighlightedIntoView={scrollHighlightedIntoView}
            headerAction={
              <SheetClose asChild>
                <Button
                  type="button"
                  variant="transparentMuted"
                  size="sm"
                  iconLeft="close"
                  aria-label="Close source"
                />
              </SheetClose>
            }
          />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}
