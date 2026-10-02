import { AppCoreModule } from './app-core.module';
import { bootstrapApi } from './bootstrap-api';
import { getDistribution } from './config/environment';

if (getDistribution() !== 'core') {
  throw new Error('The physical lean-core artifact requires WATTANAM_DISTRIBUTION=core');
}

bootstrapApi(AppCoreModule.register()).catch((error) => {
  console.error('Core API startup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});

