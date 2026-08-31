import {guidanceLocations, RULE_CATALOG, RULE_IDS} from './catalog.js';
import {
  type ArchitectureFacts,
  architecturePolicySchemaVersion,
  type BoundaryDecision,
  type ClassRelationship,
  type CompositionFact,
  type ExactException,
  type JsonValue,
  type PackageFact,
  type PolicyDiagnostic,
  type PolicyEvaluationOptions,
  type PublicExportFact,
  type RepositoryConfiguration,
} from './types.js';
import {validateArchitectureFacts, validateRepositoryConfiguration} from './validation.js';

export function evaluateArchitecturePolicy(
  facts: ArchitectureFacts | null | undefined,
  configuration: RepositoryConfiguration | null | undefined,
  options: PolicyEvaluationOptions = {},
): PolicyDiagnostic[] {
  const diagnostics: PolicyDiagnostic[] = [];
  const exceptions = Array.isArray(configuration?.exceptions) ? configuration.exceptions : [];
  const configurationErrors = validateRepositoryConfiguration(configuration);
  diagnostics.push(...configurationErrorDiagnostics(configurationErrors));
  const factErrors = validateArchitectureFacts(facts);
  diagnostics.push(...factErrorDiagnostics(factErrors));

  const packageFacts = Array.isArray(facts?.packages) ? facts.packages : [];
  const packageMap = new Map(packageFacts.map((packageFact) => [packageFact.name, packageFact]));
  const validConfiguration = configurationErrors.length === 0;
  const validFacts = factErrors.length === 0;

  if (validConfiguration && validFacts && configuration && facts) {
    evaluateValidArchitecturePolicy(
      facts,
      configuration,
      packageMap,
      exceptions,
      options,
      diagnostics,
    );
  }

  return applyExactExceptions(diagnostics, exceptions, options);
}

function configurationErrorDiagnostics(errors: readonly string[]): PolicyDiagnostic[] {
  return errors.map((error) => {
    const ruleId = configurationRuleId(error);
    return diagnostic({
      ruleId,
      message: error,
      expectedBoundary: 'A complete versioned repository configuration with explicit relationships',
      guidanceLocation: configurationGuidanceLocation(ruleId),
      facts: {configurationError: error},
    });
  });
}

function factErrorDiagnostics(errors: readonly string[]): PolicyDiagnostic[] {
  return errors.map((error) =>
    diagnostic({
      ruleId: RULE_IDS.factReference,
      message: error,
      expectedBoundary: 'A versioned JSON-compatible architecture fact document',
      guidanceLocation: guidanceLocations.facts,
      facts: {factError: error},
    }),
  );
}

function evaluateValidArchitecturePolicy(
  facts: ArchitectureFacts,
  configuration: RepositoryConfiguration,
  packageMap: ReadonlyMap<string, PackageFact>,
  exceptions: readonly ExactException[],
  options: PolicyEvaluationOptions,
  diagnostics: PolicyDiagnostic[],
): void {
  for (const packageFact of facts.packages)
    evaluatePackageMetadata(packageFact, configuration, diagnostics);
  evaluateLocalClassifications(facts.packages, configuration, diagnostics);
  for (const edge of facts.importEdges)
    evaluateImportEdge(edge, packageMap, configuration, diagnostics);
  for (const edge of facts.manifestEdges)
    evaluateManifestEdge(edge, packageMap, configuration, diagnostics);
  for (const exportFact of facts.publicExports) evaluateExport(exportFact, packageMap, diagnostics);
  evaluateExportIntent(facts.publicExports, packageMap, configuration, diagnostics);
  for (const compositionFact of facts.compositionFacts) {
    evaluateComposition(compositionFact, packageMap, configuration, diagnostics);
  }
  evaluateExceptions(exceptions, options, diagnostics);
}

export const evaluatePolicy = evaluateArchitecturePolicy;

function configurationRuleId(error: string): string {
  const normalized = error.toLowerCase();
  if (normalized.includes('class relationship') || normalized.includes('classrelationship'))
    return RULE_IDS.classRelationship;
  if (normalized.includes('exception')) return RULE_IDS.exceptionValidity;
  if (normalized.includes('export intent') || normalized.includes('exportintent'))
    return RULE_IDS.exportIntent;
  if (normalized.includes('composition root') || normalized.includes('compositionroot'))
    return RULE_IDS.compositionOwner;
  return RULE_IDS.realmConfiguration;
}

