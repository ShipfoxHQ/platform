import {assertPiHarnessExtensionsAvailable} from '@shipfox/runner-agent/pi-extensions';

// Runs during the container and AMI image builds, against the deployed production closure rather
// than the pnpm development tree. Imports the leaf module, not a package barrel: the runner barrels
// validate the runtime environment at module load, which no image build can satisfy. A throw prints
// the offending package and exits nonzero, which is the whole contract here.
assertPiHarnessExtensionsAvailable();
