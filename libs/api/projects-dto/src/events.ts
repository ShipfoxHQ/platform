import {z} from 'zod';

const nonEmptyStringSchema = z.string().nonempty();

export const PROJECT_CREATED = 'projects.project.created' as const;
export const PROJECT_UPDATED = 'projects.project.updated' as const;
export const PROJECT_SOURCE_BOUND = 'projects.project.source_bound' as const;
export const PROJECT_SOURCE_COMMIT_OBSERVED = 'projects.project.source_commit_observed' as const;

const projectCreatedEventWithoutSlugSchema = z.object({
  actorId: nonEmptyStringSchema,
  workspaceId: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema,
  sourceConnectionId: nonEmptyStringSchema,
  sourceExternalRepositoryId: nonEmptyStringSchema,
});

const projectCreatedEventWithSlugSchema = projectCreatedEventWithoutSlugSchema.extend({
  slug: nonEmptyStringSchema,
});

export const projectCreatedEventSchema = z.union([
  projectCreatedEventWithSlugSchema,
  projectCreatedEventWithoutSlugSchema,
]);
export type ProjectCreatedEvent = z.infer<typeof projectCreatedEventWithSlugSchema>;

export const projectUpdatedEventSchema = z.object({
  actorId: nonEmptyStringSchema,
  workspaceId: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  slug: nonEmptyStringSchema,
});
export type ProjectUpdatedEvent = z.infer<typeof projectUpdatedEventSchema>;

export const projectSourceBoundEventSchema = z.object({
  actorId: nonEmptyStringSchema,
  workspaceId: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema,
  sourceConnectionId: nonEmptyStringSchema,
  provider: nonEmptyStringSchema,
  externalRepositoryId: nonEmptyStringSchema,
});
export type ProjectSourceBoundEvent = z.infer<typeof projectSourceBoundEventSchema>;

export const projectSourceCommitObservedEventSchema = z.object({
  workspaceId: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema,
  sourceConnectionId: nonEmptyStringSchema,
  provider: nonEmptyStringSchema,
  externalRepositoryId: nonEmptyStringSchema,
  ref: nonEmptyStringSchema,
  headCommitSha: nonEmptyStringSchema,
});
export type ProjectSourceCommitObservedEvent = z.infer<
  typeof projectSourceCommitObservedEventSchema
>;

export interface ProjectsEventMap {
  [PROJECT_CREATED]: ProjectCreatedEvent;
  [PROJECT_UPDATED]: ProjectUpdatedEvent;
  [PROJECT_SOURCE_BOUND]: ProjectSourceBoundEvent;
  [PROJECT_SOURCE_COMMIT_OBSERVED]: ProjectSourceCommitObservedEvent;
}

export const projectsEventSchemas = {
  [PROJECT_CREATED]: projectCreatedEventSchema,
  [PROJECT_UPDATED]: projectUpdatedEventSchema,
  [PROJECT_SOURCE_BOUND]: projectSourceBoundEventSchema,
  [PROJECT_SOURCE_COMMIT_OBSERVED]: projectSourceCommitObservedEventSchema,
} satisfies Record<keyof ProjectsEventMap, z.ZodType>;
