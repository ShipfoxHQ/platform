import {appendFileSync} from 'node:fs';

const HEAVY_AGENT_PACKAGE_PATTERN =
  /\/node_modules\/(?:@anthropic-ai|@earendil-works|@modelcontextprotocol)(?:\/|\+)/u;

export function load(url, context, nextLoad) {
  if (
    process.env.SHIPFOX_MODULE_TRACKER_FILE !== undefined &&
    HEAVY_AGENT_PACKAGE_PATTERN.test(url)
  ) {
    appendFileSync(process.env.SHIPFOX_MODULE_TRACKER_FILE, `${url}\n`);
  }

  return nextLoad(url, context);
}
