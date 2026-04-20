/**
 * Map from event type string to its payload shape.
 * Each DTO package defines its own map fragment:
 *
 * @example
 * interface DefinitionsEventMap {
 *   [DEFINITION_RESOLVED]: DefinitionResolvedEvent;
 *   [DEFINITION_INVALID]: DefinitionInvalidEvent;
 * }
 */
export type EventType<TMap extends EventMapLike> = keyof TMap & string;

export type EventPayload<TMap extends EventMapLike, T extends EventType<TMap>> = TMap[T];

export interface DomainEvent<TPayload = unknown> {
  id: string;
  type: string;
  payload: TPayload;
  createdAt: Date;
}

// biome-ignore lint/suspicious/noExplicitAny: generic constraint for event maps
export type EventMapLike = Record<string, any>;
