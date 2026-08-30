import type {ApiDatabaseRegistry, DatabaseMigrationUnit} from './api-database-registry.js';

export type CatalogObjectKind =
  | 'constraint'
  | 'enum'
  | 'index'
  | 'migration-history'
  | 'schema'
  | 'sequence'
  | 'table'
  | 'trigger'
  | 'view';

export type CatalogFindingClassification = 'cross-owner' | 'misnamed' | 'missing' | 'unknown';

export type CatalogObjectClassification = 'compliant' | CatalogFindingClassification;

export interface ExpectedRelationReference {
  schemaName: string;
  name: string;
}

export interface ExpectedCatalogObject {
  kind: Exclude<CatalogObjectKind, 'migration-history' | 'schema'>;
  schemaName: string;
  name: string;
  ownerId: string;
  migrationUnitId: string;
  namespace: string;
  relationName?: string;
  relationSchemaName?: string;
  referencedRelations?: readonly ExpectedRelationReference[];
  sourcePath: string;
  line: number;
}

export interface ExpectedMigrationHistory {
  kind: 'migration-history';
  schemaName: 'drizzle';
  name: string;
  runtimeName: string;
  ownerId: string;
  migrationUnitId: string;
  namespace: string;
  sourcePath: string;
  line: number;
}

export interface CatalogNamespace {
  oid: string;
  name: string;
}

export interface CatalogRelation {
  oid: string;
  schemaName: string;
  name: string;
  relkind: string;
  relationOid?: string | null;
}

export interface CatalogEnum {
  oid: string;
  schemaName: string;
  name: string;
}

export interface CatalogConstraint {
  oid: string;
  schemaName: string;
  name: string;
  type: string;
  relationOid: string | null;
  relationSchemaName: string | null;
  relationName: string | null;
  referencedRelationOid: string | null;
  referencedRelationSchemaName: string | null;
  referencedRelationName: string | null;
}

export interface CatalogTrigger {
  oid: string;
  schemaName: string;
  name: string;
  relationOid: string;
  relationName: string;
}

export interface PostgresCatalog {
  namespaces: readonly CatalogNamespace[];
  relations: readonly CatalogRelation[];
  enums: readonly CatalogEnum[];
  constraints: readonly CatalogConstraint[];
  triggers: readonly CatalogTrigger[];
}

export interface CatalogMigrationUnitReport {
  id: string;
  ownerId: string;
  namespace: string;
  migrations: number;
  runtimeMigrationHistoryName: string;
  canonicalMigrationHistoryName: string;
}

export interface CatalogObjectReport {
  classification: CatalogObjectClassification;
  kind: CatalogObjectKind;
  schemaName: string;
  name: string;
  ownerId?: string;
  migrationUnitId?: string;
  namespace?: string;
  expectedName?: string;
  relationName?: string | null;
  referencedRelationName?: string | null;
  referencedOwnerId?: string;
  sourcePath?: string;
  line?: number;
}

export interface CatalogFinding {
  classification: CatalogFindingClassification;
  kind: CatalogObjectKind;
  schemaName: string;
  name: string;
  ownerId?: string;
  migrationUnitId?: string;
  namespace?: string;
  expectedName?: string;
  referencedOwnerId?: string;
  sourcePath?: string;
  line?: number;
  message: string;
}

export interface CatalogReportCounts {
  compliant: number;
  constraints: number;
  enums: number;
  indexes: number;
  migrationHistories: number;
  schemas: number;
  sequences: number;
  tables: number;
  triggers: number;
  unknown: number;
  views: number;
}

export interface CatalogAuditReport {
  databaseName?: string;
  serverVersion?: string;
  migrationUnits: readonly CatalogMigrationUnitReport[];
  objects: readonly CatalogObjectReport[];
  findings: readonly CatalogFinding[];
  counts: CatalogReportCounts;
}

interface ParsedIdentifier {
  schemaName?: string;
  name: string;
  end: number;
}

interface ParsedTableRange {
  start: number;
  end: number;
  schemaName: string;
  name: string;
}

interface ParsedMigrationStatement {
  operation: 'create' | 'drop';
  kind: Exclude<CatalogObjectKind, 'migration-history' | 'schema'> | 'type';
  name: ParsedIdentifier;
  relationName?: string;
  relationSchemaName?: string;
  referencedRelations?: ExpectedRelationReference[];
  cascade?: boolean;
  start: number;
}

export interface ParsedMigrationChange {
  operation: 'create' | 'drop';
  cascade?: boolean;
  object: ExpectedCatalogObject;
}

const identifierStartExpression = /[A-Za-z_]/;
const identifierPartExpression = /[A-Za-z0-9_$]/;
const dollarQuoteTagStartExpression = /[A-Za-z_]/;
const dollarQuoteTagPartExpression = /[A-Za-z0-9_]/;
const enumExpression = /\bAS\s+ENUM\b/i;
const ifNotExistsExpression = /^IF\s+NOT\s+EXISTS\b/i;
const ifExistsExpression = /^IF\s+EXISTS\b/i;
const concurrentlyExpression = /^CONCURRENTLY\b/i;
const dropConstraintExpression = /\bDROP\s+CONSTRAINT\b/i;
const cascadeExpression = /\bCASCADE\b/i;
const fromClauseBoundaryExpression =
  /^(?:JOIN|WHERE|GROUP|ORDER|LIMIT|OFFSET|UNION|INTERSECT|EXCEPT|FETCH|FOR|HAVING|WINDOW)\b/i;
const fromOnlyExpression = /^ONLY\b/i;
const whitespaceExpression = /\s/;
const postgresIdentifierLimit = 63;

function postgresIdentifierName(name: string): string {
  if (Buffer.byteLength(name, 'utf8') <= postgresIdentifierLimit) return name;
  let end = name.length;
  while (end > 0 && Buffer.byteLength(name.slice(0, end), 'utf8') > postgresIdentifierLimit) {
    end -= 1;
  }
  return name.slice(0, end);
}

function skipWhitespace(source: string, offset: number): number {
  let cursor = offset;
  while (cursor < source.length && whitespaceExpression.test(source[cursor] ?? '')) cursor += 1;
  return cursor;
}

function readIdentifier(source: string, offset: number): ParsedIdentifier | undefined {
  let cursor = skipWhitespace(source, offset);
  const first = source[cursor];
  if (first === '"') {
    cursor += 1;
    let value = '';
    while (cursor < source.length) {
      const character = source[cursor];
      if (character === '"') {
        if (source[cursor + 1] === '"') {
          value += '"';
          cursor += 2;
          continue;
        }
        return {name: value, end: cursor + 1};
      }
      value += character;
      cursor += 1;
    }
    return undefined;
  }

  if (!first || !identifierStartExpression.test(first)) return undefined;
  const start = cursor;
  cursor += 1;
  while (cursor < source.length && identifierPartExpression.test(source[cursor] ?? '')) {
    cursor += 1;
  }
  return {name: source.slice(start, cursor), end: cursor};
}

