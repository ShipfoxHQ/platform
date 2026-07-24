import {DEFAULT_ARCHITECTURE_CLASSES, RULE_CATALOG} from './catalog.js';
import {
  type ArchitectureFacts,
  architecturePolicySchemaVersion,
  type JsonValue,
  type PackageArchitectureMetadata,
  type PackageFact,
  type PackageFactManifestOptions,
  type RepositoryConfiguration,
} from './types.js';

const importKinds = new Set(['dynamic', 're-export', 'static', 'type-only']);
const dependencyGroups = new Set([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);
const packageOrigins = new Set(['installed', 'local']);
const boundaryDecisions = new Set(['allow', 'never', 'same-context']);
const ruleIds = new Set(RULE_CATALOG.rules.map(({id}) => id));

export function validatePackageArchitectureMetadata(value: unknown): string[] {
  if (!isRecord(value)) return ['Package architecture metadata must be an object'];

  const errors: string[] = [];
  if (value.schema !== architecturePolicySchemaVersion)
    errors.push(`Unsupported package architecture metadata schema: ${String(value.schema)}`);
  requireNonEmptyString(value.realm, 'Package architecture metadata realm', errors);
  requireNonEmptyString(value.kind, 'Package architecture metadata kind', errors);
  requireNullableString(value.context, 'Package architecture metadata context', errors);

  if (
    typeof value.kind === 'string' &&
    DEFAULT_ARCHITECTURE_CLASSES[value.kind]?.requiresBoundedContext === true &&
    (typeof value.context !== 'string' || value.context.length === 0)
  ) {
    errors.push(
      `Package architecture metadata context is required for architecture class: ${value.kind}`,
    );
  }

  for (const key of Object.keys(value)) {
    if (!['schema', 'realm', 'kind', 'context'].includes(key))
      errors.push(`Unknown package architecture metadata property: ${key}`);
  }

  return [...new Set(errors)].sort();
}

export function isPackageArchitectureMetadata(
  value: unknown,
): value is PackageArchitectureMetadata {
  return validatePackageArchitectureMetadata(value).length === 0;
}

export function assertPackageArchitectureMetadata(
  value: unknown,
): asserts value is PackageArchitectureMetadata {
  const errors = validatePackageArchitectureMetadata(value);
  if (errors.length > 0) throw new Error(errors.join('\n'));
}

export function packageArchitectureMetadataFromManifest(manifest: unknown): unknown | undefined {
  if (!isRecord(manifest) || !isRecord(manifest.shipfox)) return undefined;
  return Object.hasOwn(manifest.shipfox, 'architecture')
    ? manifest.shipfox.architecture
    : undefined;
}

export function packageFactFromManifest(
  manifest: unknown,
  {path, origin = 'installed'}: PackageFactManifestOptions,
): PackageFact {
  const record = isRecord(manifest) ? manifest : {};
  const metadata = packageArchitectureMetadataFromManifest(record);
  const metadataRecord = isRecord(metadata) ? metadata : {};

  return {
    schemaVersion: architecturePolicySchemaVersion,
    name: typeof record.name === 'string' ? record.name : '',
    version: typeof record.version === 'string' ? record.version : null,
    path,
    origin,
    policyParticipant: metadata !== undefined,
    realm: typeof metadataRecord.realm === 'string' ? metadataRecord.realm : null,
    architectureClass: typeof metadataRecord.kind === 'string' ? metadataRecord.kind : null,
    boundedContext:
      metadataRecord.context === null || typeof metadataRecord.context === 'string'
        ? metadataRecord.context
        : null,
  };
}

export function packageFactFromInstalledManifest(manifest: unknown, path: string): PackageFact {
  return packageFactFromManifest(manifest, {path, origin: 'installed'});
}

export function validateArchitectureFacts(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['Architecture facts must be an object'];
  if (value.schemaVersion !== architecturePolicySchemaVersion)
    errors.push(`Unsupported architecture facts schema version: ${String(value.schemaVersion)}`);

  const packages = value.packages;
  if (!Array.isArray(packages)) {
    errors.push('Architecture facts packages must be an array');
  } else {
    const names = new Set<string>();
    for (const [index, packageFact] of packages.entries()) {
      if (!isRecord(packageFact)) {
        errors.push(`Package fact ${index} must be an object`);
        continue;
      }
      validateSchemaVersion(packageFact, `Package fact ${index}`, errors);
      requireNonEmptyString(packageFact.name, `Package fact ${index} name`, errors);
      requireNullableString(packageFact.version, `Package fact ${index} version`, errors);
      requireNonEmptyString(packageFact.path, `Package fact ${index} path`, errors);
      requireEnum(packageFact.origin, packageOrigins, `Package fact ${index} origin`, errors);
      if (typeof packageFact.policyParticipant !== 'boolean')
        errors.push(`Package fact ${index} policyParticipant must be a boolean`);
      requireNullableString(packageFact.realm, `Package fact ${index} realm`, errors);
      requireNullableString(
        packageFact.architectureClass,
        `Package fact ${index} architectureClass`,
        errors,
      );
      requireNullableString(
        packageFact.boundedContext,
        `Package fact ${index} boundedContext`,
        errors,
      );
      if (typeof packageFact.name === 'string') {
        if (names.has(packageFact.name)) errors.push(`Duplicate package fact: ${packageFact.name}`);
        names.add(packageFact.name);
      }
    }
  }

  validateArray(value.importEdges, 'import edge', errors, (edge, index) => {
    validateSchemaVersion(edge, `Import edge ${index}`, errors);
    requireNonEmptyString(edge.source, `Import edge ${index} source`, errors);
    requireNonEmptyString(edge.target, `Import edge ${index} target`, errors);
    requireNonEmptyString(edge.sourceFile, `Import edge ${index} sourceFile`, errors);
    requireNonEmptyString(edge.specifier, `Import edge ${index} specifier`, errors);
    requireEnum(edge.importKind, importKinds, `Import edge ${index} importKind`, errors);
  });
  validateArray(value.manifestEdges, 'manifest edge', errors, (edge, index) => {
    validateSchemaVersion(edge, `Manifest edge ${index}`, errors);
    requireNonEmptyString(edge.source, `Manifest edge ${index} source`, errors);
    requireNonEmptyString(edge.target, `Manifest edge ${index} target`, errors);
    requireEnum(
      edge.dependencyGroup,
      dependencyGroups,
      `Manifest edge ${index} dependencyGroup`,
      errors,
    );
  });
  validateArray(value.publicExports, 'public export', errors, (entry, index) => {
    validateSchemaVersion(entry, `Public export ${index}`, errors);
    requireNonEmptyString(entry.package, `Public export ${index} package`, errors);
    requireNonEmptyString(entry.publicSubpath, `Public export ${index} publicSubpath`, errors);
    requireNullableString(entry.resolvedTarget, `Public export ${index} resolvedTarget`, errors);
  });
  validateArray(value.compositionFacts, 'composition fact', errors, (fact, index) => {
    validateSchemaVersion(fact, `Composition fact ${index}`, errors);
    requireNonEmptyString(fact.declaringOwner, `Composition fact ${index} declaringOwner`, errors);
    requireNonEmptyString(
      fact.contributionOwner,
      `Composition fact ${index} contributionOwner`,
      errors,
    );
    requireNonEmptyString(fact.targetOwner, `Composition fact ${index} targetOwner`, errors);
    requireNullableString(
      fact.explicitCoordinator,
      `Composition fact ${index} explicitCoordinator`,
      errors,
    );
  });

  return [...new Set(errors)].sort();
}

export function isArchitectureFacts(value: unknown): value is ArchitectureFacts {
  return validateArchitectureFacts(value).length === 0;
}

export function assertArchitectureFacts(value: unknown): asserts value is ArchitectureFacts {
  const errors = validateArchitectureFacts(value);
  if (errors.length > 0) throw new Error(errors.join('\n'));
}

export function validateRepositoryConfiguration(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['Repository configuration must be an object'];
  if (value.schemaVersion !== architecturePolicySchemaVersion)
    errors.push(
      `Unsupported repository configuration schema version: ${String(value.schemaVersion)}`,
    );
  if (!Array.isArray(value.localPackages))
    errors.push('Repository configuration localPackages must be an array');
  if (!Array.isArray(value.compositionRoots))
    errors.push('Repository configuration compositionRoots must be an array');
  if (!isRecord(value.realms)) errors.push('Repository configuration realms must be an object');
  if (!isRecord(value.architectureClasses))
    errors.push('Repository configuration architectureClasses must be an object');
  if (!isRecord(value.classRelationships))
    errors.push('Repository configuration classRelationships must be an object');
  if (!isRecord(value.exportIntent))
    errors.push('Repository configuration exportIntent must be an object');
  if (!isRecord(value.extensions))
    errors.push('Repository configuration extensions must be an object');
  if (isRecord(value.extensions)) {
    for (const [name, extension] of Object.entries(value.extensions)) {
      if (!isJsonValue(extension))
        errors.push(`Repository extension is not JSON-compatible: ${name}`);
    }
  }
  if (!Array.isArray(value.exceptions))
    errors.push('Repository configuration exceptions must be an array');

  if (Array.isArray(value.localPackages)) {
    const paths = new Set<string>();
    for (const [index, entry] of value.localPackages.entries()) {
      if (!isRecord(entry)) {
        errors.push(`Local package classification ${index} must be an object`);
        continue;
      }
      requireNonEmptyString(entry.path, `Local package classification ${index} path`, errors);
      requireNonEmptyString(
        entry.packageName,
        `Local package classification ${index} packageName`,
        errors,
      );
      requireNonEmptyString(entry.realm, `Local package classification ${index} realm`, errors);
      requireNonEmptyString(
        entry.architectureClass,
        `Local package classification ${index} architectureClass`,
        errors,
      );
      requireNullableString(
        entry.boundedContext,
        `Local package classification ${index} boundedContext`,
        errors,
      );
      if (typeof entry.path === 'string') {
        if (paths.has(entry.path))
          errors.push(`Duplicate local package classification: ${entry.path}`);
        paths.add(entry.path);
      }
    }
  }

  if (Array.isArray(value.compositionRoots)) {
    for (const [index, root] of value.compositionRoots.entries())
      requireNonEmptyString(root, `Composition root ${index}`, errors);
  }

  const realmNames = isRecord(value.realms) ? Object.keys(value.realms) : [];
  if (isRecord(value.realms)) {
    for (const [realm, realmConfig] of Object.entries(value.realms)) {
      if (!isRecord(realmConfig) || !Array.isArray(realmConfig.mayDependOn)) {
        errors.push(`Realm ${realm} must define mayDependOn as an array`);
        continue;
      }
      for (const [index, dependency] of realmConfig.mayDependOn.entries()) {
        requireNonEmptyString(dependency, `Realm ${realm} mayDependOn[${index}]`, errors);
        if (typeof dependency === 'string' && !realmNames.includes(dependency))
          errors.push(`Realm ${realm} references undeclared realm: ${dependency}`);
      }
    }
  }

  const classNames = isRecord(value.architectureClasses)
    ? Object.keys(value.architectureClasses)
    : [];
  if (isRecord(value.architectureClasses)) {
    for (const [architectureClass, classConfig] of Object.entries(value.architectureClasses)) {
      if (!isRecord(classConfig) || typeof classConfig.requiresBoundedContext !== 'boolean')
        errors.push(`Architecture class ${architectureClass} must define requiresBoundedContext`);
    }
  }

  if (isRecord(value.classRelationships)) {
    for (const architectureClass of classNames) {
      const row = value.classRelationships[architectureClass];
      if (!isRecord(row)) {
        errors.push(`Missing class relationship row: ${architectureClass}`);
        continue;
      }
      for (const targetClass of classNames) {
        const relationship = row[targetClass];
        if (!isRecord(relationship)) {
          errors.push(
            `Missing class relationship decision: ${architectureClass} -> ${targetClass}`,
          );
          continue;
        }
        requireEnum(
          relationship.decision,
          boundaryDecisions,
          `Class relationship ${architectureClass} -> ${targetClass} decision`,
          errors,
        );
        if (relationship.ruleId !== undefined) {
          requireNonEmptyString(
            relationship.ruleId,
            `Class relationship ${architectureClass} -> ${targetClass} ruleId`,
            errors,
          );
          if (typeof relationship.ruleId === 'string' && !ruleIds.has(relationship.ruleId))
            errors.push(`Unknown class relationship rule ID: ${relationship.ruleId}`);
        }
        if (relationship.decision !== 'allow' && typeof relationship.ruleId !== 'string') {
          errors.push(`Class relationship ${architectureClass} -> ${targetClass} needs a ruleId`);
        }
      }
      for (const targetClass of Object.keys(row)) {
        if (!classNames.includes(targetClass))
          errors.push(
            `Class relationship references undeclared class: ${architectureClass} -> ${targetClass}`,
          );
      }
    }
    for (const architectureClass of Object.keys(value.classRelationships)) {
      if (!classNames.includes(architectureClass))
        errors.push(`Class relationship has undeclared row: ${architectureClass}`);
    }
  }

  if (isRecord(value.exportIntent)) {
    for (const [packageName, subpaths] of Object.entries(value.exportIntent)) {
      if (!Array.isArray(subpaths)) {
        errors.push(`Export intent for ${packageName} must be an array`);
        continue;
      }
      for (const [index, subpath] of subpaths.entries())
        requireNonEmptyString(subpath, `Export intent ${packageName}[${index}]`, errors);
    }
  }

  if (Array.isArray(value.exceptions)) {
    for (const [index, exception] of value.exceptions.entries())
      validateException(exception, `Exception ${index}`, errors);
  }

  return [...new Set(errors)].sort();
}

export function isRepositoryConfiguration(value: unknown): value is RepositoryConfiguration {
  return validateRepositoryConfiguration(value).length === 0;
}

export function assertRepositoryConfiguration(
  value: unknown,
): asserts value is RepositoryConfiguration {
  const errors = validateRepositoryConfiguration(value);
  if (errors.length > 0) throw new Error(errors.join('\n'));
}

function validateException(value: unknown, label: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  for (const field of ['ruleId', 'source', 'target', 'owner', 'reason', 'trackingIssue'] as const)
    requireNonEmptyString(value[field], `${label} ${field}`, errors);
  requireNullableString(value.removalCondition, `${label} removalCondition`, errors);
  requireNullableString(value.expiresAt, `${label} expiresAt`, errors);
  if (typeof value.ruleId === 'string' && !ruleIds.has(value.ruleId))
    errors.push(`${label} has unknown ruleId: ${value.ruleId}`);
  if (
    (typeof value.source === 'string' && hasWildcard(value.source)) ||
    (typeof value.target === 'string' && hasWildcard(value.target))
  ) {
    errors.push(`${label} source and target must identify exact facts`);
  }
  const hasRemovalCondition =
    typeof value.removalCondition === 'string' && value.removalCondition.length > 0;
  const hasExpiry = typeof value.expiresAt === 'string' && value.expiresAt.length > 0;
  if (!hasRemovalCondition && !hasExpiry)
    errors.push(`${label} must define removalCondition or expiresAt`);
  if (typeof value.expiresAt === 'string' && Number.isNaN(Date.parse(value.expiresAt)))
    errors.push(`${label} expiresAt must be an ISO date`);
}

function validateArray(
  value: unknown,
  label: string,
  errors: string[],
  validate: (entry: Record<string, unknown>, index: number) => void,
): void {
  if (!Array.isArray(value)) {
    errors.push(`Architecture facts ${label}s must be an array`);
    return;
  }
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      errors.push(`${label[0]?.toUpperCase() ?? label} ${index} must be an object`);
      continue;
    }
    validate(entry, index);
  }
}

function validateSchemaVersion(
  value: Record<string, unknown>,
  label: string,
  errors: string[],
): void {
  if (value.schemaVersion !== architecturePolicySchemaVersion)
    errors.push(`${label} has unsupported schema version: ${String(value.schemaVersion)}`);
}

function requireNonEmptyString(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== 'string' || value.length === 0)
    errors.push(`${label} must be a non-empty string`);
}

function requireNullableString(value: unknown, label: string, errors: string[]): void {
  if (value !== null && typeof value !== 'string') errors.push(`${label} must be a string or null`);
}

function requireEnum(
  value: unknown,
  values: ReadonlySet<string>,
  label: string,
  errors: string[],
): void {
  if (typeof value !== 'string' || !values.has(value))
    errors.push(`${label} is invalid: ${String(value)}`);
}

function hasWildcard(value: string): boolean {
  return value.includes('*') || value.includes('?');
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function isRecord(value: unknown): value is Record<string, JsonValue | unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
