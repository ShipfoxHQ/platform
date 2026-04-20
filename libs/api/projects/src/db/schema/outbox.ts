import {createOutboxTable} from '@shipfox/node-outbox';
import {pgTable} from './common.js';

export const projectsOutbox = createOutboxTable(pgTable);
