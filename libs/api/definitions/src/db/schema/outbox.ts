import {createOutboxTable} from '@shipfox/node-outbox';
import {pgTable} from './common.js';

export const definitionsOutbox = createOutboxTable(pgTable);
