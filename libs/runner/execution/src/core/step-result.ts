import type {LeasedWriteAnnotationOperationDto} from '@shipfox/annotations-dto';
import type {CheckoutResultDto, StepErrorDto} from '@shipfox/api-workflows-dto';

export type CheckoutResult = CheckoutResultDto;

export interface StepResult {
  success: boolean;
  // Agent final reply, reported as `response` for agent attempts.
  response?: string;
  // Step key/value outputs reported in the API report `output` field.
  outputs?: Record<string, string>;
  // Run-step annotations posted before reporting the step result.
  annotations?: LeasedWriteAnnotationOperationDto[];
  // Resolved checkout details reported by setup or an explicit checkout step.
  checkout?: CheckoutResult;
  // Populated when success is false. Null on success.
  error: StepErrorDto;
  // 0 on success, the exit code on failure, null when signal-killed or never spawned.
  exit_code: number | null;
}
