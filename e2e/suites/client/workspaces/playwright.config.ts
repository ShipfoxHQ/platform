import {defineClientE2eConfig} from '@shipfox/e2e-kit/config';

// The onboarding journey walks workspace creation, a Gitea install, harness
// selection, the first project, and the setup checklist in one test. Its own
// step budgets (SETUP_NAVIGATION_TIMEOUT_MS) already reach 15s each, so the
// 30s default leaves no room for CI scheduling noise.
export default defineClientE2eConfig({buildName: 'e2e-client-workspaces', timeout: 90_000});
