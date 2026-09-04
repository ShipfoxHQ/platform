import {usageInterModuleContract} from '@shipfox/api-usage-dto/inter-module';
import {defineInterModulePresentation, type InterModulePresentation} from '@shipfox/inter-module';
import {
  listInferenceSegments,
  recordInferenceSegments,
  toInferenceSegmentUsage,
} from '#db/inference-segments.js';
import {listJobExecutionUsage, toJobExecutionUsage} from '#db/job-executions.js';
import {addUsageMetric, usageInferenceSegmentRecorded} from '#metrics/instance.js';

export function createUsageInterModulePresentation(): InterModulePresentation<
  typeof usageInterModuleContract
> {
  return defineInterModulePresentation(usageInterModuleContract, {
    recordInferenceSegments: async (input) => {
      const result = await recordInferenceSegments(input);
      if (result.recorded > 0) {
        addUsageMetric(usageInferenceSegmentRecorded, result.recorded, 'recorded');
      }
      if (result.duplicates > 0) {
        addUsageMetric(usageInferenceSegmentRecorded, result.duplicates, 'duplicate');
      }
      return result;
    },
    listJobExecutionUsage: async (input) => {
      const result = await listJobExecutionUsage({
        workspaceId: input.workspaceId,
        since: input.since ? new Date(input.since) : undefined,
        cursor: input.cursor
          ? {
              recordedAt: new Date(input.cursor.recordedAt),
              jobExecutionId: input.cursor.jobExecutionId,
            }
          : undefined,
        limit: input.limit,
      });
      return {
        jobExecutions: result.jobExecutions.map(toJobExecutionUsage),
        nextCursor: result.nextCursor
          ? {
              recordedAt: result.nextCursor.recordedAt.toISOString(),
              jobExecutionId: result.nextCursor.jobExecutionId,
            }
          : null,
      };
    },
    listInferenceSegments: async (input) => {
      const result = await listInferenceSegments({
        workspaceId: input.workspaceId,
        since: input.since ? new Date(input.since) : undefined,
        cursor: input.cursor
          ? {recordedAt: new Date(input.cursor.recordedAt), id: input.cursor.id}
          : undefined,
        limit: input.limit,
      });
      return {
        segments: result.segments.map(toInferenceSegmentUsage),
        nextCursor: result.nextCursor
          ? {recordedAt: result.nextCursor.recordedAt.toISOString(), id: result.nextCursor.id}
          : null,
      };
    },
  });
}
