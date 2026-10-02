// Manual Jest mock for @nestjs/schedule.
//
// @nestjs/schedule 12.x ships as an ESM-only package (`export * from './enums/index.js'`),
// which Node's own `require()` handles fine on Node 22.12+/24.x via native `require(esm)`
// support (verified: `node -e "require('@nestjs/schedule')"` succeeds), but Jest's
// CommonJS-only module transform cannot parse the raw `export`/`import` syntax, so any spec
// that transitively imports a file using `@Cron`/`ScheduleModule` fails with
// "SyntaxError: Unexpected token 'export'". This mock provides faithful, side-effect-free
// stand-ins for the only three symbols this codebase actually imports from the package
// (`ScheduleModule`, `Cron`, `CronExpression` — see the grep in the A-009 upgrade notes),
// so unit tests exercise the real decorated method bodies without needing a real scheduler.
class ScheduleModule {
  static forRoot() {
    return { module: ScheduleModule, global: true, providers: [], exports: [] };
  }
}

function Cron() {
  return function () {};
}

const CronExpression = {
  EVERY_DAY_AT_7AM: '0 07 * * *',
};

module.exports = { ScheduleModule, Cron, CronExpression };
