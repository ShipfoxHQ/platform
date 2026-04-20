import type {DomainEvent} from '@shipfox/node-outbox';

export type EventHandler = (event: DomainEvent) => Promise<void>;

const _handlers = new Map<string, EventHandler[]>();

export function subscribe(type: string, handler: EventHandler): void {
  const existing = _handlers.get(type) ?? [];
  existing.push(handler);
  _handlers.set(type, existing);
}

export function getSubscribers(type: string): EventHandler[] {
  return _handlers.get(type) ?? [];
}

export function resetSubscribers(): void {
  _handlers.clear();
}
