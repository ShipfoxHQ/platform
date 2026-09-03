import {createHash} from 'node:crypto';
import type {HarnessInvocation} from '#core/harness.js';

export const AGENT_SESSION_DIAGNOSTICS_ENTRY_TYPE = 'shipfox_agent_diagnostics';
export const AGENT_SESSION_DIAGNOSTICS_VERSION = 1 as const;

export type AgentSessionHarness = 'pi' | 'claude';
export type AgentSessionMetadataMode = 'cold' | 'warm';

/** Stable classes used to group a failed agent session without parsing prose. */
export type AgentSessionFailureClass =
  | 'required_output_missing'
  | 'agent_tool_loop_detected'
  | 'output_conflict'
  | 'integration_tool_catalog_unavailable';

export type AgentSessionTerminationReason =
  | 'completed'
  | 'aborted'
  | 'required_output_missing'
  | 'agent_tool_loop_detected'
  | 'output_conflict'
  | 'integration_tool_catalog_unavailable'
  | 'error';

export interface AgentSessionToolDescriptor {
  readonly name: string;
  readonly description?: string | undefined;
  readonly inputSchema: unknown;
  readonly outputSchema?: unknown | undefined;
}

export interface AgentSessionCatalogFailure {
  readonly server: string;
  readonly errorClass: 'http' | 'timeout' | 'transport' | 'unknown';
  readonly status?: number | undefined;
}

export interface AgentSessionRegistration {
  readonly metadataMode: AgentSessionMetadataMode;
  readonly directToolNames: readonly string[];
  readonly proxyFallback: boolean;
}

export interface AgentSessionToolCall {
  readonly sequence: number;
  readonly toolCallId?: string | undefined;
  readonly toolName: string;
  /** Protected session artifacts may retain the exact normalized arguments. */
  readonly normalizedArgs: unknown;
  readonly argsFingerprint: string;
}

export interface AgentSessionToolResult {
  readonly sequence: number;
  readonly toolCallId?: string | undefined;
  readonly toolName?: string | undefined;
  readonly isError: boolean;
  readonly resultFingerprint: string;
  readonly structuredResultFingerprint?: string | undefined;
  readonly error?: AgentToolErrorDetails | undefined;
}

export type AgentSessionOutputWriteStatus = 'accepted' | 'idempotent' | 'conflicting' | 'rejected';

export interface AgentSessionOutputWrite {
  readonly sequence: number;
  readonly key: string;
  readonly status: AgentSessionOutputWriteStatus;
  readonly valueFingerprint: string;
  readonly code?: string | undefined;
}

export interface AgentSessionBudget {
  readonly consumed: number;
  /** No agent budget is configured at this boundary today. */
  readonly remaining: number | null;
}

export interface AgentSessionBudgets {
  readonly turns: AgentSessionBudget;
  readonly toolCalls: AgentSessionBudget;
  readonly timeMs: AgentSessionBudget;
  readonly tokens: AgentSessionBudget;
}

export interface AgentToolErrorDetails {
  readonly code: string;
  readonly reason?: string | undefined;
  readonly tool?: string | undefined;
  readonly parameter?: string | undefined;
  readonly status?: number | undefined;
}

export interface AgentSessionTermination {
  readonly reason: AgentSessionTerminationReason;
  readonly failureClass?: AgentSessionFailureClass | undefined;
}

export interface AgentSessionDiagnosticEntry {
  readonly kind: 'agent_session_diagnostics';
  readonly version: typeof AGENT_SESSION_DIAGNOSTICS_VERSION;
  readonly harness: AgentSessionHarness;
  readonly provider: string;
  readonly model: string;
  readonly sessionId?: string | undefined;
  readonly registration: AgentSessionRegistration;
  readonly providerTools: readonly AgentSessionToolDescriptor[];
  readonly catalogFailures: readonly AgentSessionCatalogFailure[];
  readonly toolCalls: readonly AgentSessionToolCall[];
  readonly toolResults: readonly AgentSessionToolResult[];
  readonly outputWrites: readonly AgentSessionOutputWrite[];
  readonly failureClasses: readonly AgentSessionFailureClass[];
  readonly termination: AgentSessionTermination;
  readonly budgets: AgentSessionBudgets;
}