function relationshipGuidanceLocation(ruleId: string): string {
  if (ruleId === RULE_IDS.realmDirection) return guidanceLocations.realms;
  if (ruleId === RULE_IDS.manifestEdge) return guidanceLocations.manifests;
  return guidanceLocations.imports;
}

function configurationGuidanceLocation(ruleId: string): string {
  if (ruleId === RULE_IDS.classRelationship) return guidanceLocations.imports;
  if (ruleId === RULE_IDS.exceptionValidity) return guidanceLocations.exceptions;
  if (ruleId === RULE_IDS.exportIntent) return guidanceLocations.facts;
  if (ruleId === RULE_IDS.compositionOwner) return guidanceLocations.composition;
  return guidanceLocations.realms;
}

function evaluateLocalClassifications(
  packages: PackageFact[],
  configuration: RepositoryConfiguration,
  diagnostics: PolicyDiagnostic[],
): void {
  const packagesByPath = new Map(packages.map((packageFact) => [packageFact.path, packageFact]));
  for (const classification of configuration.localPackages) {
    const packageFact = packagesByPath.get(classification.path);
    if (!packageFact) {
      diagnostics.push(
        diagnostic({
          ruleId: RULE_IDS.factReference,
          message: `Local package classification has no matching package fact: ${classification.path}`,
          expectedBoundary:
            'Every configured local classification must describe a discovered local package',
          guidanceLocation: guidanceLocations.facts,
          source: classification.packageName,
          target: classification.path,
          facts: {...classification},
        }),
      );
      continue;
    }
    const mismatches = [
      packageFact.name !== classification.packageName ? 'packageName' : undefined,
      packageFact.origin !== 'local' ? 'origin' : undefined,
      packageFact.realm !== classification.realm ? 'realm' : undefined,
      packageFact.architectureClass !== classification.architectureClass
        ? 'architectureClass'
        : undefined,
      packageFact.boundedContext !== classification.boundedContext ? 'boundedContext' : undefined,
    ].filter((field): field is string => field !== undefined);
    if (mismatches.length > 0) {
      diagnostics.push(
        diagnostic({
          ruleId: RULE_IDS.metadataRequired,
          message: `Local package classification disagrees with package fact: ${classification.path}`,
          expectedBoundary:
            'The local configuration and normalized package fact must agree exactly',
          guidanceLocation: guidanceLocations.facts,
          source: packageFact.name,
          target: classification.path,
          facts: {mismatches, expected: {...classification}, actual: {...packageFact}},
        }),
      );
    }
  }
}

function evaluatePackageMetadata(
  packageFact: PackageFact,
  configuration: RepositoryConfiguration,
  diagnostics: PolicyDiagnostic[],
): void {
  if (!packageFact.policyParticipant) return;

  if (packageFact.realm === null || packageFact.architectureClass === null) {
    diagnostics.push(
      packageDiagnostic(
        RULE_IDS.metadataRequired,
        packageFact,
        'Participating packages must declare a realm and architecture class',
        'A package fact with valid realm and architectureClass metadata',
        {realm: packageFact.realm, architectureClass: packageFact.architectureClass},
      ),
    );
    return;
  }

  if (!configuration.realms[packageFact.realm]) {
    diagnostics.push(
      packageDiagnostic(
        RULE_IDS.realmDirection,
        packageFact,
        `Package ${packageFact.name} uses undeclared realm: ${packageFact.realm}`,
        'The package realm must be declared in repository configuration',
        {realm: packageFact.realm},
      ),
    );
  }

  const classConfiguration = configuration.architectureClasses[packageFact.architectureClass];
  const relationshipRow = configuration.classRelationships[packageFact.architectureClass];
  if (!classConfiguration || !relationshipRow) {
    diagnostics.push(
      packageDiagnostic(
        RULE_IDS.unknownClass,
        packageFact,
        `Unknown architecture class: ${packageFact.architectureClass}`,
        'Declare the class and every relationship before enabling it',
        {architectureClass: packageFact.architectureClass},
      ),
    );
    return;
  }

  if (classConfiguration.requiresBoundedContext && packageFact.boundedContext === null) {
    diagnostics.push(
      packageDiagnostic(
        RULE_IDS.metadataRequired,
        packageFact,
        `Package ${packageFact.name} is missing its bounded context`,
        'A participating class that requires context must declare boundedContext',
        {
          architectureClass: packageFact.architectureClass,
          boundedContext: packageFact.boundedContext,
        },
      ),
    );
  }
}

