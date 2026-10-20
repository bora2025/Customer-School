import { bucket, defineRailway, image, postgres, preserve, project, ref, service, volume } from "railway/iac";

function releaseImage(name: string): ReturnType<typeof image> {
  const value = process.env[name]?.trim();
  if (!value || !/^ghcr\.io\/.+@sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be a digest-pinned GHCR image from the signed core release blueprint`);
  }
  return image(value);
}

const sharedBackendEnvironment = {
  APP_VERSION: preserve(), BACKUP_DIR: preserve(), COOKIE_SECURE: preserve(), CORS_ORIGINS: preserve(), DATABASE_URL: preserve(),
  ENTITLEMENT_KEY_ID: preserve(), ENTITLEMENT_PUBLIC_KEY: preserve(), ENTITLEMENT_SECONDARY_PUBLIC_KEYS_JSON: preserve(),
  GIT_COMMIT: preserve(), INSTALLATION_KEY_DIR: preserve(), JWT_KEY_ID: preserve(), JWT_SECRET: preserve(), JWT_SECONDARY_SECRETS_JSON: preserve(),
  MARKETPLACE_REQUEST_TIMEOUT_MS: preserve(), MARKETPLACE_URL: preserve(), NODE_ENV: preserve(), PLUGIN_DATA_DIR: preserve(), PLUGIN_DIR: preserve(),
  PLUGIN_EVENT_MAX_BYTES: preserve(), PLUGIN_JOB_DRAIN_TIMEOUT_MS: preserve(), PLUGIN_JOB_QUOTA_PER_PLUGIN: preserve(),
  PLUGIN_MIGRATION_LOCK_TIMEOUT_MS: preserve(), PLUGIN_MIGRATION_STATEMENT_TIMEOUT_MS: preserve(), PLUGIN_NOTIFICATION_DAILY_LIMIT: preserve(),
  PLUGIN_READ_MODEL_MAX_BYTES: preserve(), PLUGIN_REALTIME_QUOTA_PER_MINUTE: preserve(), PLUGIN_REQUEST_QUOTA_PER_MINUTE: preserve(),
  PLUGIN_REQUIRED_RUNTIME_ROLES: preserve(), PLUGIN_STORAGE_PROVIDER: preserve(), PLUGIN_STORAGE_S3_ACCESS_KEY_ID: preserve(),
  PLUGIN_REVOKED_PUBLISHER_KEYS_JSON: preserve(),
  PLUGIN_SQL_LOCK_TIMEOUT_MS: preserve(), PLUGIN_SQL_QUOTA_PER_MINUTE: preserve(), PLUGIN_SQL_STATEMENT_TIMEOUT_MS: preserve(),
  PLUGIN_STORAGE_MAX_FILE_BYTES: preserve(), PLUGIN_STORAGE_MAX_TOTAL_BYTES: preserve(),
  PLUGIN_STORAGE_S3_BUCKET: preserve(), PLUGIN_STORAGE_S3_ENDPOINT: preserve(), PLUGIN_STORAGE_S3_FORCE_PATH_STYLE: preserve(),
  PLUGIN_STORAGE_S3_PREFIX: preserve(), PLUGIN_STORAGE_S3_REGION: preserve(), PLUGIN_STORAGE_S3_SECRET_ACCESS_KEY: preserve(),
  PROCESS_ROLE: preserve(), RAILWAY_DOCKERFILE_PATH: preserve(), UPDATE_CHANNEL: preserve(), UPDATE_REPOSITORY_KEY_ID: preserve(), UPDATE_REPOSITORY_PUBLIC_KEY: preserve(),
  UPDATE_REPOSITORY_PUBLIC_KEYS_JSON: preserve(), WATTANAM_DISTRIBUTION: preserve(), RECOVERY_DRILL_DATABASE_URL: preserve(), RECOVERY_DRILL_CONFIRM_TARGET: preserve(),
};

export default defineRailway(() => {
  const backendRelease = releaseImage("API_IMAGE");
  const webRelease = releaseImage("WEB_IMAGE");
  const gatewayRelease = releaseImage("GATEWAY_IMAGE");

  const Postgres = postgres("Postgres", { region: "asia-southeast1-eqsg3a" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const pluginArtifacts = bucket("plugin-artifacts", { region: "sin" });
  const splitRuntimeEnvironment = {
    DATABASE_URL: ref(Postgres, "DATABASE_URL"),
    PLUGIN_REQUIRED_RUNTIME_ROLES: "api,worker",
    PLUGIN_STORAGE_PROVIDER: "s3",
    PLUGIN_STORAGE_S3_ACCESS_KEY_ID: ref(pluginArtifacts, "ACCESS_KEY_ID"),
    PLUGIN_STORAGE_S3_BUCKET: ref(pluginArtifacts, "BUCKET"),
    PLUGIN_STORAGE_S3_ENDPOINT: ref(pluginArtifacts, "ENDPOINT"),
    PLUGIN_STORAGE_S3_FORCE_PATH_STYLE: "false",
    PLUGIN_STORAGE_S3_PREFIX: "plugin-data",
    PLUGIN_STORAGE_S3_REGION: ref(pluginArtifacts, "REGION"),
    PLUGIN_STORAGE_S3_SECRET_ACCESS_KEY: ref(pluginArtifacts, "SECRET_ACCESS_KEY"),
    WATTANAM_DISTRIBUTION: "core",
  };
  const apiVolume = volume("api-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "asia-southeast1-eqsg3a", sizeMB: 50000 });
  const workerVolume = volume("worker-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "asia-southeast1-eqsg3a", sizeMB: 50000 });
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "asia-southeast1-eqsg3a", sizeMB: 50000 });
  const web = service("web", {
    source: webRelease,
    replicas: { "asia-southeast1-eqsg3a": 1 },
    env: { API_URL: preserve(), MARKETPLACE_URL: preserve(), NEXT_PUBLIC_API_URL: preserve(), NEXT_PUBLIC_WATTANAM_DISTRIBUTION: preserve(), NODE_ENV: preserve(), PORT: preserve(), RAILWAY_DOCKERFILE_PATH: preserve(), WATTANAM_DISTRIBUTION: preserve() },
  });
  const api = service("api", {
    source: backendRelease,
    replicas: { "asia-southeast1-eqsg3a": 1 },
    volumeMounts: { "/data": apiVolume },
    env: { ...sharedBackendEnvironment, ...splitRuntimeEnvironment, MIGRATION_DATABASE_URL: preserve(), PROCESS_ROLE: "api", PORT: preserve(), PUBLIC_APP_URL: preserve() },
  });
  const worker = service("worker", {
    source: backendRelease,
    replicas: { "asia-southeast1-eqsg3a": 1 },
    volumeMounts: { "/data": workerVolume },
    env: { ...sharedBackendEnvironment, ...splitRuntimeEnvironment, PROCESS_ROLE: "worker", WORKER_PORT: "3002" },
  });
  const gateway = service("gateway", {
    source: gatewayRelease,
    replicas: { "asia-southeast1-eqsg3a": 1 },
    env: { API_UPSTREAM: preserve(), DNS_RESOLVER: preserve(), RAILWAY_DOCKERFILE_PATH: preserve(), WEB_UPSTREAM: preserve() },
  });

  return project("customer-school", {
    resources: [web, api, worker, Postgres, gateway, pluginArtifacts, apiVolume, workerVolume, postgresVolume],
  });
});
