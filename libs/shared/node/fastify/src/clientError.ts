export interface ClientErrorParams {
  data?: unknown;
  details?: unknown;
  status?: number;
  cause?: unknown;
}

export class ClientError extends Error {
  /** Error code returned to the client */
  code: string;
  /** Data to log, not returned to the client */
  data?: unknown;
  /** Safe structured details returned to the client */
  details?: unknown;
  /** HTTP status code (default: 400) */
  status?: number;

  constructor(message: string, code: string, params: ClientErrorParams = {}) {
    super(message, {cause: params.cause});
    this.code = code;
    this.data = params.data;
    this.details = params.details;
    if (params.status !== undefined) {
      this.status = params.status;
    }
  }
}
