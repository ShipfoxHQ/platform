import process from 'node:process';
import {fileURLToPath} from 'node:url';
import type {PolicyDiagnostic} from '@shipfox/architecture-policy';
import {
  apiContextPackagePaths,
  discoverPlatformArchitecturePolicy,
  evaluatePlatformArchitecturePolicy,
} from './platform-architecture-policy.js';

export {
  apiContextPackagePaths,
  discoverPlatformArchitecturePolicy,
  evaluatePlatformArchitecturePolicy,
};

/**
 * Compatibility helper for callers that need to compare discovered package
 * paths with the local registry. Policy evaluation itself uses normalized
 * facts and the shared evaluator.
 */
export function auditApiContextInventory(packagePaths: readonly string[]): string[] {
  const configured = new Set(apiContextPackagePaths());
  const discovered = new Set(packagePaths);
  const errors = [
    ...[...discovered]
      .filter((packagePath) => !configured.has(packagePath))
      .map((packagePath) => `Unclassified server package: ${packagePath}`),
    ...[...configured]
      .filter((packagePath) => !discovered.has(packagePath))
      .map((packagePath) => `Classified server package does not exist: ${packagePath}`),
  ];
  return errors.sort();
}

export function auditRepository(): Promise<PolicyDiagnostic[]> {
  return evaluatePlatformArchitecturePolicy();
}

function formatDiagnostic(diagnostic: PolicyDiagnostic): string {
  const location = diagnostic.source
    ? `${diagnostic.source}${diagnostic.target ? ` -> ${diagnostic.target}` : ''}`
    : '';
  return [diagnostic.ruleId, location, diagnostic.message].filter(Boolean).join(': ');
}

async function main(): Promise<void> {
  const diagnostics = await auditRepository();
  if (diagnostics.length === 0) {
    process.stdout.write('API architecture policy passed\n');
    return;
  }
  process.stderr.write(`API architecture policy failed (${diagnostics.length} errors)\n`);
  for (const diagnostic of diagnostics) process.stderr.write(`- ${formatDiagnostic(diagnostic)}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`API architecture policy failed: ${message}\n`);
    process.exitCode = 1;
  });
}
