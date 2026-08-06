import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockFiles,
  CodeBlockHeader,
  CodeBlockItem,
  CodeTabs,
} from '@shipfox/react-ui/code-block';
import {Text} from '@shipfox/react-ui/typography';
import {useState} from 'react';

export interface JsonCodeEntry {
  filename: string;
  label?: string | undefined;
  value: unknown;
}

export function JsonCode({
  title,
  value,
  emptyMessage,
}: {
  title?: string | undefined;
  value: unknown;
  emptyMessage?: string | undefined;
}) {
  const filename = title ?? 'value.json';

  return (
    <div className="flex min-w-0 flex-col gap-tight">
      {title ? (
        <Text size="xs" className="text-foreground-neutral-muted">
          {title}
        </Text>
      ) : null}
      {emptyMessage && isEmptyObject(value) ? (
        <Text size="xs" className="text-foreground-neutral-muted">
          {emptyMessage}
        </Text>
      ) : (
        <JsonCodeBlock entries={[{filename, value}]} />
      )}
    </div>
  );
}

export function JsonCodeTabs({entries}: {entries: readonly JsonCodeEntry[]}) {
  const entryKeys = entries.map((entry) => entry.label ?? entry.filename);
  const [activeKey, setActiveKey] = useState(entryKeys[0] ?? '');
  const activeValue = entryKeys.includes(activeKey) ? activeKey : (entryKeys[0] ?? '');
  const codes = Object.fromEntries(
    entries.map((entry) => [entry.label ?? entry.filename, stringifyJson(entry.value)]),
  );

  return (
    <CodeTabs
      value={activeValue}
      onValueChange={setActiveKey}
      codes={codes}
      lang="json"
      syntaxHighlighting={false}
      className="h-auto min-h-0 rounded-8 bg-background-contrast-base shadow-button-neutral"
    />
  );
}

function JsonCodeBlock({entries}: {entries: readonly JsonCodeEntry[]}) {
  const data = entries.map((entry) => ({
    filename: entry.filename,
    language: 'json',
    code: stringifyJson(entry.value),
  }));

  return (
    <CodeBlock
      data={data}
      className="h-auto min-h-0 rounded-6 bg-background-contrast-base shadow-button-neutral"
    >
      <CodeBlockHeader className="bg-background-contrast-base p-tight">
        <CodeBlockFiles>
          {(item) => {
            const entry = entries.find((candidate) => candidate.filename === item.filename);
            return (
              <CodeBlockFilename value={item.filename}>
                {entry?.label ?? item.filename}
              </CodeBlockFilename>
            );
          }}
        </CodeBlockFiles>
        <CodeBlockCopyButton />
      </CodeBlockHeader>
      <CodeBlockBody>
        {(item) => (
          <CodeBlockItem value={item.filename}>
            <CodeBlockContent language="json" syntaxHighlighting={false}>
              {item.code}
            </CodeBlockContent>
          </CodeBlockItem>
        )}
      </CodeBlockBody>
    </CodeBlock>
  );
}

function isEmptyObject(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

function stringifyJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  return serialized === undefined ? String(value) : serialized;
}