function readQualifiedIdentifier(source: string, offset: number): ParsedIdentifier | undefined {
  const first = readIdentifier(source, offset);
  if (!first) return undefined;
  const dotOffset = skipWhitespace(source, first.end);
  if (source[dotOffset] !== '.') return first;
  const second = readIdentifier(source, dotOffset + 1);
  if (!second) return first;
  return {schemaName: first.name, name: second.name, end: second.end};
}

function dollarQuoteDelimiterAt(source: string, offset: number): string | undefined {
  if (source[offset] !== '$') return undefined;
  if (source[offset + 1] === '$') return '$$';
  if (!dollarQuoteTagStartExpression.test(source[offset + 1] ?? '')) return undefined;
  let cursor = offset + 2;
  while (cursor < source.length && dollarQuoteTagPartExpression.test(source[cursor] ?? ''))
    cursor += 1;
  if (source[cursor] !== '$') return undefined;
  return source.slice(offset, cursor + 1);
}

function statementEnd(source: string, offset: number): number {
  let cursor = offset;
  while (cursor < source.length) {
    const scan = scanStatementCharacter(source, cursor);
    if (scan.statementEnd !== undefined) return scan.statementEnd;
    cursor = scan.nextCursor;
  }
  return source.length;
}

interface StatementScanResult {
  nextCursor: number;
  statementEnd?: number;
}

function scanStatementCharacter(source: string, cursor: number): StatementScanResult {
  const character = source[cursor];
  if (character === "'") return {nextCursor: quotedSqlEnd(source, cursor, "'", true)};
  if (character === '"') return {nextCursor: quotedSqlEnd(source, cursor, '"', false)};
  if (character === '-' && source[cursor + 1] === '-') {
    const lineEnd = source.indexOf('\n', cursor + 2);
    return {nextCursor: lineEnd === -1 ? source.length : lineEnd + 1};
  }
  if (character === '/' && source[cursor + 1] === '*') {
    const commentEnd = source.indexOf('*/', cursor + 2);
    return {nextCursor: commentEnd === -1 ? source.length : commentEnd + 2};
  }
  const delimiter = statementDollarQuoteDelimiter(source, cursor);
  if (delimiter) {
    const quoteEnd = source.indexOf(delimiter, cursor + delimiter.length);
    return {nextCursor: quoteEnd === -1 ? source.length : quoteEnd + delimiter.length};
  }
  if (character === ';') return {nextCursor: cursor, statementEnd: cursor};
  return {nextCursor: cursor + 1};
}

function statementDollarQuoteDelimiter(source: string, cursor: number): string | undefined {
  if (source[cursor] !== '$') return undefined;
  if (cursor > 0 && identifierPartExpression.test(source[cursor - 1] ?? '')) return undefined;
  return dollarQuoteDelimiterAt(source, cursor);
}

