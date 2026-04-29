import {preflightCheck} from '@shipfox/e2e-core';

export default async function globalSetup(): Promise<void> {
  await preflightCheck();
}
