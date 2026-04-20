import {createOutboxTable} from '@shipfox/node-outbox';
import {pgTable} from './common.js';

export const runnersOutbox = createOutboxTable(pgTable);
