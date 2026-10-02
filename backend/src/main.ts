import { AppModule } from './app.module';
import { readApiStartupConfig } from './config/startup-config';
import { bootstrapApi } from './bootstrap-api';

async function bootstrap() {
  const config = readApiStartupConfig();
  await bootstrapApi(AppModule.register(config.distribution));
}
bootstrap().catch((error) => {
  console.error('API startup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
