const {appendFileSync} = require('node:fs');
const Module = require('node:module');

const originalLoad = Module._load;

Module._load = function trackCommonJsLoad(request, parent, isMain) {
  let resolved = request;
  try {
    resolved = Module._resolveFilename(request, parent, isMain);
  } catch {
    resolved = request;
  }

  if (process.env.SHIPFOX_MODULE_TRACKER_FILE !== undefined) {
    appendFileSync(process.env.SHIPFOX_MODULE_TRACKER_FILE, `${resolved}\n`);
  }

  return originalLoad.call(this, request, parent, isMain);
};
