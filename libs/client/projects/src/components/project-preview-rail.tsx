import type {ProjectResponseDto} from '@shipfox/api-projects-dto';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatusBadge,
  Text,
} from '@shipfox/react-ui';

export type ProjectPreviewState = 'waiting' | 'ready' | 'creating' | 'created' | 'error';

const previewStateCopy: Record<
  ProjectPreviewState,
  {label: string; variant: 'neutral' | 'info' | 'success' | 'warning' | 'error'}
> = {
  waiting: {label: 'Waiting', variant: 'neutral'},
  ready: {label: 'Ready', variant: 'info'},
  creating: {label: 'Creating', variant: 'warning'},
  created: {label: 'Created', variant: 'success'},
  error: {label: 'Needs attention', variant: 'error'},
};

interface ProjectPreviewRailProps {
  repositoryId: string;
  connectionName?: string | undefined;
  projectName: string;
  state: ProjectPreviewState;
  createdProject?: ProjectResponseDto | undefined;
}

export function ProjectPreviewRail({
  repositoryId,
  connectionName,
  projectName,
  state,
  createdProject,
}: ProjectPreviewRailProps) {
  const copy = previewStateCopy[state];
  const repositoryName = repositoryId.trim() || 'Waiting for repository';
  const displayProjectName = projectName.trim() || 'New Shipfox project';
  const source = createdProject?.source;

  return (
    <Card className="gap-18 p-20">
      <CardHeader className="flex-row items-start justify-between gap-16">
        <div className="min-w-0">
          <CardTitle variant="h3">Project preview</CardTitle>
          <Text size="sm" className="text-foreground-neutral-muted">
            Repository binding
          </Text>
        </div>
        <StatusBadge variant={copy.variant}>{copy.label}</StatusBadge>
      </CardHeader>
      <CardContent className="flex flex-col gap-16">
        <div className="rounded-8 border border-border-neutral-base bg-background-subtle-base p-14">
          <div className="flex items-center gap-8">
            <Badge variant="info">Source control</Badge>
            <Badge variant="warning">Debug</Badge>
          </div>
          <Text size="lg" bold className="mt-12 break-words">
            {displayProjectName}
          </Text>
          <Text size="sm" className="text-foreground-neutral-muted break-words">
            {source?.external_repository_id ?? repositoryName}
          </Text>
        </div>

        <PreviewRow label="Connection" value={connectionName ?? 'Not connected'} />
        <PreviewRow label="Connection id" value={source?.connection_id ?? 'Not selected'} />
        <PreviewRow label="Repository id" value={repositoryId.trim() || 'Not selected'} />
      </CardContent>
    </Card>
  );
}

function PreviewRow({label, value}: {label: string; value: string}) {
  return (
    <div className="flex items-center justify-between gap-16 border-t border-border-neutral-base pt-12">
      <Text size="xs" className="text-foreground-neutral-muted">
        {label}
      </Text>
      <Text size="sm" className="min-w-0 truncate text-right">
        {value}
      </Text>
    </div>
  );
}
