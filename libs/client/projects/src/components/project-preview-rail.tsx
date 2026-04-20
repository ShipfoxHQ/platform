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
  projectName: string;
  state: ProjectPreviewState;
  createdProject?: ProjectResponseDto | undefined;
}

export function ProjectPreviewRail({
  repositoryId,
  projectName,
  state,
  createdProject,
}: ProjectPreviewRailProps) {
  const copy = previewStateCopy[state];
  const repositoryName = repositoryId.trim() || 'Waiting for repository';
  const displayProjectName = projectName.trim() || 'New Shipfox project';
  const repository = createdProject?.repository;

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
            <Badge variant="info">Test provider</Badge>
            <Badge variant="warning">Local only</Badge>
          </div>
          <Text size="lg" bold className="mt-12 break-words">
            {displayProjectName}
          </Text>
          <Text size="sm" className="text-foreground-neutral-muted break-words">
            {repository?.full_name ?? `test-owner/${repositoryName}`}
          </Text>
        </div>

        <PreviewRow label="Provider host" value={repository?.provider_host ?? 'test.local'} />
        <PreviewRow label="Repository id" value={repositoryId.trim() || 'Not selected'} />
        <PreviewRow label="Default branch" value={repository?.default_branch ?? 'main'} />
        <PreviewRow label="Visibility" value={repository?.visibility ?? 'private'} />
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
