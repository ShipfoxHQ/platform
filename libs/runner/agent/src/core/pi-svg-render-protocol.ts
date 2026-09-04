export type SvgRenderWorkerFailureReason =
  | 'external_resource'
  | 'output_too_large'
  | 'render_error'
  | 'unsafe_svg'
  | 'protocol_failure';

export type SvgRenderWorkerRequest = {
  type: 'render';
  requestId: number;
  svg: ArrayBuffer;
};

export type SvgRenderWorkerStartupResponse = {type: 'ready'} | {type: 'initialization_failed'};

export type SvgRenderWorkerRenderResponse =
  | {type: 'rendered'; requestId: number; png: ArrayBuffer}
  | {type: 'failed'; requestId: number; reason: SvgRenderWorkerFailureReason};

export type SvgRenderWorkerResponse =
  | SvgRenderWorkerStartupResponse
  | SvgRenderWorkerRenderResponse;
