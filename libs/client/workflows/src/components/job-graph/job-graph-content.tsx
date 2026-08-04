import {EmptyState} from '@shipfox/react-ui/empty-state';
import {TimeTickerProvider} from '@shipfox/react-ui/time-ticker';
import {cn} from '@shipfox/react-ui/utils';
import type {KeyboardEvent} from 'react';
import {useRef, useState} from 'react';
import type {WorkflowRunDetail} from '#core/workflow-run.js';
import type {JobGraphModel, JobGraphNavigationKey} from './graph-model.js';
import {nextJobGraphNodeId} from './graph-model.js';
import {JobNode, TriggerNode} from './job-node.js';
import type {JobGraphSelectionSource} from './types.js';

const NODE_WIDTH = 208;
const NODE_HEIGHT = 48;
const COLUMN_GAP = 64;
const ROW_GAP = 20;
const TRIGGER_WIDTH = 36;
const PADDING = 16;

export function JobGraphContent({
  model,
  trigger,
  selectedJobId,
  onSelectJob,
}: {
  model: JobGraphModel;
  trigger: Pick<
    WorkflowRunDetail,
    'triggerDisplayLabel' | 'triggerLabel' | 'triggerProvider' | 'triggerSource'
  >;
  selectedJobId?: string | undefined;
  onSelectJob: (jobId: string | undefined, source?: JobGraphSelectionSource) => void;
}) {
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const [hoveredJobId, setHoveredJobId] = useState<string | undefined>();

  if (model.nodes.length === 0) {
    return (
      <EmptyState
        className="min-h-160 px-16 py-24"
        icon="componentLine"
        title="No jobs yet"
        description="This run has not materialized jobs."
        variant="compact"
      />
    );
  }

  const maxRows = Math.max(1, ...model.columns.map((column) => column.length));
  const contentWidth =
    PADDING * 2 +
    TRIGGER_WIDTH +
    COLUMN_GAP +
    model.columns.length * NODE_WIDTH +
    Math.max(0, model.columns.length - 1) * COLUMN_GAP;
  const contentHeight = PADDING * 2 + maxRows * NODE_HEIGHT + Math.max(0, maxRows - 1) * ROW_GAP;

  function setNodeRef(jobId: string) {
    return (element: HTMLButtonElement | null) => {
      if (element) {
        nodeRefs.current.set(jobId, element);
      } else {
        nodeRefs.current.delete(jobId);
      }
    };
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const key = navigationKey(event.key);
    if (!key) return;

    const currentNodeId = event.currentTarget.dataset.jobId;
    if (!currentNodeId) return;

    const nextNodeId = nextJobGraphNodeId({model, currentNodeId, key});
    if (!nextNodeId) return;

    event.preventDefault();
    onSelectJob(nextNodeId, 'keyboard');
    nodeRefs.current.get(nextNodeId)?.focus();
  }

  return (
    <TimeTickerProvider intervalMs={1000} reducedMotionIntervalMs={10_000}>
      <div className="min-h-0 overflow-auto bg-background-neutral-background">
        <div className="relative" style={{width: contentWidth, minHeight: contentHeight}}>
          <GraphEdges model={model} hoveredJobId={hoveredJobId} />
          <div
            className="absolute"
            style={{left: PADDING, top: PADDING + (NODE_HEIGHT - TRIGGER_WIDTH) / 2}}
          >
            <TriggerNode trigger={trigger} />
          </div>
          {model.columns.map((column, columnIndex) => (
            <div
              key={column.map((node) => node.id).join(':')}
              className="absolute flex flex-col gap-20"
              style={{left: jobLeft(columnIndex), top: PADDING}}
            >
              {column.map((node) => (
                <JobNode
                  key={node.id}
                  node={node}
                  selected={node.id === selectedJobId}
                  ref={setNodeRef(node.id)}
                  onSelect={() =>
                    onSelectJob(node.id === selectedJobId ? undefined : node.id, 'pointer')
                  }
                  onKeyDown={handleKeyDown}
                  onHoverStart={() => setHoveredJobId(node.id)}
                  onHoverEnd={() =>
                    setHoveredJobId((current) => (current === node.id ? undefined : current))
                  }
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </TimeTickerProvider>
  );
}

function navigationKey(key: string): JobGraphNavigationKey | undefined {
  if (
    key === 'ArrowRight' ||
    key === 'ArrowLeft' ||
    key === 'ArrowDown' ||
    key === 'ArrowUp' ||
    key === 'j' ||
    key === 'k'
  ) {
    return key;
  }
  return undefined;
}

function GraphEdges({
  model,
  hoveredJobId,
}: {
  model: JobGraphModel;
  hoveredJobId?: string | undefined;
}) {
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const edgeViews = model.edges
    .map((edge) => {
      const fromNode = byId.get(edge.from);
      const toNode = byId.get(edge.to);
      const from = edge.from === 'trigger' ? triggerPoint() : jobRightPoint(fromNode);
      const to = jobLeftPoint(toNode);
      if (!from || !to) return undefined;

      return {
        id: edge.id,
        highlighted: edge.from === hoveredJobId || edge.to === hoveredJobId,
        path: edgePath({from, fromNode, to, toNode}),
      };
    })
    .filter((edgeView): edgeView is NonNullable<typeof edgeView> => edgeView !== undefined)
    .sort((left, right) => Number(left.highlighted) - Number(right.highlighted));

  return (
    <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
      {edgeViews.map((edge) => {
        return (
          <g
            key={edge.id}
            className={cn(
              'text-foreground-neutral-muted transition-colors',
              edge.highlighted && 'text-foreground-neutral-base',
            )}
          >
            <path
              data-edge-id={edge.id}
              d={edge.path}
              fill="none"
              stroke="currentColor"
              strokeWidth={edge.highlighted ? 1.5 : 1}
            />
          </g>
        );
      })}
    </svg>
  );
}

function edgePath({
  from,
  fromNode,
  to,
  toNode,
}: {
  from: {x: number; y: number};
  fromNode: {column: number} | undefined;
  to: {x: number; y: number};
  toNode: {column: number} | undefined;
}) {
  if (fromNode && toNode && toNode.column - fromNode.column > 1 && from.y !== to.y) {
    const targetLaneX = to.x - COLUMN_GAP / 2;
    return `M ${from.x} ${from.y} H ${targetLaneX} V ${to.y} H ${to.x}`;
  }

  const midX = from.x + (to.x - from.x) / 2;
  return `M ${from.x} ${from.y} H ${midX} V ${to.y} H ${to.x}`;
}

function triggerPoint() {
  return {x: PADDING + TRIGGER_WIDTH, y: PADDING + NODE_HEIGHT / 2};
}

function jobLeft(column: number): number {
  // Dependency depths are contiguous, so a node's depth matches its rendered column index.
  return PADDING + TRIGGER_WIDTH + COLUMN_GAP + column * (NODE_WIDTH + COLUMN_GAP);
}

function jobTop(row: number): number {
  return PADDING + row * (NODE_HEIGHT + ROW_GAP);
}

function jobLeftPoint(node: {column: number; row: number} | undefined) {
  if (!node) return undefined;
  return {x: jobLeft(node.column), y: jobTop(node.row) + NODE_HEIGHT / 2};
}

function jobRightPoint(node: {column: number; row: number} | undefined) {
  if (!node) return undefined;
  return {x: jobLeft(node.column) + NODE_WIDTH, y: jobTop(node.row) + NODE_HEIGHT / 2};
}
