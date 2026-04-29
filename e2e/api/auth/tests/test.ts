import {test as base, expect} from '@shipfox/e2e-core/playwright';
import {type AuthFixtures, authHelper} from '@shipfox/e2e-helper-auth';

export const test = base.extend<AuthFixtures>(authHelper);
export {expect};