function evaluateImportEdge(
  edge: ArchitectureFacts['importEdges'][number],
  packageMap: ReadonlyMap<string, PackageFact>,
  configuration: RepositoryConfiguration,
  diagnostics: PolicyDiagnostic[],
): void {
  const sourcePackage = packageMap.get(edge.source);
  const targetPackage = packageMap.get(edge.target);
  if (!sourcePackage || !targetPackage) {
    missingPackageDiagnostic(edge.source, edge.target, packageMap, diagnostics, {
      sourceFile: edge.sourceFile,
      specifier: edge.specifier,
      importKind: edge.importKind,
    });
    return;
  }
  if (!sourcePackage.policyParticipant || !targetPackage.policyParticipant) return;
  evaluatePackageRelationship(
    sourcePackage,
    targetPackage,
    'import',
    {...edge},
    configuration,
    diagnostics,
  );
}

function evaluateManifestEdge(
  edge: ArchitectureFacts['manifestEdges'][number],
  packageMap: ReadonlyMap<string, PackageFact>,
  configuration: RepositoryConfiguration,
  diagnostics: PolicyDiagnostic[],
): void {
  const sourcePackage = packageMap.get(edge.source);
  const targetPackage = packageMap.get(edge.target);
  if (!sourcePackage || !targetPackage) {
    missingPackageDiagnostic(edge.source, edge.target, packageMap, diagnostics, {
      dependencyGroup: edge.dependencyGroup,
    });
    return;
  }
  if (!sourcePackage.policyParticipant || !targetPackage.policyParticipant) return;
  evaluatePackageRelationship(
    sourcePackage,
    targetPackage,
    'manifest',
    {...edge},
    configuration,
    diagnostics,
  );
}

function evaluatePackageRelationship(
  sourcePackage: PackageFact,
  targetPackage: PackageFact,
  edgeKind: 'import' | 'manifest',
  edge: Record<string, JsonValue>,
  configuration: RepositoryConfiguration,
  diagnostics: PolicyDiagnostic[],
): void {
  if (sourcePackage.realm === null || targetPackage.realm === null) return;
  const sourceRealm = configuration.realms[sourcePackage.realm];
  if (!sourceRealm?.mayDependOn.includes(targetPackage.realm)) {
    diagnostics.push(
      relationshipDiagnostic(
        RULE_IDS.realmDirection,
        sourcePackage,
        targetPackage,
        `${capitalize(edgeKind)} edge crosses an undeclared realm boundary`,
        `Realm ${sourcePackage.realm} may depend only on: ${sourceRealm?.mayDependOn.join(', ') ?? 'none'}`,
        {edgeKind, ...edge},
      ),
    );
  }

  if (sourcePackage.architectureClass === null || targetPackage.architectureClass === null) return;
  const relationship =
    configuration.classRelationships[sourcePackage.architectureClass]?.[
      targetPackage.architectureClass
    ];
  if (!relationship) {
    diagnostics.push(
      relationshipDiagnostic(
        RULE_IDS.classRelationship,
        sourcePackage,
        targetPackage,
        `Missing architecture class decision for ${sourcePackage.architectureClass} -> ${targetPackage.architectureClass}`,
        'Declare an explicit allow, same-context, or never relationship',
        {edgeKind, ...edge},
      ),
    );
    return;
  }
  if (relationship.decision === 'allow') return;
  if (
    relationship.decision === 'same-context' &&
    sourcePackage.boundedContext !== null &&
    sourcePackage.boundedContext === targetPackage.boundedContext
  )
    return;

  const ruleId =
    edgeKind === 'manifest'
      ? RULE_IDS.manifestEdge
      : (relationship.ruleId ?? RULE_IDS.classRelationship);
  diagnostics.push(
    relationshipDiagnostic(
      ruleId,
      sourcePackage,
      targetPackage,
      `${capitalize(edgeKind)} edge violates ${sourcePackage.architectureClass} -> ${targetPackage.architectureClass}`,
      relationship.decision === 'same-context'
        ? 'The source and target packages must share a bounded context'
        : 'The source class must not depend on the target class',
      {edgeKind, decision: relationship.decision, ...edge},
    ),
  );
}

