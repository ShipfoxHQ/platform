export const architecturePolicySchemaVersion = 1 as const;
export const architecturePolicyPackageName = '@shipfox/architecture-policy';

export type ArchitecturePolicySchemaVersion = typeof architecturePolicySchemaVersion;
export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | {[key: string]: JsonValue};

export type PackageOrigin = 'installed' | 'local';
export type ImportKind = 'dynamic' | 're-export' | 'static' | 'type-only';
export type DependencyGroup =
  | 'dependencies'
  | 'devDependencies'
  | 'optionalDependencies'
  | 'peerDependencies';
export type BoundaryDecision = 'allow' | 'never' | 'same-context';

export const architectureClasses = {
  compositionRoot: 'composition-root',
  dto: 'dto',
  implementation: 'implementation',
  sharedInfrastructure: 'shared-infrastructure',
  sharedSemantic: 'shared-semantic',
  spi: 'spi',
} as const;

export type BuiltInArchitectureClass =
  (typeof architectureClasses)[keyof typeof architectureClasses];
export type ArchitectureClass = string;

/** Architecture identity carried by a published Shipfox package manifest. */
export interface PackageArchitectureMetadata {
  schema: ArchitecturePolicySchemaVersion;
  realm: string;
  kind: ArchitectureClass;
  context: string | null;
}

export interface PackageFact {
  schemaVersion: ArchitecturePolicySchemaVersion;
  name: string;
  version: string | null;
  path: string;
  origin: PackageOrigin;
  policyParticipant: boolean;
  realm: string | null;
  architectureClass: ArchitectureClass | null;
  boundedContext: string | null;
}

export interface PackageFactManifestOptions {
  path: string;
  origin?: PackageOrigin;
}

export interface ResolvedImportEdgeFact {
  schemaVersion: ArchitecturePolicySchemaVersion;
  source: string;
  target: string;
  sourceFile: string;
  specifier: string;
  importKind: ImportKind;
}

export interface ManifestEdgeFact {
  schemaVersion: ArchitecturePolicySchemaVersion;
  source: string;
  target: string;
  dependencyGroup: DependencyGroup;
}

export interface PublicExportFact {
  schemaVersion: ArchitecturePolicySchemaVersion;
  package: string;
  publicSubpath: string;
  resolvedTarget: string | null;
}

export interface CompositionFact {
  schemaVersion: ArchitecturePolicySchemaVersion;
  declaringOwner: string;
  contributionOwner: string;
  targetOwner: string;
  explicitCoordinator: string | null;
}

export interface ArchitectureFacts {
  schemaVersion: ArchitecturePolicySchemaVersion;
  packages: PackageFact[];
  importEdges: ResolvedImportEdgeFact[];
  manifestEdges: ManifestEdgeFact[];
  publicExports: PublicExportFact[];
  compositionFacts: CompositionFact[];
}

export interface LocalPackageClassification {
  path: string;
  packageName: string;
  realm: string;
  architectureClass: ArchitectureClass;
  boundedContext: string | null;
}

export interface RealmConfiguration {
  mayDependOn: string[];
}

export interface ArchitectureClassConfiguration {
  requiresBoundedContext: boolean;
}

export interface ClassRelationship {
  decision: BoundaryDecision;
  ruleId?: string;
}

export interface ExactException {
  ruleId: string;
  source: string;
  target: string;
  owner: string;
  reason: string;
  trackingIssue: string;
  removalCondition: string | null;
  expiresAt: string | null;
}

export interface RepositoryConfiguration {
  schemaVersion: ArchitecturePolicySchemaVersion;
  localPackages: LocalPackageClassification[];
  compositionRoots: string[];
  realms: Record<string, RealmConfiguration>;
  architectureClasses: Record<string, ArchitectureClassConfiguration>;
  classRelationships: Record<string, Record<string, ClassRelationship>>;
  exportIntent: Record<string, string[]>;
  extensions: Record<string, JsonValue>;
  exceptions: ExactException[];
}

export interface RuleDefinition {
  id: string;
  title: string;
  description: string;
  guidanceLocation: string;
  blocking: true;
}

export interface RuleCatalog {
  schemaVersion: ArchitecturePolicySchemaVersion;
  rules: RuleDefinition[];
}

export interface PolicyDiagnostic {
  blocking: true;
  ruleId: string;
  message: string;
  expectedBoundary: string;
  guidanceLocation: string;
  facts: Record<string, JsonValue>;
  source?: string;
  target?: string;
}

export interface PolicyEvaluationOptions {
  now?: Date | string;
}

export function emptyArchitectureFacts(): ArchitectureFacts {
  return {
    schemaVersion: architecturePolicySchemaVersion,
    packages: [],
    importEdges: [],
    manifestEdges: [],
    publicExports: [],
    compositionFacts: [],
  };
}
