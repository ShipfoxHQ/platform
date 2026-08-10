import {appendFileSync} from 'node:fs';

export function load(url, context, nextLoad) {
  if (process.env.SHIPFOX_MODULE_TRACKER_FILE !== undefined) {
    appendFileSync(process.env.SHIPFOX_MODULE_TRACKER_FILE, `${url}\n`);
  }

  return nextLoad(url, context);
}
