export interface SessionViewRowMeta {
  label: string;
  value: string;
  inline?: boolean | undefined;
}

export type SessionViewRow =
  | {
      kind: 'message';
      timestamp: number;
      role: string;
      label: string;
      meta: readonly SessionViewRowMeta[];
      text: string;
      terminalFailure: boolean;
    }
  | {kind: 'thinking'; timestamp: number; text: string}
  | {
      kind: 'tool-call';
      timestamp: number;
      id: string | null;
      name: string;
      input: string;
      summary?: string | undefined;
    }
  | {
      kind: 'tool-result';
      timestamp: number;
      toolCallId: string | null;
      toolName: string;
      output: string;
      isError: boolean;
    }
  | {
      kind: 'lifecycle';
      timestamp: number;
      label: string;
      detail: string | null;
      meta: readonly SessionViewRowMeta[];
      tone: 'default' | 'warning' | 'error';
      terminalFailure: boolean;
    }
  | {kind: 'raw'; timestamp: number; label: string; raw: string};

interface LogRecordBase {
  v: 1;
  ts: number;
}

export type LogRecord =
  | (LogRecordBase & {type: 'output'; stream: 'stdout' | 'stderr'; data: string})
  | (LogRecordBase & {
      type: 'group_start';
      groupId: string;
      parentGroupId: string | null;
      name: string;
    })
  | (LogRecordBase & {type: 'group_end'; groupId: string})
  | (LogRecordBase & {type: 'end'; totalBytes: number})
  | (LogRecordBase & {type: 'gap'; droppedBytes: number})
  | (LogRecordBase & {type: 'agent_session'; row: SessionViewRow})
  | (LogRecordBase & {type: 'capped'})
  | (LogRecordBase & {type: 'runner_lost'});

export type LogSource = 'inline' | 'presigned';
export type LogState = 'open' | 'closed' | 'compacted';

export interface InlineLogRead {
  mode: 'inline';
  ndjson: string;
  nextCursor: number;
  hasMore: boolean;
  state: 'open' | 'closed';
  truncated: boolean;
}

export interface PresignedLogRead {
  mode: 'presigned';
  url: string;
  expiresAt: string;
  totalBytes: number;
  truncated: boolean;
}
