/**
 * A workflow definition listed at a git ref by `GET /definitions/at-ref`,
 * with its validation state and the commit the ref resolved to. The picker
 * on the run-from-branch dialog reads from this listing; the pinned commit is
 * submitted with the dev run so the server can answer `ref-moved` when the
 * ref moved on.
 */
export interface DefinitionAtRefDiagnostic {
  message: string;
  path?: string | undefined;
}

export interface DefinitionAtRefWarning {
  code: string;
  message: string;
  path?: string | undefined;
}

/** A trigger declared by the workflow file at the ref, as the picker shows it. */
export interface DefinitionAtRefTrigger {
  source: string;
  event?: string | undefined;
  with?: Record<string, unknown> | undefined;
  filter?: string | undefined;
  config?: Record<string, unknown> | undefined;
}

export interface DefinitionAtRefFile {
  configPath: string;
  name: string | null;
  valid: boolean;
  errors: DefinitionAtRefDiagnostic[];
  warnings: DefinitionAtRefWarning[];
  triggers: Record<string, DefinitionAtRefTrigger>;
}

export interface DefinitionAtRefListing {
  ref: string;
  commit: string;
  files: DefinitionAtRefFile[];
}