function evaluateExport(
  exportFact: PublicExportFact,
  packageMap: ReadonlyMap<string, PackageFact>,
  diagnostics: PolicyDiagnostic[],
): void {
  const packageFact = packageMap.get(exportFact.package);
  if (!packageFact) {
    missingPackageDiagnostic(exportFact.package, undefined, packageMap, diagnostics, {
      publicSubpath: exportFact.publicSubpath,
      resolvedTarget: exportFact.resolvedTarget,
    });
    return;
  }
  if (!packageFact.policyParticipant) return;
  if (
    (!exportFact.publicSubpath.startsWith('./') && exportFact.publicSubpath !== '.') ||
    exportFact.publicSubpath.includes('..') ||
    exportFact.resolvedTarget === null
  ) {
    diagnostics.push(
      diagnostic({
        ruleId: RULE_IDS.exportIntent,
        message: `Public export ${exportFact.package}:${exportFact.publicSubpath} has no valid resolved target`,
        expectedBoundary: 'Every public subpath must resolve to a source or declaration target',
        guidanceLocation: guidanceLocations.facts,
        source: exportFact.package,
        target: exportFact.publicSubpath,
        facts: {...exportFact},
      }),
    );
  }
}

function evaluateExportIntent(
  exports: PublicExportFact[],
  packageMap: ReadonlyMap<string, PackageFact>,
  configuration: RepositoryConfiguration,
  diagnostics: PolicyDiagnostic[],
): void {
  const actual = new Map<string, Set<string>>();
  for (const exportFact of exports) {
    const paths = actual.get(exportFact.package) ?? new Set<string>();
    paths.add(exportFact.publicSubpath);
    actual.set(exportFact.package, paths);
  }
  for (const [packageName, expectedSubpaths] of Object.entries(configuration.exportIntent)) {
    const packageFact = packageMap.get(packageName);
    if (!packageFact?.policyParticipant) continue;
    for (const publicSubpath of expectedSubpaths) {
      if (actual.get(packageName)?.has(publicSubpath)) continue;
      diagnostics.push(
        diagnostic({
          ruleId: RULE_IDS.exportIntent,
          message: `Public export intent is missing: ${packageName}:${publicSubpath}`,
          expectedBoundary:
            'The configured public export intent must be present in normalized export facts',
          guidanceLocation: guidanceLocations.facts,
          source: packageName,
          target: publicSubpath,
          facts: {package: packageName, publicSubpath},
        }),
      );
    }
  }
}

function evaluateComposition(
  fact: CompositionFact,
  packageMap: ReadonlyMap<string, PackageFact>,
  configuration: RepositoryConfiguration,
  diagnostics: PolicyDiagnostic[],
): void {
  const owners = [
    ['declaringOwner', fact.declaringOwner],
    ['contributionOwner', fact.contributionOwner],
    ['targetOwner', fact.targetOwner],
    ['explicitCoordinator', fact.explicitCoordinator],
  ] as const;
  for (const [field, owner] of owners) {
    if (typeof owner === 'string' && owner.length > 0 && packageMap.get(owner)?.policyParticipant)
      continue;
    diagnostics.push(
      diagnostic({
        ruleId: RULE_IDS.compositionOwner,
        message: `Composition fact has an invalid ${field}: ${String(owner)}`,
        expectedBoundary:
          'Composition must name participating package owners and an explicit coordinator',
        guidanceLocation: guidanceLocations.composition,
        ...(fact.declaringOwner ? {source: fact.declaringOwner} : {}),
        ...(fact.targetOwner ? {target: fact.targetOwner} : {}),
        facts: {...fact, invalidField: field},
      }),
    );
  }
  if (fact.declaringOwner && configuration.compositionRoots.length > 0) {
    if (!configuration.compositionRoots.includes(fact.declaringOwner)) {
      diagnostics.push(
        diagnostic({
          ruleId: RULE_IDS.compositionOwner,
          message: `Composition is declared by a non-root package: ${fact.declaringOwner}`,
          expectedBoundary: `Composition must be declared by one of: ${configuration.compositionRoots.join(', ')}`,
          guidanceLocation: guidanceLocations.composition,
          source: fact.declaringOwner,
          ...(fact.targetOwner ? {target: fact.targetOwner} : {}),
          facts: {...fact},
        }),
      );
    }
  }
}

function evaluateExceptions(
  exceptions: readonly ExactException[],
  options: PolicyEvaluationOptions,
  diagnostics: PolicyDiagnostic[],
): void {
  const now = resolveNow(options.now);
  for (const exception of exceptions) {
    if (exception.expiresAt !== null && Date.parse(exception.expiresAt) <= now.getTime()) {
      diagnostics.push(
        diagnostic({
          ruleId: RULE_IDS.exceptionValidity,
          message: `Exception ${exception.ruleId}:${exception.source}->${exception.target} is expired`,
          expectedBoundary: 'Temporary exceptions must be removed or renewed before expiry',
          guidanceLocation: guidanceLocations.exceptions,
          source: exception.source,
          target: exception.target,
          facts: {...exception},
        }),
      );
    }
  }
}

