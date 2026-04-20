export const DEFINITION_RESOLVED = 'definitions.definition.resolved' as const;
export const DEFINITION_INVALID = 'definitions.definition.invalid' as const;

export interface DefinitionResolvedEvent {
  definitionId: string;
  projectId: string;
  configPath: string | null;
}

export interface DefinitionInvalidEvent {
  projectId: string;
  ref: string;
  errors: string[];
}

export interface DefinitionsEventMap {
  [DEFINITION_RESOLVED]: DefinitionResolvedEvent;
  [DEFINITION_INVALID]: DefinitionInvalidEvent;
}
