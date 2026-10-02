'use strict';

const RESULT_PREFIX = 'WATTANAM_PLAYWRIGHT_RESULT=';

class PluginUiResultReporter {
  onEnd(result) {
    process.stdout.write(`${RESULT_PREFIX}${result.status}\n`);
  }
}

module.exports = PluginUiResultReporter;
module.exports.RESULT_PREFIX = RESULT_PREFIX;
