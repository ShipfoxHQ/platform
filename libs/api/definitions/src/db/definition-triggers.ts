import type {TriggerDto} from '@shipfox/api-definitions-dto';
import type {WorkflowModel} from '#core/entities/workflow-model.js';

export function definitionTriggersFor(model: WorkflowModel): Record<string, TriggerDto> {
  return Object.fromEntries(
    model.triggers.map((trigger) => {
      const dto: TriggerDto = {
        source: trigger.source,
        ...(trigger.event === undefined ? {} : {event: trigger.event}),
      };
      if (trigger.inputs !== undefined) dto.with = trigger.inputs;
      if (trigger.filter !== undefined) dto.filter = trigger.filter;
      if (trigger.config !== undefined) dto.config = trigger.config;
      return [trigger.key, dto];
    }),
  );
}