export interface AgentSessionDiagnosticStoreEntry {
  readonly [key: string]: unknown;
  readonly type: typeof AGENT_SESSION_DIAGNOSTICS_ENTRY_TYPE;
  readonly uuid: string;
  readonly data: AgentSessionDiagnosticEntry;
}

interface AgentSessionDiagnosticsParams {
  readonly harness: AgentSessionHarness;
  readonly invocation: Pick<
    HarnessInvocation,
    'jobExecutionId' | 'stepId' | 'attempt' | 'provider' | 'model' | 'session'
  >;
  readonly metadataMode: AgentSessionMetadataMode;
  readonly directToolNames?: readonly string[] | undefined;
  readonly proxyFallback?: boolean | undefined;
  readonly providerTools?: readonly AgentSessionToolDescriptor[] | undefined;
  readonly catalogFailures?: readonly AgentSessionCatalogFailure[] | undefined;
}

interface RecordToolResultParams {
  readonly toolCallId?: string | undefined;
  readonly toolName?: string | undefined;
  readonly isError: boolean;
  readonly details?: unknown;
  readonly structuredContent?: unknown;
}

const MAX_DIAGNOSTIC_TOOL_CALLS = 256;
const MAX_DIAGNOSTIC_TOOL_RESULTS = 256;
const MAX_DIAGNOSTIC_OUTPUT_WRITES = 256;
const MAX_DIAGNOSTIC_FAILURE_CLASSES = 4;
const MAX_DIAGNOSTIC_CATALOG_FAILURES = 32;
const MAX_REPEATED_TOOL_FAILURES = 3;
const STABLE_ERROR_CODES = new Set([
  'invalid-request',
  'unknown',
  'provider-timeout',
  'cancelled',
  'credentials-unavailable',
  'repository-required',
  'repository-not-granted',
  'repository-ambiguous',
  'repository-authorization-unavailable',
  'search-qualifier-conflict',
  'repository-not-found',
  'installation-not-found',
  'file-not-found',
  'ref-not-found',
  'ref-invalid',
  'access-denied',
  'rate-limited',
  'timeout',
  'provider-unavailable',
  'provider-rejected',
  'malformed-provider-response',
  'content-too-large',
  'too-many-files',
  'required_output_missing',
  'agent_tool_loop_detected',
  'output_conflict',
  'output_schema_mismatch',
  'output_value_too_large',
  'output_total_too_large',
  'invalid_output_key',
  'undeclared_output',
]);

/**
 * Collects protected, structured session facts. Nothing from this class is
 * sent to normal logs or metric labels; adapters decide when to append the
 * snapshot to their native protected transcript.
 */
export class AgentSessionDiagnostics {
  readonly #harness: AgentSessionHarness;
  readonly #provider: string;
  readonly #model: string;
  readonly #entryUuid: string;
  readonly #startedAt = Date.now();
  readonly #registration: AgentSessionRegistration;
  #providerTools: readonly AgentSessionToolDescriptor[];
  readonly #catalogFailures: AgentSessionCatalogFailure[];
  readonly #toolCalls: AgentSessionToolCall[] = [];
  readonly #toolResults: AgentSessionToolResult[] = [];
  readonly #outputWrites: AgentSessionOutputWrite[] = [];
  readonly #toolCallById = new Map<string, AgentSessionToolCall>();
  readonly #repeatedFailures = new Map<string, number>();
  readonly #failureClasses: AgentSessionFailureClass[] = [];
  #sessionId: string | undefined;
  #sequence = 0;
  #turnsConsumed = 0;
  #toolCallsConsumed = 0;
  #tokensConsumed = 0;
  #terminationReason: AgentSessionTerminationReason | undefined;
  #terminationFailureClass: AgentSessionFailureClass | undefined;