function applyExactExceptions(
  diagnostics: PolicyDiagnostic[],
  exceptions: readonly ExactException[],
  options: PolicyEvaluationOptions,
): PolicyDiagnostic[] {
  const now = resolveNow(options.now);
  const consumedExceptionIndexes = new Set<number>();
  return diagnostics.filter((diagnosticEntry) => {
    if (!diagnosticEntry.source || !diagnosticEntry.target) return true;
    const matchingExceptionIndex = exceptions.findIndex((exception, index) => {
      if (consumedExceptionIndexes.has(index)) return false;
      if (exception.ruleId !== diagnosticEntry.ruleId) return false;
      if (
        exception.source !== diagnosticEntry.source ||
        exception.target !== diagnosticEntry.target
      )
        return false;
      return exception.expiresAt === null || Date.parse(exception.expiresAt) > now.getTime();
    });
    if (matchingExceptionIndex === -1) return true;
    consumedExceptionIndexes.add(matchingExceptionIndex);
    return false;
  });
}

function missingPackageDiagnostic(
  source: string,
  target: string | undefined,
  packageMap: ReadonlyMap<string, PackageFact>,
  diagnostics: PolicyDiagnostic[],
  facts: Record<string, JsonValue>,
): void {
  const packageNames = target === undefined ? [source] : [source, target];
  const missing = packageNames.filter((packageName) => !packageMap.has(packageName));
  if (missing.length === 0) return;
  diagnostics.push(
    diagnostic({
      ruleId: RULE_IDS.factReference,
      message: `Architecture fact references unknown package: ${missing.join(', ')}`,
      expectedBoundary: 'Every policy edge must reference a package fact in the same document',
      guidanceLocation: guidanceLocations.facts,
      source,
      ...(target ? {target} : {}),
      facts: {missingPackages: missing, ...facts},
    }),
  );
}

function relationshipDiagnostic(
  ruleId: string,
  sourcePackage: PackageFact,
  targetPackage: PackageFact,
  message: string,
  expectedBoundary: string,
  facts: Record<string, JsonValue>,
): PolicyDiagnostic {
  return diagnostic({
    ruleId,
    message,
    expectedBoundary,
    guidanceLocation: relationshipGuidanceLocation(ruleId),
    source: sourcePackage.name,
    target: targetPackage.name,
    facts: {
      sourcePackage: sourcePackage.name,
      sourceRealm: sourcePackage.realm,
      sourceClass: sourcePackage.architectureClass,
      sourceContext: sourcePackage.boundedContext,
      targetPackage: targetPackage.name,
      targetRealm: targetPackage.realm,
      targetClass: targetPackage.architectureClass,
      targetContext: targetPackage.boundedContext,
      ...facts,
    },
  });
}

function packageDiagnostic(
  ruleId: string,
  packageFact: PackageFact,
  message: string,
  expectedBoundary: string,
  facts: Record<string, JsonValue>,
): PolicyDiagnostic {
  return diagnostic({
    ruleId,
    message,
    expectedBoundary,
    guidanceLocation:
      ruleId === RULE_IDS.unknownClass ? guidanceLocations.facts : guidanceLocations.realms,
    source: packageFact.name,
    facts: {package: packageFact.name, path: packageFact.path, ...facts},
  });
}

function diagnostic({
  ruleId,
  message,
  expectedBoundary,
  guidanceLocation,
  facts,
  source,
  target,
}: {
  ruleId: string;
  message: string;
  expectedBoundary: string;
  guidanceLocation: string;
  facts: Record<string, JsonValue>;
  source?: string;
  target?: string;
}): PolicyDiagnostic {
  return {
    blocking: true,
    ruleId,
    message,
    expectedBoundary,
    guidanceLocation,
    facts,
    ...(source ? {source} : {}),
    ...(target ? {target} : {}),
  };
}

function resolveNow(now: Date | string | undefined): Date {
  if (now instanceof Date) return now;
  if (typeof now === 'string') return new Date(now);
  return new Date();
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

// Keep the public module's dependency on the catalog visible to API-shape checks.
export {RULE_CATALOG};

// This assertion prevents accidental changes to the serialized contract's version.
export const policySchemaVersion = architecturePolicySchemaVersion;

// Ensure the imported relationship type remains part of the source contract for adapters.
export type {BoundaryDecision, ClassRelationship};
