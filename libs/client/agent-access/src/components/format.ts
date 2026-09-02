import {formatTimestamp} from '@shipfox/react-ui/utils';

export function formatAgentAccessDate(value: string | null): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat(undefined, {dateStyle: 'medium'}).format(new Date(value));
}

export function formatAgentAccessTimestamp(value: string | null): string | undefined {
  if (!value) return undefined;
  return formatTimestamp(value);
}
