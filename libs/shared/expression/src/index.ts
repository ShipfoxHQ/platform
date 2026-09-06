export {
  type WorkflowExpressionEvaluationDetail,
  WorkflowExpressionEvaluationError,
  type WorkflowExpressionEvaluationFailureReason,
  workflowExpressionEvaluationErrorCode,
} from './evaluator/errors.js';
export {
  evaluateWorkflowExpression,
  evaluateWorkflowExpressionWithEnvironment,
  evaluateWorkflowPredicate,
  evaluateWorkflowPredicateFailClosed,
  type FailClosedPredicateOutcome,
  type WorkflowExpressionEnvironment,
  type WorkflowExpressionEvaluationContext,
  type WorkflowExpressionEvaluationValue,
} from './evaluator/evaluate-workflow-expression.js';
export {createRangeEnvironment, MAX_RANGE_ELEMENTS} from './evaluator/range.js';
export {
  rehydrateJsonExpressionRecord,
  rehydrateJsonExpressionValue,
} from './evaluator/rehydrate-json-expression.js';
export {createWorkflowEnvironment} from './evaluator/workflow-environment.js';
export {
  createWorkflowExpression,
  unsafeWorkflowExpressionFromSource,
} from './expression/create-workflow-expression.js';
export {
  InvalidWorkflowExpressionError,
  invalidWorkflowExpressionErrorCode,
} from './expression/errors.js';
export type {
  CreateWorkflowExpressionParams,
  ExpressionScalarType,
  ExpressionType,
  ExpressionTypeEnvironment,
  ValidCelExpression,
  WorkflowExpression,
  WorkflowExpressionCheck,
  WorkflowExpressionCheckOptions,
} from './expression/workflow-expression.js';
export {
  type CoerceStepOutputsResult,
  coerceStepOutputs,
  type JsonSchemaValidationResult,
  jsonSchemaToExpressionType,
  type OutputDeclarations,
  type OutputType,
  type OutputTypeDeclaration,
  outputDeclarationsToExpressionFields,
  outputDeclarationToExpressionType,
  outputTypes,
  type StepOutputCoercionError,
  type StepOutputCoercionErrorReason,
  validateJsonSchema,
} from './outputs/index.js';
export {isBareContextReference} from './plan/bare-reference.js';
export {
  analyzeContextKeyAccess,
  analyzeContextRootKeyAccess,
  type ContextKeyAccessAnalysis,
  type ContextKeyAccessReference,
  type ContextKeyAccessViolation,
  type ContextRootKeyAccessAnalysis,
  type ContextRootKeyAccessReference,
} from './plan/context-key-access.js';
export {evaluatePlannedPredicateAtSite} from './plan/evaluate-planned-predicate.js';
export {
  capTraceEntries,
  capTraceValue,
  EVALUATION_TRACE_MAX_BYTES,
  EVALUATION_TRACE_MAX_ENTRIES,
  EVALUATION_TRACE_VALUE_CAP_BYTES,
  type EvaluationTraceEntry,
  type EvaluationTraceLimitEntry,
  type EvaluationTraceRowEntry,
  evaluationTraceEntry,
  predicateTraceEntry,
} from './plan/evaluation-trace.js';
export {
  analyzeContextPathAccess,
  type ContextPathAccessAnalysis,
  type ContextPathAccessUnknown,
  type ContextPathReference,
  type ContextPathSegment,
} from './plan/extract-context-paths.js';
export {extractExactContextRoots} from './plan/extract-exact-context-roots.js';
export {
  type FrozenResolvedField,
  freezeResolvedFieldAtSite,
  resolveFieldAtSite,
  type SiteResolvedField,
  type WorkflowTemplateDiagnostic,
  type WorkflowTemplateFailurePolicy,
} from './plan/freeze.js';
export {
  type FrozenPlannedRunCommand,
  freezePlannedRunCommandAtSite,
} from './plan/freeze-run-command.js';
export {
  type FieldPlan,
  type FieldPlanResult,
  type PlanViolation,
  planInterpolationField,
} from './plan/plan-field.js';
export {predicateSourceIsBooleanShaped} from './plan/predicate-shape.js';
export type {
  ResolvedField,
  ResolvedFieldDeferredSegment,
  ResolvedFieldLiteralSegment,
  ResolvedFieldSegment,
} from './plan/resolved-field.js';
export {type RoutedExpression, routeExpression} from './plan/route-expression.js';
export {
  type ServerEvaluabilityResult,
  type ServerEvaluabilityViolation,
  validateServerEvaluable,
} from './plan/validate-server-evaluable.js';
export {
  WorkflowTemplateResolutionError,
  workflowTemplateResolutionErrorCode,
} from './resolver/errors.js';
export {
  type HoistedPlannedRunCommand,
  hoistPlannedRunCommand,
  type PlannedRunCommandBinding,
  type RunCommandHoistOptions,
  type UnsafeRunInterpolation,
  UnsafeRunInterpolationError,
  unsafeRunInterpolationErrorCode,
} from './run/hoist-run-command.js';
export {
  classifyShellCodePosition,
  type ShellCodePositionAnalysis,
  type ShellCodePositionMatch,
  type ShellReevaluatingConstruct,
} from './run/shell-code-position.js';
export {
  InvalidWorkflowTemplateError,
  invalidWorkflowTemplateErrorCode,
} from './template/errors.js';
export {extractCelContextRoots} from './template/extract-cel-context-roots.js';
export {parseWorkflowTemplate} from './template/parse-workflow-template.js';
export type {
  WorkflowTemplateExprSegment,
  WorkflowTemplateLiteralSegment,
  WorkflowTemplateSegment,
} from './template/template-segment.js';
export {
  type AvailabilitySite,
  availabilitySites,
  buildTypedRootsEnvironment,
  contextRootsForField,
  type FillTarget,
  getWorkflowContextAvailability,
  getWorkflowContextDefinition,
  getWorkflowContextHost,
  getWorkflowContextSensitivity,
  getWorkflowContextTypeEnvironment,
  getWorkflowInterpolationFieldFailurePolicy,
  getWorkflowInterpolationFieldSelfReference,
  getWorkflowInterpolationFieldTypeEnvironment,
  getWorkflowPredicateContextRoots,
  getWorkflowPredicateFieldMinimumFillTarget,
  getWorkflowPredicateFieldTypeEnvironment,
  isWorkflowPredicateField,
  type OpenWorkflowContextDefinition,
  projectWorkflowPredicateContext,
  type ReservedRootDefinition,
  type RunnerWorkflowContextDefinition,
  resolveContextRootAvailability,
  resolveContextRootHost,
  rootsAvailableAt,
  runnerFillTarget,
  type TypedWorkflowContextDefinition,
  toolStepReportTypeEnvironment,
  unavailableRootsAt,
  type WorkflowContextAvailabilityReferenceEntry,
  type WorkflowContextDefinition,
  type WorkflowContextHost,
  type WorkflowContextName,
  type WorkflowContextReservedRoot,
  type WorkflowContextSensitivity,
  type WorkflowContextShape,
  type WorkflowFieldFailurePolicy,
  type WorkflowInterpolationFailurePolicy,
  type WorkflowInterpolationField,
  type WorkflowInterpolationFieldPolicy,
  type WorkflowJobTypeOverlay,
  type WorkflowPredicateContextRoot,
  type WorkflowPredicateField,
  type WorkflowStepKind,
  type WorkflowStepTypeOverlay,
  workflowContextAvailabilityReference,
  workflowContextDefinitions,
  workflowContextHosts,
  workflowContextNames,
  workflowContextReservedRoots,
  workflowContextRootRequiresLiteralKey,
  workflowContextSensitivities,
  workflowFieldFailurePolicies,
  workflowInterpolationFieldAcceptsHost,
  workflowInterpolationFieldPolicies,
  workflowInterpolationFields,
  workflowPredicateContextRoots,
  workflowPredicateFieldFailurePolicy,
  workflowPredicateFields,
} from './workflow-context/workflow-context.js';
export {
  type WorkflowContextDoc,
  workflowContextDocs,
} from './workflow-context/workflow-context-docs.js';
export {
  MAX_JSON_OUTPUT_BYTES,
  MAX_RANGE_FANOUT_BYTES,
} from './workflow-function-registry.js';
