import {SetupChecklistCompletion} from './setup-checklist-completion.js';
import {ChecklistRow} from './setup-checklist-row.js';
import type {SetupChecklistBodyProps} from './setup-checklist-types.js';

export function SetupChecklistBody({
  checklist,
  workspaceSlug,
  completion = false,
  showBurst = false,
  onBurstComplete,
  onAction,
  onDone,
}: SetupChecklistBodyProps) {
  return (
    <div>
      {completion ? (
        <SetupChecklistCompletion
          showBurst={showBurst}
          onBurstComplete={onBurstComplete}
          onDone={onDone}
        />
      ) : null}
      <ol aria-label="Setup steps" className="m-0 list-none p-0">
        {checklist.items.map((item) => (
          <ChecklistRow
            key={item.id}
            item={item}
            workspaceSlug={workspaceSlug}
            onAction={onAction}
          />
        ))}
      </ol>
    </div>
  );
}
