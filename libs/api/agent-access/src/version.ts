import {createRequire} from 'node:module';

const {version} = createRequire(import.meta.url)('../package.json') as {version: string};

export const AGENT_ACCESS_PACKAGE_VERSION = version;