function quotedSqlEnd(
  source: string,
  start: number,
  quote: string,
  allowsBackslash: boolean,
): number {
  let cursor = start + 1;
  while (cursor < source.length) {
    if (allowsBackslash && source[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (source[cursor] !== quote) {
      cursor += 1;
      continue;
    }
    if (source[cursor + 1] === quote) {
      cursor += 2;
      continue;
    }
    return cursor + 1;
  }
  return source.length;
}

function blankCharacters(characters: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (characters[index] !== '\n' && characters[index] !== '\r') characters[index] = ' ';
  }
}

function maskSqlForStatements(source: string): string {
  const characters = source.split('');
  let cursor = 0;
  while (cursor < source.length) {
    const end = maskedSqlRegionEnd(source, cursor);
    if (end === undefined) {
      cursor += 1;
      continue;
    }
    blankCharacters(characters, cursor, end);
    cursor = end;
  }
  return characters.join('');
}

function maskedSqlRegionEnd(source: string, cursor: number): number | undefined {
  const character = source[cursor];
  if (character === '-' && source[cursor + 1] === '-') {
    const lineEnd = source.indexOf('\n', cursor + 2);
    return lineEnd === -1 ? source.length : lineEnd;
  }
  if (character === '/' && source[cursor + 1] === '*') {
    const commentEnd = source.indexOf('*/', cursor + 2);
    return commentEnd === -1 ? source.length : commentEnd + 2;
  }
  if (character === "'") return quotedSqlEnd(source, cursor, "'", true);
  if (character === '"') return quotedSqlEnd(source, cursor, '"', false);
  const delimiter = statementDollarQuoteDelimiter(source, cursor);
  if (!delimiter) return undefined;
  const quoteEnd = source.indexOf(delimiter, cursor + delimiter.length);
  return quoteEnd === -1 ? source.length : quoteEnd + delimiter.length;
}

function lineNumber(source: string, offset: number): number {
  let line = 1;
  for (let cursor = 0; cursor < offset; cursor += 1) {
    if (source[cursor] === '\n') line += 1;
  }
  return line;
}

function firstKeywordOffset(source: string, keyword: string, offset: number, end: number): number {
  const expression = new RegExp(`\\b${keyword}\\b`, 'i');
  const match = expression.exec(source.slice(offset, end));
  return match?.index === undefined ? -1 : offset + match.index;
}

function readRelationReferences(
  source: string,
  searchableSource: string,
  keyword: string,
  start: number,
  end: number,
): ExpectedRelationReference[] {
  if (keyword === 'FROM') {
    return readFromRelationReferences(source, searchableSource, start, end);
  }

  const references: ExpectedRelationReference[] = [];
  const searchableStatement = searchableSource.slice(start, end);
  const keywordExpression = new RegExp(`\\b${keyword}\\b`, 'gi');
  let match = keywordExpression.exec(searchableStatement);
  while (match) {
    const relation = readQualifiedIdentifier(source, start + (match.index ?? 0) + match[0].length);
    if (relation) {
      const reference = {
        schemaName: relation.schemaName ?? 'public',
        name: relation.name,
      };
      if (
        !references.some(
          (candidate) =>
            candidate.schemaName === reference.schemaName && candidate.name === reference.name,
        )
      ) {
        references.push(reference);
      }
    }
    match = keywordExpression.exec(searchableStatement);
  }
  return references;
}

function readFromRelationIdentifier(
  source: string,
  searchableSource: string,
  offset: number,
): ParsedIdentifier | undefined {
  const relationOffset = skipWhitespace(source, offset);
  const onlyMatch = fromOnlyExpression.exec(searchableSource.slice(relationOffset));
  if (!onlyMatch) return readQualifiedIdentifier(source, relationOffset);

  const onlyOffset = skipWhitespace(source, relationOffset + onlyMatch[0].length);
  const isParenthesized = source[onlyOffset] === '(';
  const relation = readQualifiedIdentifier(source, isParenthesized ? onlyOffset + 1 : onlyOffset);
  if (!relation || !isParenthesized) return relation;

  const closingOffset = skipWhitespace(source, relation.end);
  return source[closingOffset] === ')' ? {...relation, end: closingOffset + 1} : relation;
}

function readFromRelationReferences(
  source: string,
  searchableSource: string,
  start: number,
  end: number,
): ExpectedRelationReference[] {
  const references: ExpectedRelationReference[] = [];
  const searchableStatement = searchableSource.slice(start, end);
  const keywordExpression = /\bFROM\b/gi;
  let match = keywordExpression.exec(searchableStatement);
  while (match) {
    readFromClauseReferences(
      source,
      searchableSource,
      start + (match.index ?? 0) + match[0].length,
      end,
      references,
    );
    match = keywordExpression.exec(searchableStatement);
  }

  return references.filter(
    (reference, index) =>
      references.findIndex(
        (candidate) =>
          candidate.schemaName === reference.schemaName && candidate.name === reference.name,
      ) === index,
  );
}

function addRelationReference(
  references: ExpectedRelationReference[],
  relation: ParsedIdentifier,
): void {
  references.push({schemaName: relation.schemaName ?? 'public', name: relation.name});
}

function readFromClauseReferences(
  source: string,
  searchableSource: string,
  start: number,
  end: number,
  references: ExpectedRelationReference[],
): void {
  let cursor = start;
  let relation = readFromRelationIdentifier(source, searchableSource, cursor);
  if (!relation) return;
  addRelationReference(references, relation);
  cursor = relation.end;
  let separator = nextFromRelationSeparator(searchableSource, cursor, end);
  while (separator !== undefined) {
    relation = readFromRelationIdentifier(source, searchableSource, separator + 1);
    if (!relation) return;
    addRelationReference(references, relation);
    cursor = relation.end;
    separator = nextFromRelationSeparator(searchableSource, cursor, end);
  }
}

function nextFromRelationSeparator(source: string, start: number, end: number): number | undefined {
  let cursor = start;
  let parenthesisDepth = 0;
  while (cursor < end) {
    const character = source[cursor];
    if (character === '(') parenthesisDepth += 1;
    if (character === ')') {
      if (parenthesisDepth === 0) return undefined;
      parenthesisDepth -= 1;
    }
    if (parenthesisDepth === 0 && character === ',') return cursor;
    if (parenthesisDepth === 0 && fromClauseBoundaryExpression.test(source.slice(cursor))) {
      return undefined;
    }
    cursor += 1;
  }
  return undefined;
}

function addParsedStatement(
  statements: ParsedMigrationStatement[],
  source: string,
  match: RegExpExecArray,
  kind: ParsedMigrationStatement['kind'],
  operation: ParsedMigrationStatement['operation'] = 'create',
): ParsedMigrationStatement | undefined {
  let nameOffset = skipWhitespace(source, (match.index ?? 0) + match[0].length);
  if (operation === 'drop' && kind === 'index') {
    const concurrently = concurrentlyExpression.exec(source.slice(nameOffset));
    if (concurrently) nameOffset += concurrently[0].length;
  }
  const existsExpression = operation === 'drop' ? ifExistsExpression : ifNotExistsExpression;
  const afterIfExists = existsExpression.exec(source.slice(nameOffset));
  const parsedName = readQualifiedIdentifier(
    source,
    afterIfExists ? nameOffset + afterIfExists[0].length : nameOffset,
  );
  if (!parsedName) return undefined;
  const statement: ParsedMigrationStatement = {
    operation,
    kind,
    name: parsedName,
    start: match.index ?? 0,
  };
  statements.push(statement);
  return statement;
}

function parseMigrationStatements(source: string): ParsedMigrationStatement[] {
  const statements: ParsedMigrationStatement[] = [];
  const searchableSource = maskSqlForStatements(source);
  collectCreateStatements(source, searchableSource, statements);
  collectDropStatements(source, searchableSource, statements);
  const parsedConstraintOffsets = collectAlterTableConstraints(
    source,
    searchableSource,
    statements,
  );
  collectInlineConstraints(source, searchableSource, statements, parsedConstraintOffsets);
  attachConstraintReferences(source, searchableSource, statements);
  return statements;
}

function normalizedStatementKind(keyword: string): ParsedMigrationStatement['kind'] {
  if (keyword === 'materialized view') return 'view';
  if (keyword === 'foreign table') return 'table';
  return keyword as ParsedMigrationStatement['kind'];
}

function attachStatementRelation(
  source: string,
  searchableSource: string,
  statement: ParsedMigrationStatement,
  end: number,
): void {
  const onOffset = firstKeywordOffset(searchableSource, 'ON', statement.name.end, end);
  if (onOffset === -1) return;
  const relation = readQualifiedIdentifier(source, onOffset + 2);
  if (!relation) return;
  statement.relationName = relation.name;
  if (relation.schemaName) statement.relationSchemaName = relation.schemaName;
}

function collectCreateStatements(
  source: string,
  searchableSource: string,
  statements: ParsedMigrationStatement[],
): void {
  const createExpression =
    /\bCREATE\s+(?:(?:OR\s+REPLACE|UNIQUE|CONCURRENTLY)\s+)*(MATERIALIZED\s+VIEW|FOREIGN\s+TABLE|TABLE|TYPE|INDEX|SEQUENCE|VIEW|TRIGGER)\b/gi;
  let match = createExpression.exec(searchableSource);
  while (match) {
    const createMatch = match;
    match = createExpression.exec(searchableSource);
    const keyword = createMatch[1]?.toLowerCase();
    if (!keyword) continue;
    const kind = normalizedStatementKind(keyword);
    const statement = addParsedStatement(statements, source, createMatch, kind);
    if (!statement) continue;
    const end = statementEnd(source, statement.name.end);
    if (kind === 'view') {
      const references = [
        ...readRelationReferences(source, searchableSource, 'FROM', statement.name.end, end),
        ...readRelationReferences(source, searchableSource, 'JOIN', statement.name.end, end),
      ];
      if (references.length > 0) statement.referencedRelations = references;
    } else if (kind === 'index' || kind === 'trigger') {
      attachStatementRelation(source, searchableSource, statement, end);
    }
  }
}

function collectDropStatements(
  source: string,
  searchableSource: string,
  statements: ParsedMigrationStatement[],
): void {
  const dropExpression =
    /\bDROP\s+((?:MATERIALIZED\s+VIEW|FOREIGN\s+TABLE|TABLE|TYPE|INDEX|SEQUENCE|VIEW|TRIGGER))\b/gi;
  let match = dropExpression.exec(searchableSource);
  while (match) {
    const dropMatch = match;
    match = dropExpression.exec(searchableSource);
    const keyword = dropMatch[1]?.toLowerCase();
    if (!keyword) continue;
    const kind = normalizedStatementKind(keyword);
    const statement = addParsedStatement(statements, source, dropMatch, kind, 'drop');
    if (!statement) continue;
    const end = statementEnd(source, statement.name.end);
    if (statement.operation === 'drop' && kind === 'table') {
      statement.cascade = cascadeExpression.test(searchableSource.slice(statement.name.end, end));
    }
    if (kind === 'trigger') {
      attachStatementRelation(source, searchableSource, statement, end);
    }
  }
}

function collectAlterTableConstraints(
  source: string,
  searchableSource: string,
  statements: ParsedMigrationStatement[],
): Set<number> {
  const alterExpression = /\bALTER\s+TABLE\b/gi;
  const parsedConstraintOffsets = new Set<number>();
  let match = alterExpression.exec(searchableSource);
  while (match) {
    const alterMatch = match;
    match = alterExpression.exec(searchableSource);
    const constraintOffset = collectAlterTableConstraint(
      source,
      searchableSource,
      statements,
      alterMatch,
    );
    if (constraintOffset !== undefined) parsedConstraintOffsets.add(constraintOffset);
  }
  return parsedConstraintOffsets;
}

function collectAlterTableConstraint(
  source: string,
  searchableSource: string,
  statements: ParsedMigrationStatement[],
  alterMatch: RegExpExecArray,
): number | undefined {
  const tableOffset = skipWhitespace(source, (alterMatch.index ?? 0) + alterMatch[0].length);
  const afterIfExists = ifExistsExpression.exec(searchableSource.slice(tableOffset));
  const table = readQualifiedIdentifier(
    source,
    afterIfExists ? tableOffset + afterIfExists[0].length : tableOffset,
  );
  if (!table) return undefined;
  const end = statementEnd(source, table.end);
  const constraintOffset = firstKeywordOffset(searchableSource, 'CONSTRAINT', table.end, end);
  if (constraintOffset === -1) return undefined;
  const isDroppingConstraint = dropConstraintExpression.test(
    searchableSource.slice(table.end, end),
  );
  const constraintNameOffset = skipWhitespace(source, constraintOffset + 'CONSTRAINT'.length);
  const afterConstraintIfExists = isDroppingConstraint
    ? ifExistsExpression.exec(searchableSource.slice(constraintNameOffset))
    : undefined;
  const constraint = readIdentifier(
    source,
    afterConstraintIfExists
      ? constraintNameOffset + afterConstraintIfExists[0].length
      : constraintNameOffset,
  );
  if (!constraint) return undefined;
  const operation: ParsedMigrationStatement['operation'] = isDroppingConstraint ? 'drop' : 'create';
  statements.push({
    operation,
    kind: 'constraint',
    name: constraint,
    relationName: table.name,
    ...(table.schemaName ? {relationSchemaName: table.schemaName} : {}),
    start: alterMatch.index ?? 0,
  });
  return constraintOffset;
}

function collectInlineConstraints(
  source: string,
  searchableSource: string,
  statements: ParsedMigrationStatement[],
  parsedConstraintOffsets: ReadonlySet<number>,
): void {
  const tableRanges: ParsedTableRange[] = statements
    .filter((statement) => statement.kind === 'table')
    .map((statement) => ({
      start: statement.start,
      end: statementEnd(source, statement.name.end),
      schemaName: statement.name.schemaName ?? 'public',
      name: statement.name.name,
    }));
  const constraintExpression = /\bCONSTRAINT\b/gi;
  let match = constraintExpression.exec(searchableSource);
  while (match) {
    const constraintMatch = match;
    match = constraintExpression.exec(searchableSource);
    if (parsedConstraintOffsets.has(constraintMatch.index ?? 0)) continue;
    const name = readIdentifier(source, (constraintMatch.index ?? 0) + constraintMatch[0].length);
    if (!name) continue;
    const range = tableRanges.find(
      (candidate) =>
        (constraintMatch.index ?? 0) >= candidate.start &&
        (constraintMatch.index ?? 0) <= candidate.end,
    );
    statements.push({
      operation: 'create',
      kind: 'constraint',
      name,
      ...(range?.name ? {relationName: range.name} : {}),
      ...(range?.schemaName ? {relationSchemaName: range.schemaName} : {}),
      start: constraintMatch.index ?? 0,
    });
  }
}

function attachConstraintReferences(
  source: string,
  searchableSource: string,
  statements: ParsedMigrationStatement[],
): void {
  for (const statement of statements) {
    if (statement.kind !== 'constraint') continue;
    const statementEndOffset = statementEnd(source, statement.name.end);
    const nextConstraintOffset = firstKeywordOffset(
      searchableSource,
      'CONSTRAINT',
      statement.name.end,
      statementEndOffset,
    );
    const end = nextConstraintOffset === -1 ? statementEndOffset : nextConstraintOffset;
    const references = readRelationReferences(
      source,
      searchableSource,
      'REFERENCES',
      statement.name.end,
      end,
    );
    if (references.length > 0) statement.referencedRelations = references;
  }
}

export function parseMigrationSql({
  source,
  sourcePath,
  unit,
}: {
  source: string;
  sourcePath: string;
  unit: DatabaseMigrationUnit;
}): ExpectedCatalogObject[] {
  return migrationChangesForSource({source, sourcePath, unit})
    .filter((change) => change.operation === 'create')
    .map(({object}) => object);
}

export function parseMigrationChanges({
  source,
  sourcePath,
  unit,
}: {
  source: string;
  sourcePath: string;
  unit: DatabaseMigrationUnit;
}): ParsedMigrationChange[] {
  return migrationChangesForSource({source, sourcePath, unit, sortBySourcePosition: true});
}

function migrationChangesForSource({
  source,
  sourcePath,
  unit,
  sortBySourcePosition = false,
}: {
  source: string;
  sourcePath: string;
  unit: DatabaseMigrationUnit;
  sortBySourcePosition?: boolean;
}): ParsedMigrationChange[] {
  const searchableSource = maskSqlForStatements(source);
  const statements = parseMigrationStatements(source);
  if (sortBySourcePosition) statements.sort((left, right) => left.start - right.start);
  return statements.flatMap((statement) =>
    migrationChangeForStatement(statement, source, searchableSource, sourcePath, unit),
  );
}

function migrationChangeForStatement(
  statement: ParsedMigrationStatement,
  source: string,
  searchableSource: string,
  sourcePath: string,
  unit: DatabaseMigrationUnit,
): ParsedMigrationChange[] {
  if (statement.kind === 'type') {
    const end = statementEnd(source, statement.name.end);
    const statementText = searchableSource.slice(statement.name.end, end);
    if (statement.operation === 'create' && !enumExpression.test(statementText)) return [];
  }
  const kind = statement.kind === 'type' ? 'enum' : statement.kind;
  const object: ExpectedCatalogObject = {
    kind,
    schemaName: statement.name.schemaName ?? 'public',
    name: statement.name.name,
    ownerId: unit.ownerId,
    migrationUnitId: unit.id,
    namespace: unit.namespace,
    sourcePath,
    line: lineNumber(source, statement.start),
  };
  if (statement.relationName) object.relationName = statement.relationName;
  if (statement.relationSchemaName) object.relationSchemaName = statement.relationSchemaName;
  if (statement.referencedRelations) object.referencedRelations = statement.referencedRelations;
  const change: ParsedMigrationChange = {operation: statement.operation, object};
  if (statement.cascade) change.cascade = true;
  return [change];
}

export function expectedObjectsAfterMigrations(
  changes: readonly ParsedMigrationChange[],
): ExpectedCatalogObject[] {
  const activeObjects = new Map<string, ExpectedCatalogObject>();
  for (const change of changes) {
    const {object} = change;
    const key = objectKey(object.kind, object.schemaName, object.name);
    if (change.operation === 'create') {
      activeObjects.set(key, object);
      continue;
    }

    activeObjects.delete(key);
    if (object.kind !== 'table' && object.kind !== 'view') continue;
    removeDependentObjects(activeObjects, object, change.cascade === true);
  }
  return dedupeExpectedObjects([...activeObjects.values()]);
}

function removeDependentObjects(
  activeObjects: Map<string, ExpectedCatalogObject>,
  droppedObject: ExpectedCatalogObject,
  cascade: boolean,
): void {
  const pendingRelations: ExpectedRelationReference[] = [
    {schemaName: droppedObject.schemaName, name: droppedObject.name},
  ];
  for (const droppedRelation of pendingRelations) {
    for (const [candidateKey, candidate] of activeObjects) {
      if (!dependsOnDroppedRelation(candidate, droppedRelation, cascade)) continue;
      activeObjects.delete(candidateKey);
      if (cascade) addPendingDroppedRelation(candidate, pendingRelations);
    }
  }
}

function dependsOnDroppedRelation(
  candidate: ExpectedCatalogObject,
  droppedRelation: ExpectedRelationReference,
  cascade: boolean,
): boolean {
  const relationMatches =
    candidate.relationName === droppedRelation.name &&
    (candidate.relationSchemaName ?? 'public') === droppedRelation.schemaName;
  const referencedRelationMatches =
    cascade &&
    candidate.referencedRelations?.some(
      (reference) =>
        reference.name === droppedRelation.name &&
        reference.schemaName === droppedRelation.schemaName,
    );
  return relationMatches || referencedRelationMatches === true;
}

function addPendingDroppedRelation(
  candidate: ExpectedCatalogObject,
  pendingRelations: ExpectedRelationReference[],
): void {
  if (candidate.kind !== 'table' && candidate.kind !== 'view') return;
  if (
    pendingRelations.some(
      (relation) =>
        relation.name === candidate.name && relation.schemaName === candidate.schemaName,
    )
  ) {
    return;
  }
  pendingRelations.push({schemaName: candidate.schemaName, name: candidate.name});
}

export function migrationHistoryName(namespace: string): string {
  return `__drizzle_migrations_${namespace}`;
}

export function ownerForObjectName(
  name: string,
  registry: ApiDatabaseRegistry,
): {ownerId: string; namespace: string} | undefined {
  const matches = registry.migrationUnits
    .filter((unit) => name.startsWith(`${unit.namespace}_`))
    .sort((left, right) => right.namespace.length - left.namespace.length);
  const match = matches[0];
  return match ? {ownerId: match.ownerId, namespace: match.namespace} : undefined;
}

function objectKey(kind: CatalogObjectKind, schemaName: string, name: string): string {
  return `${kind}:${schemaName}:${name}`;
}

function actualRelationKind(relkind: string): CatalogObjectKind | undefined {
  if (relkind === 'r' || relkind === 'p' || relkind === 'f') return 'table';
  if (relkind === 'i' || relkind === 'I') return 'index';
  if (relkind === 'S') return 'sequence';
  if (relkind === 'v' || relkind === 'm') return 'view';
  return undefined;
}

function expectedObjectStatus(
  object: ExpectedCatalogObject,
  registry: ApiDatabaseRegistry,
): CatalogObjectClassification {
  const owner = ownerForObjectName(object.name, registry);
  if (owner && owner.ownerId !== object.ownerId) return 'cross-owner';
  return object.name.startsWith(`${object.namespace}_`) ? 'compliant' : 'misnamed';
}

function addFinding(
  findings: CatalogFinding[],
  object: CatalogObjectReport,
  classification: CatalogFindingClassification,
  message: string,
): void {
  findings.push({
    classification,
    kind: object.kind,
    schemaName: object.schemaName,
    name: object.name,
    ...(object.ownerId ? {ownerId: object.ownerId} : {}),
    ...(object.migrationUnitId ? {migrationUnitId: object.migrationUnitId} : {}),
    ...(object.namespace ? {namespace: object.namespace} : {}),
    ...(object.expectedName ? {expectedName: object.expectedName} : {}),
    ...(object.referencedOwnerId ? {referencedOwnerId: object.referencedOwnerId} : {}),
    ...(object.sourcePath ? {sourcePath: object.sourcePath} : {}),
    ...(object.line ? {line: object.line} : {}),
    message,
  });
}

function reportFromExpected(
  object: ExpectedCatalogObject,
  classification: CatalogObjectClassification,
  actualName = object.name,
): CatalogObjectReport {
  return {
    classification,
    kind: object.kind,
    schemaName: object.schemaName,
    name: actualName,
    ownerId: object.ownerId,
    migrationUnitId: object.migrationUnitId,
    namespace: object.namespace,
    relationName: object.relationName ?? null,
    sourcePath: object.sourcePath,
    line: object.line,
  };
}

function tableOwnerLookup(expectedObjects: readonly ExpectedCatalogObject[]): Map<string, string> {
  const owners = new Map<string, string>();
  for (const object of expectedObjects) {
    if (object.kind === 'table') {
      owners.set(`${object.schemaName}:${postgresIdentifierName(object.name)}`, object.ownerId);
    }
  }
  return owners;
}

function ownerForRelation(
  schemaName: string | null,
  name: string | null,
  tableOwners: ReadonlyMap<string, string>,
  registry: ApiDatabaseRegistry,
): string | undefined {
  if (!schemaName || !name) return undefined;
  return (
    tableOwners.get(`${schemaName}:${name}`) ??
    tableOwners.get(`${schemaName}:${postgresIdentifierName(name)}`) ??
    ownerForObjectName(name, registry)?.ownerId
  );
}

function crossOwnerForeignKey(
  constraint: CatalogConstraint,
  tableOwners: ReadonlyMap<string, string>,
  registry: ApiDatabaseRegistry,
): {sourceOwner: string; referencedOwner: string} | undefined {
  if (constraint.type !== 'f') return undefined;
  const sourceOwner = ownerForRelation(
    constraint.relationSchemaName,
    constraint.relationName,
    tableOwners,
    registry,
  );
  const referencedOwner = ownerForRelation(
    constraint.referencedRelationSchemaName,
    constraint.referencedRelationName,
    tableOwners,
    registry,
  );
  if (!sourceOwner || !referencedOwner || sourceOwner === referencedOwner) return undefined;
  return {sourceOwner, referencedOwner};
}

function classifyUnexpectedRelation(
  relation: CatalogRelation,
  catalog: PostgresCatalog,
  tableOwners: ReadonlyMap<string, string>,
  registry: ApiDatabaseRegistry,
): CatalogObjectClassification {
  const kind = actualRelationKind(relation.relkind);
  if (!kind) return 'unknown';
  if ((kind === 'index' || kind === 'sequence') && relation.relationOid) {
    const ownerRelation = [...catalog.relations].find(
      (candidate) => candidate.oid === relation.relationOid,
    );
    if (
      ownerRelation &&
      actualRelationKind(ownerRelation.relkind) === 'table' &&
      ownerForRelation(ownerRelation.schemaName, ownerRelation.name, tableOwners, registry)
    ) {
      return 'compliant';
    }
  }
  return 'unknown';
}

function sortFindings(left: CatalogFinding, right: CatalogFinding): number {
  const leftKey = [left.classification, left.schemaName, left.name, left.kind].join(':');
  const rightKey = [right.classification, right.schemaName, right.name, right.kind].join(':');
  return compareText(leftKey, rightKey);
}

function sortObjects(left: CatalogObjectReport, right: CatalogObjectReport): number {
  const leftKey = [left.schemaName, left.name, left.kind].join(':');
  const rightKey = [right.schemaName, right.name, right.kind].join(':');
  return compareText(leftKey, rightKey);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

type ActualCatalogObject = CatalogRelation | CatalogEnum | CatalogConstraint | CatalogTrigger;

function actualCatalogObjectsByKey(catalog: PostgresCatalog): Map<string, ActualCatalogObject> {
  const actualByKey = new Map<string, ActualCatalogObject>();
  for (const relation of catalog.relations) {
    const kind = actualRelationKind(relation.relkind);
    if (kind && relation.schemaName !== 'drizzle') {
      actualByKey.set(objectKey(kind, relation.schemaName, relation.name), relation);
    }
  }
  for (const enumObject of catalog.enums) {
    actualByKey.set(objectKey('enum', enumObject.schemaName, enumObject.name), enumObject);
  }
  for (const constraint of catalog.constraints) {
    actualByKey.set(objectKey('constraint', constraint.schemaName, constraint.name), constraint);
  }
  for (const trigger of catalog.triggers) {
    actualByKey.set(objectKey('trigger', trigger.schemaName, trigger.name), trigger);
  }
  return actualByKey;
}

interface CatalogAuditAccumulator {
  consumedActualKeys: Set<string>;
  findings: CatalogFinding[];
  objects: CatalogObjectReport[];
}

function auditExpectedCatalogObject(
  object: ExpectedCatalogObject,
  actualByKey: ReadonlyMap<string, ActualCatalogObject>,
  tableOwners: ReadonlyMap<string, string>,
  registry: ApiDatabaseRegistry,
  audit: CatalogAuditAccumulator,
): void {
  const key = objectKey(object.kind, object.schemaName, postgresIdentifierName(object.name));
  const actual = actualByKey.get(key);
  if (!actual) {
    const reportObject = reportFromExpected(object, 'missing');
    audit.objects.push(reportObject);
    addFinding(
      audit.findings,
      reportObject,
      'missing',
      `Missing ${object.kind} ${object.schemaName}.${object.name} declared by ${object.migrationUnitId}`,
    );
    return;
  }
  audit.consumedActualKeys.add(key);
  let classification = expectedObjectStatus(object, registry);
  const foreignKeyOwners =
    object.kind === 'constraint' && 'type' in actual
      ? crossOwnerForeignKey(actual, tableOwners, registry)
      : undefined;
  if (foreignKeyOwners) classification = 'cross-owner';
  const reportObject = reportFromExpected(object, classification, actual.name);
  audit.objects.push(reportObject);
  if (classification === 'misnamed') {
    reportObject.expectedName = `${object.namespace}_...`;
    addFinding(
      audit.findings,
      reportObject,
      'misnamed',
      `${object.kind} ${object.schemaName}.${object.name} is owned by ${object.ownerId} but must use the ${object.namespace}_ namespace`,
    );
    return;
  }
  if (classification !== 'cross-owner') return;
  const foreignOwner =
    foreignKeyOwners?.referencedOwner ?? ownerForObjectName(object.name, registry)?.ownerId;
  if (foreignOwner) reportObject.referencedOwnerId = foreignOwner;
  const message = foreignKeyOwners
    ? `Foreign key ${object.schemaName}.${actual.name} crosses from ${foreignKeyOwners.sourceOwner} to ${foreignKeyOwners.referencedOwner}`
    : `${object.kind} ${object.schemaName}.${object.name} is declared by ${object.ownerId} but uses the ${foreignOwner ?? 'unknown'} namespace`;
  addFinding(audit.findings, reportObject, 'cross-owner', message);
}

function auditMigrationHistories(
  catalog: PostgresCatalog,
  expectedHistories: readonly ExpectedMigrationHistory[],
  audit: CatalogAuditAccumulator,
): void {
  const historyByName = new Map(
    catalog.relations
      .filter(
        (relation) =>
          relation.schemaName === 'drizzle' && actualRelationKind(relation.relkind) === 'table',
      )
      .map((relation) => [relation.name, relation]),
  );
  for (const history of expectedHistories) {
    auditMigrationHistory(history, historyByName.get(history.runtimeName), audit);
  }
}

function auditMigrationHistory(
  history: ExpectedMigrationHistory,
  actual: CatalogRelation | undefined,
  audit: CatalogAuditAccumulator,
): void {
  let classification: CatalogObjectClassification = 'missing';
  if (actual && history.runtimeName === history.name) classification = 'compliant';
  else if (actual) classification = 'misnamed';
  const reportObject: CatalogObjectReport = {
    classification,
    kind: 'migration-history',
    schemaName: history.schemaName,
    name: actual?.name ?? history.name,
    ownerId: history.ownerId,
    migrationUnitId: history.migrationUnitId,
    namespace: history.namespace,
    expectedName: history.name,
    sourcePath: history.sourcePath,
    line: history.line,
  };
  audit.objects.push(reportObject);
  if (!actual) {
    addFinding(
      audit.findings,
      reportObject,
      'missing',
      `Missing migration history drizzle.${history.name} for ${history.migrationUnitId}`,
    );
    return;
  }
  audit.consumedActualKeys.add(objectKey('migration-history', 'drizzle', actual.name));
  if (history.runtimeName !== history.name) {
    addFinding(
      audit.findings,
      reportObject,
      'misnamed',
      `Migration history for ${history.migrationUnitId} uses ${history.runtimeName} instead of ${history.name}`,
    );
  }
}

function auditUnexpectedRelations(
  catalog: PostgresCatalog,
  tableOwners: ReadonlyMap<string, string>,
  registry: ApiDatabaseRegistry,
  audit: CatalogAuditAccumulator,
): void {
  for (const relation of catalog.relations) {
    if (relation.schemaName === 'drizzle') {
      auditUnexpectedHistory(relation, audit);
      continue;
    }
    const kind = actualRelationKind(relation.relkind);
    if (!kind) continue;
    const key = objectKey(kind, relation.schemaName, relation.name);
    if (audit.consumedActualKeys.has(key)) continue;
    const classification = classifyUnexpectedRelation(relation, catalog, tableOwners, registry);
    const reportObject: CatalogObjectReport = {
      classification,
      kind,
      schemaName: relation.schemaName,
      name: relation.name,
    };
    audit.objects.push(reportObject);
    if (classification !== 'compliant') {
      addFinding(
        audit.findings,
        reportObject,
        classification,
        `Unknown ${kind} ${relation.schemaName}.${relation.name}`,
      );
    }
  }
}

function auditUnexpectedHistory(relation: CatalogRelation, audit: CatalogAuditAccumulator): void {
  if (actualRelationKind(relation.relkind) !== 'table') return;
  const key = objectKey('migration-history', 'drizzle', relation.name);
  if (audit.consumedActualKeys.has(key)) return;
  const reportObject: CatalogObjectReport = {
    classification: 'unknown',
    kind: 'migration-history',
    schemaName: 'drizzle',
    name: relation.name,
  };
  audit.objects.push(reportObject);
  addFinding(
    audit.findings,
    reportObject,
    'unknown',
    `Unknown migration history drizzle.${relation.name}`,
  );
}

function auditUnexpectedEnums(catalog: PostgresCatalog, audit: CatalogAuditAccumulator): void {
  for (const enumObject of catalog.enums) {
    const key = objectKey('enum', enumObject.schemaName, enumObject.name);
    if (audit.consumedActualKeys.has(key)) continue;
    const reportObject: CatalogObjectReport = {
      classification: 'unknown',
      kind: 'enum',
      schemaName: enumObject.schemaName,
      name: enumObject.name,
    };
    audit.objects.push(reportObject);
    addFinding(
      audit.findings,
      reportObject,
      'unknown',
      `Unknown enum ${enumObject.schemaName}.${enumObject.name}`,
    );
  }
}

function auditUnexpectedConstraints(
  catalog: PostgresCatalog,
  tableOwners: ReadonlyMap<string, string>,
  registry: ApiDatabaseRegistry,
  audit: CatalogAuditAccumulator,
): void {
  for (const constraint of catalog.constraints) {
    if (constraint.schemaName === 'drizzle') continue;
    const key = objectKey('constraint', constraint.schemaName, constraint.name);
    if (audit.consumedActualKeys.has(key)) continue;
    auditUnexpectedConstraint(constraint, tableOwners, registry, audit);
  }
}

function auditUnexpectedConstraint(
  constraint: CatalogConstraint,
  tableOwners: ReadonlyMap<string, string>,
  registry: ApiDatabaseRegistry,
  audit: CatalogAuditAccumulator,
): void {
  const sourceOwner = ownerForRelation(
    constraint.relationSchemaName,
    constraint.relationName,
    tableOwners,
    registry,
  );
  const foreignKeyOwners = crossOwnerForeignKey(constraint, tableOwners, registry);
  let classification: CatalogObjectClassification = 'unknown';
  if (foreignKeyOwners) classification = 'cross-owner';
  else if (sourceOwner) classification = 'compliant';
  const reportObject: CatalogObjectReport = {
    classification,
    kind: 'constraint',
    schemaName: constraint.schemaName,
    name: constraint.name,
    ...(sourceOwner ? {ownerId: sourceOwner} : {}),
    ...(foreignKeyOwners ? {referencedOwnerId: foreignKeyOwners.referencedOwner} : {}),
    relationName: constraint.relationName,
    referencedRelationName: constraint.referencedRelationName,
  };
  audit.objects.push(reportObject);
  if (foreignKeyOwners) {
    addFinding(
      audit.findings,
      reportObject,
      'cross-owner',
      `Foreign key ${constraint.schemaName}.${constraint.name} crosses from ${foreignKeyOwners.sourceOwner} to ${foreignKeyOwners.referencedOwner}`,
    );
  } else if (!sourceOwner) {
    addFinding(
      audit.findings,
      reportObject,
      'unknown',
      `Unknown constraint ${constraint.schemaName}.${constraint.name}`,
    );
  }
}

function auditUnexpectedTriggers(
  catalog: PostgresCatalog,
  tableOwners: ReadonlyMap<string, string>,
  registry: ApiDatabaseRegistry,
  audit: CatalogAuditAccumulator,
): void {
  for (const trigger of catalog.triggers) {
    const key = objectKey('trigger', trigger.schemaName, trigger.name);
    if (audit.consumedActualKeys.has(key)) continue;
    const owner = ownerForRelation(trigger.schemaName, trigger.relationName, tableOwners, registry);
    const reportObject: CatalogObjectReport = {
      classification: owner ? 'compliant' : 'unknown',
      kind: 'trigger',
      schemaName: trigger.schemaName,
      name: trigger.name,
      ...(owner ? {ownerId: owner} : {}),
      relationName: trigger.relationName,
    };
    audit.objects.push(reportObject);
    if (!owner) {
      addFinding(
        audit.findings,
        reportObject,
        'unknown',
        `Unknown trigger ${trigger.schemaName}.${trigger.name}`,
      );
    }
  }
}

function auditUnexpectedNamespaces(catalog: PostgresCatalog, audit: CatalogAuditAccumulator): void {
  for (const namespace of catalog.namespaces) {
    if (namespace.name === 'public' || namespace.name === 'drizzle') continue;
    const reportObject: CatalogObjectReport = {
      classification: 'unknown',
      kind: 'schema',
      schemaName: namespace.name,
      name: namespace.name,
    };
    audit.objects.push(reportObject);
    addFinding(
      audit.findings,
      reportObject,
      'unknown',
      `Unknown PostgreSQL schema ${namespace.name}`,
    );
  }
}

export function auditPostgresCatalog({
  catalog,
  expectedObjects,
  expectedHistories,
  migrationUnits,
  registry,
  databaseName,
  serverVersion,
}: {
  catalog: PostgresCatalog;
  expectedObjects: readonly ExpectedCatalogObject[];
  expectedHistories: readonly ExpectedMigrationHistory[];
  migrationUnits: readonly CatalogMigrationUnitReport[];
  registry: ApiDatabaseRegistry;
  databaseName?: string;
  serverVersion?: string;
}): CatalogAuditReport {
  const findings: CatalogFinding[] = [];
  const objects: CatalogObjectReport[] = [];
  const consumedActualKeys = new Set<string>();
  const audit = {consumedActualKeys, findings, objects};
  const actualByKey = actualCatalogObjectsByKey(catalog);

  const tableOwners = tableOwnerLookup(expectedObjects);
  for (const object of expectedObjects) {
    auditExpectedCatalogObject(object, actualByKey, tableOwners, registry, audit);
  }

  auditMigrationHistories(catalog, expectedHistories, audit);
  auditUnexpectedRelations(catalog, tableOwners, registry, audit);
  auditUnexpectedEnums(catalog, audit);
  auditUnexpectedConstraints(catalog, tableOwners, registry, audit);
  auditUnexpectedTriggers(catalog, tableOwners, registry, audit);
  auditUnexpectedNamespaces(catalog, audit);

  const counts: CatalogReportCounts = {
    compliant: objects.filter((object) => object.classification === 'compliant').length,
    constraints: catalog.constraints.length,
    enums: catalog.enums.length,
    indexes: catalog.relations.filter(
      (relation) => actualRelationKind(relation.relkind) === 'index',
    ).length,
    migrationHistories: catalog.relations.filter(
      (relation) =>
        relation.schemaName === 'drizzle' && actualRelationKind(relation.relkind) === 'table',
    ).length,
    schemas: catalog.namespaces.length,
    sequences: catalog.relations.filter(
      (relation) => actualRelationKind(relation.relkind) === 'sequence',
    ).length,
    tables: catalog.relations.filter(
      (relation) =>
        relation.schemaName === 'public' && actualRelationKind(relation.relkind) === 'table',
    ).length,
    triggers: catalog.triggers.length,
    unknown: objects.filter((object) => object.classification === 'unknown').length,
    views: catalog.relations.filter((relation) => actualRelationKind(relation.relkind) === 'view')
      .length,
  };

  return {
    ...(databaseName ? {databaseName} : {}),
    ...(serverVersion ? {serverVersion} : {}),
    migrationUnits,
    objects: [...objects].sort(sortObjects),
    findings: [...findings].sort(sortFindings),
    counts,
  };
}

export function formatCatalogReport(report: CatalogAuditReport): string {
  const lines = [
    report.findings.length === 0
      ? 'API database catalog verification passed'
      : `API database catalog verification failed (${report.findings.length} findings)`,
    ...(report.databaseName ? [`Database: ${report.databaseName}`] : []),
    ...(report.serverVersion ? [`PostgreSQL: ${report.serverVersion}`] : []),
    `Migration units: ${report.migrationUnits.length}`,
    `Tables: ${report.counts.tables}`,
    `Enums: ${report.counts.enums}`,
    `Indexes: ${report.counts.indexes}`,
    `Constraints: ${report.counts.constraints}`,
    `Migration histories: ${report.counts.migrationHistories}`,
    `Compliant objects: ${report.counts.compliant}`,
  ];
  if (report.findings.length > 0) {
    lines.push('', 'Findings:');
    for (const finding of report.findings) {
      const location = `${finding.schemaName}.${finding.name}`;
      const source = finding.sourcePath ? ` (${finding.sourcePath}:${finding.line ?? 1})` : '';
      lines.push(`- [${finding.classification}] ${location}: ${finding.message}${source}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function formatCatalogJsonReport(report: CatalogAuditReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function expectedHistoryForUnit(
  unit: DatabaseMigrationUnit,
  runtimeName: string,
  sourcePath = unit.migrationsPath,
): ExpectedMigrationHistory {
  return {
    kind: 'migration-history',
    schemaName: 'drizzle',
    name: migrationHistoryName(unit.namespace),
    runtimeName,
    ownerId: unit.ownerId,
    migrationUnitId: unit.id,
    namespace: unit.namespace,
    sourcePath,
    line: 1,
  };
}

export function dedupeExpectedObjects(
  objects: readonly ExpectedCatalogObject[],
): ExpectedCatalogObject[] {
  const seen = new Map<string, ExpectedCatalogObject>();
  const ownershipConflicts: ExpectedCatalogObject[] = [];
  for (const object of objects) {
    const key = objectKey(object.kind, object.schemaName, object.name);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, object);
      continue;
    }
    // Repeated declarations by the same owner are deduplicated; ownership conflicts stay visible.
    if (existing.ownerId !== object.ownerId || existing.namespace !== object.namespace) {
      ownershipConflicts.push(object);
    }
  }
  return [...seen.values(), ...ownershipConflicts].sort((left, right) => {
    const leftKey = objectKey(left.kind, left.schemaName, left.name);
    const rightKey = objectKey(right.kind, right.schemaName, right.name);
    return compareText(leftKey, rightKey);
  });
}