  constructor(params: AgentSessionDiagnosticsParams) {
    this.#harness = params.harness;
    this.#provider = params.invocation.provider;
    this.#model = params.invocation.model;
    this.#entryUuid = diagnosticEntryUuid(params);
    this.#registration = {
      metadataMode: params.metadataMode,
      directToolNames: [...new Set(params.directToolNames ?? [])],
      proxyFallback: params.proxyFallback ?? false,
    };
    this.#providerTools = (params.providerTools ?? []).map(normalizeToolDescriptor);
    this.#catalogFailures = (params.catalogFailures ?? [])
      .slice(0, MAX_DIAGNOSTIC_CATALOG_FAILURES)
      .map(normalizeCatalogFailure);
    if (this.#catalogFailures.length > 0) {
      this.markFailure('integration_tool_catalog_unavailable');
    }
  }

  get entryUuid(): string {
    return this.#entryUuid;
  }

  get terminationReason(): AgentSessionTerminationReason | undefined {
    return this.#terminationReason;
  }

  get failureClasses(): readonly AgentSessionFailureClass[] {
    return this.#failureClasses;
  }

  recordSessionId(sessionId: string | undefined): void {
    if (sessionId !== undefined && sessionId !== '') this.#sessionId = sessionId;
  }

  recordProviderTools(tools: readonly AgentSessionToolDescriptor[]): void {
    if (tools.length === 0) return;
    this.#providerTools = tools.map(normalizeToolDescriptor);
  }

  recordToolCall(params: {toolCallId?: string | undefined; toolName: string; args: unknown}): void {
    const normalizedArgs = normalizeDiagnosticValue(params.args);
    const call: AgentSessionToolCall = {
      sequence: this.#nextSequence(),
      ...(params.toolCallId === undefined ? {} : {toolCallId: params.toolCallId}),
      toolName: params.toolName,
      normalizedArgs,
      argsFingerprint: stableDiagnosticFingerprint(normalizedArgs),
    };
    this.#toolCallsConsumed += 1;
    if (this.#toolCalls.length < MAX_DIAGNOSTIC_TOOL_CALLS) this.#toolCalls.push(call);
    if (params.toolCallId !== undefined) this.#toolCallById.set(params.toolCallId, call);
  }

  updateToolCallArguments(toolCallId: string, args: unknown): void {
    const existing = this.#toolCallById.get(toolCallId);
    if (existing === undefined) return;
    const normalizedArgs = normalizeDiagnosticValue(args);
    const updated = {
      ...existing,
      normalizedArgs,
      argsFingerprint: stableDiagnosticFingerprint(normalizedArgs),
    };
    this.#toolCallById.set(toolCallId, updated);
    const index = this.#toolCalls.findIndex((call) => call.toolCallId === toolCallId);
    if (index >= 0) this.#toolCalls[index] = updated;
  }

  recordToolResult(params: RecordToolResultParams): void {
    const call =
      params.toolCallId === undefined ? undefined : this.#toolCallById.get(params.toolCallId);
    const result = createToolResult(params, call, this.#nextSequence());
    if (this.#toolResults.length < MAX_DIAGNOSTIC_TOOL_RESULTS) this.#toolResults.push(result);
    this.#recordToolResultFailure(result, call, params.toolName);
  }

  recordOutputWrite(params: {
    key: string;
    value: string;
    result: {
      readonly ok: boolean;
      readonly idempotent?: boolean | undefined;
      readonly code?: string | undefined;
    };
  }): void {
    const status = outputWriteStatus(params.result);
    if (status === 'conflicting') this.markFailure('output_conflict');
    if (this.#outputWrites.length >= MAX_DIAGNOSTIC_OUTPUT_WRITES) return;
    this.#outputWrites.push({
      sequence: this.#nextSequence(),
      key: params.key,
      status,
      valueFingerprint: stableDiagnosticFingerprint(params.value),
      ...(params.result.code === undefined ? {} : {code: params.result.code}),
    });
  }

  recordCatalogFailure(failure: AgentSessionCatalogFailure): void {
    if (
      !this.#catalogFailures.some(
        (candidate) =>
          candidate.server === failure.server && candidate.errorClass === failure.errorClass,
      ) &&
      this.#catalogFailures.length < MAX_DIAGNOSTIC_CATALOG_FAILURES
    ) {
      this.#catalogFailures.push(normalizeCatalogFailure(failure));
    }
    this.markFailure('integration_tool_catalog_unavailable');
  }

  recordTurnStart(): void {
    this.#turnsConsumed += 1;
  }

  recordUsage(usage: unknown): void {
    if (!isRecord(usage)) return;
    const total = firstFiniteNumber(usage, ['total_tokens', 'totalTokens', 'total']);
    if (total !== undefined) {
      this.#tokensConsumed += total;
      return;
    }
    this.#tokensConsumed +=
      (firstFiniteNumber(usage, ['input_tokens', 'inputTokens', 'input']) ?? 0) +
      (firstFiniteNumber(usage, ['output_tokens', 'outputTokens', 'output']) ?? 0);
  }

  markFailure(failureClass: AgentSessionFailureClass): void {
    if (
      !this.#failureClasses.includes(failureClass) &&
      this.#failureClasses.length < MAX_DIAGNOSTIC_FAILURE_CLASSES
    ) {
      this.#failureClasses.push(failureClass);
    }
  }

  finish(reason: AgentSessionTerminationReason, failureClass?: AgentSessionFailureClass): void {
    if (failureClass !== undefined) this.markFailure(failureClass);
    if (this.#terminationReason !== undefined) return;
    this.#terminationReason = reason;
    this.#terminationFailureClass =
      failureClass ?? (isFailureClass(reason) ? reason : this.#failureClasses[0]);
  }

  snapshot(): AgentSessionDiagnosticEntry {
    const terminationReason = this.#terminationReason ?? 'error';
    return {
      kind: 'agent_session_diagnostics',
      version: AGENT_SESSION_DIAGNOSTICS_VERSION,
      harness: this.#harness,
      provider: this.#provider,
      model: this.#model,
      ...(this.#sessionId === undefined ? {} : {sessionId: this.#sessionId}),
      registration: this.#registration,
      providerTools: this.#providerTools,
      catalogFailures: [...this.#catalogFailures],
      toolCalls: [...this.#toolCalls],
      toolResults: [...this.#toolResults],
      outputWrites: [...this.#outputWrites],
      failureClasses: [...this.#failureClasses],
      termination: {
        reason: terminationReason,
        ...(this.#terminationFailureClass === undefined
          ? {}
          : {failureClass: this.#terminationFailureClass}),
      },
      budgets: {
        turns: budget(this.#turnsConsumed),
        toolCalls: budget(this.#toolCallsConsumed),
        timeMs: budget(Math.max(0, Date.now() - this.#startedAt)),
        tokens: budget(this.#tokensConsumed),
      },
    };
  }

  storeEntry(): AgentSessionDiagnosticStoreEntry {
    return {
      type: AGENT_SESSION_DIAGNOSTICS_ENTRY_TYPE,
      uuid: this.#entryUuid,
      data: this.snapshot(),
    };
  }

  #nextSequence(): number {
    const sequence = this.#sequence;
    this.#sequence += 1;
    return sequence;
  }

  #recordToolResultFailure(
    result: AgentSessionToolResult,
    call: AgentSessionToolCall | undefined,
    toolName: string | undefined,
  ): void {
    if (result.error?.code === 'output_conflict') this.markFailure('output_conflict');
    if (!result.isError) return;
    const repetitionKey = [
      call?.toolName ?? toolName ?? 'unknown',
      call?.argsFingerprint ?? 'unknown',
      result.resultFingerprint,
    ].join(':');
    const repetitions = (this.#repeatedFailures.get(repetitionKey) ?? 0) + 1;
    this.#repeatedFailures.set(repetitionKey, repetitions);
    if (repetitions >= MAX_REPEATED_TOOL_FAILURES) {
      this.markFailure('agent_tool_loop_detected');
    }
  }
}

function createToolResult(
  params: RecordToolResultParams,
  call: AgentSessionToolCall | undefined,
  sequence: number,
): AgentSessionToolResult {
  const outputFailure = isOutputFailure(params.details);
  const error = stableToolErrorDetails(
    {
      details: params.details,
      structuredContent: params.structuredContent,
    },
    params.isError || outputFailure,
  );
  const isError = params.isError || outputFailure || error !== undefined;
  const structuredResult = structuredResultForFingerprint(
    params.structuredContent ?? params.details,
  );
  return {
    sequence,
    ...(params.toolCallId === undefined ? {} : {toolCallId: params.toolCallId}),
    ...(params.toolName === undefined && call === undefined
      ? {}
      : {toolName: params.toolName ?? call?.toolName}),
    isError,
    resultFingerprint: stableDiagnosticFingerprint({isError, error, structuredResult}),
    ...(structuredResult === undefined
      ? {}
      : {structuredResultFingerprint: stableDiagnosticFingerprint(structuredResult)}),
    ...(error === undefined ? {} : {error}),
  };
}

function outputWriteStatus(result: {
  readonly ok: boolean;
  readonly idempotent?: boolean | undefined;
  readonly code?: string | undefined;
}): AgentSessionOutputWriteStatus {
  if (!result.ok) return result.code === 'output_conflict' ? 'conflicting' : 'rejected';
  return result.idempotent === true ? 'idempotent' : 'accepted';
}

export function stableDiagnosticFingerprint(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

/**
 * Extract only the bounded, machine-readable portion of a tool failure. In
 * particular, provider prose and result payloads never become an error label.
 */
export function stableToolErrorDetails(
  value: unknown,
  allowUnrecognizedCode = false,
): AgentToolErrorDetails | undefined {
  const seen = new WeakSet<object>();
  for (const record of recordCandidates(value)) {
    const error = stableToolErrorForRecord(record, allowUnrecognizedCode, seen);
    if (error !== undefined) return error;
  }
  return undefined;
}

function stableToolErrorForRecord(
  record: Record<string, unknown>,
  allowUnrecognizedCode: boolean,
  seen: WeakSet<object>,
): AgentToolErrorDetails | undefined {
  if (seen.has(record)) return undefined;
  seen.add(record);
  const code = stringField(record, 'code');
  if (
    code !== undefined &&
    (allowUnrecognizedCode ||
      STABLE_ERROR_CODES.has(code) ||
      stringField(record, 'reason') !== undefined)
  ) {
    return {
      code,
      ...optionalStringField('reason', record.reason),
      ...optionalStringField('tool', record.tool),
      ...optionalStringField('parameter', record.parameter),
      ...optionalStatusField(record.status),
    };
  }
  if (isRecord(record.structuredContent)) {
    const nested = stableToolErrorForRecord(record.structuredContent, allowUnrecognizedCode, seen);
    if (nested !== undefined) return nested;
  }
  if (isRecord(record.mcpResult)) {
    const nested = stableToolErrorForRecord(record.mcpResult, allowUnrecognizedCode, seen);
    if (nested !== undefined) return nested;
  }
  if (isRecord(record.details)) {
    const nested = stableToolErrorForRecord(record.details, allowUnrecognizedCode, seen);
    if (nested !== undefined) return nested;
  }
  const adapterError = stringField(record, 'error');
  if (adapterError === undefined) return undefined;
  return adapterToolError(adapterError, record);
}

function adapterToolError(
  adapterError: string,
  record: Record<string, unknown>,
): AgentToolErrorDetails {
  if (adapterError === 'tool_not_found' || adapterError === 'tool_not_found_after_reconnect') {
    return {
      code: 'invalid-request',
      reason: 'tool_not_found',
      ...optionalStringField('tool', record.requestedTool),
    };
  }
  if (adapterError === 'tool_error' || adapterError === 'call_failed') {
    return {code: 'tool_error', reason: 'provider_error'};
  }
  return {code: 'tool_error', reason: adapterError};
}

function diagnosticEntryUuid(params: AgentSessionDiagnosticsParams): string {
  return [
    AGENT_SESSION_DIAGNOSTICS_ENTRY_TYPE,
    params.harness,
    params.invocation.jobExecutionId ?? 'unknown',
    params.invocation.stepId ?? 'unknown',
    String(params.invocation.attempt ?? 0),
  ].join(':');
}

function normalizeToolDescriptor(tool: AgentSessionToolDescriptor): AgentSessionToolDescriptor {
  return {
    name: tool.name,
    ...(tool.description === undefined ? {} : {description: tool.description}),
    inputSchema: normalizeDiagnosticValue(tool.inputSchema),
    ...(tool.outputSchema === undefined
      ? {}
      : {outputSchema: normalizeDiagnosticValue(tool.outputSchema)}),
  };
}

function normalizeCatalogFailure(failure: AgentSessionCatalogFailure): AgentSessionCatalogFailure {
  return {
    server: failure.server,
    errorClass: failure.errorClass,
    ...(failure.status === undefined ? {} : {status: failure.status}),
  };
}

function budget(consumed: number): AgentSessionBudget {
  return {consumed: Math.max(0, Math.floor(consumed)), remaining: null};
}

function structuredResultForFingerprint(value: unknown): unknown {
  if (!isRecord(value)) return undefined;
  const structuredContent = value.structuredContent;
  if (structuredContent !== undefined) return normalizeDiagnosticValue(structuredContent);
  const mcpResult = value.mcpResult;
  if (isRecord(mcpResult) && mcpResult.structuredContent !== undefined) {
    return normalizeDiagnosticValue(mcpResult.structuredContent);
  }
  if (value.ok === false && isRecord(value.details)) {
    return normalizeDiagnosticValue(value.details);
  }
  return undefined;
}

function isOutputFailure(value: unknown): boolean {
  return isRecord(value) && value.ok === false;
}

function recordCandidates(value: unknown): readonly Record<string, unknown>[] {
  if (!isRecord(value)) return [];
  const candidates: Record<string, unknown>[] = [value];
  if (isRecord(value.details)) candidates.push(value.details);
  if (isRecord(value.structuredContent)) candidates.push(value.structuredContent);
  if (isRecord(value.mcpResult)) {
    candidates.push(value.mcpResult);
    if (isRecord(value.mcpResult.structuredContent)) {
      candidates.push(value.mcpResult.structuredContent);
    }
    if (isRecord(value.mcpResult.details)) candidates.push(value.mcpResult.details);
  }
  return candidates;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalStringField(key: string, value: unknown): Record<string, string> {
  return typeof value === 'string' && value.length > 0 ? {[key]: value} : {};
}

function optionalStatusField(value: unknown): Record<string, number> {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? {status: value}
    : {};
}

function firstFiniteNumber(
  record: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

function isFailureClass(value: AgentSessionTerminationReason): value is AgentSessionFailureClass {
  return value !== 'completed' && value !== 'aborted' && value !== 'error';
}

/** Sort object keys while preserving arrays and exact scalar argument values. */
export function normalizeDiagnosticValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizeDiagnosticValue(item, seen));
    seen.delete(value);
    return normalized;
  }
  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    normalized[key] = normalizeDiagnosticValue(record[key], seen);
  }
  seen.delete(value);
  return normalized;
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(normalizeDiagnosticValue(value)) ?? 'undefined';
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
