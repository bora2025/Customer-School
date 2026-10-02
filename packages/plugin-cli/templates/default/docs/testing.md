# Testing and certification

Before packaging:

1. Run `wattanam-plugin check .`.
2. Test activation with `createTestContext()` from `@wattanam/plugin-sdk`.
3. Test every declared permission and route error contract.
4. Test migration retry, reconciliation, disable, reinstall and recovery.
5. Run the platform lifecycle, recovery and hostile-package certification suites.
