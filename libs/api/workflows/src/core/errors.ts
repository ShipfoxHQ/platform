export class DefinitionNotFoundError extends Error {
  constructor(definitionId: string) {
    super(`Definition not found: ${definitionId}`);
    this.name = 'DefinitionNotFoundError';
  }
}

export class ProjectMismatchError extends Error {
  constructor(definitionProjectId: string, requestProjectId: string) {
    super(
      `Definition belongs to project ${definitionProjectId}, but request targets project ${requestProjectId}`,
    );
    this.name = 'ProjectMismatchError';
  }
}
