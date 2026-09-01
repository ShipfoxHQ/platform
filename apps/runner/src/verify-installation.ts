import {createRequire} from 'node:module';
import {assertPiHarnessExtensionsAvailable} from '@shipfox/runner-agent/pi-extensions';
import {assertPiImageRasterizerAvailable} from '@shipfox/runner-agent/pi-image-rasterizer';

const require = createRequire(import.meta.url);
const RUNNER_AGENT_RUNTIME_EXPORTS = [
  '@shipfox/runner-agent/pi-image-rasterizer',
  '@shipfox/runner-agent/tool-capabilities',
  '@shipfox/runner-agent/step',
] as const;

for (const specifier of RUNNER_AGENT_RUNTIME_EXPORTS) {
  try {
    require.resolve(specifier);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to resolve runner agent export "${specifier}": ${reason}`);
  }
}

// Runs during the container and AMI image builds, against the deployed production closure rather
// than the pnpm development tree. Imports the leaf module, not a package barrel: the runner barrels
// validate the runtime environment at module load, which no image build can satisfy. A throw prints
// the offending package and exits nonzero, which is the whole contract here.
assertPiHarnessExtensionsAvailable();
await assertPiImageRasterizerAvailable();
