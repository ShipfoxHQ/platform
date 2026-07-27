#! /usr/bin/env node

import {runVitest} from './run-vitest.js';

runVitest(['run', ...process.argv.slice(2)]);
