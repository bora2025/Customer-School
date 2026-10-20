import { defineRailway, image, postgres, preserve, project, service, volume } from "railway/iac";

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
  PLUGIN_REQUIRED_RUNTIME_ROLES: preserve(), PLUGIN_STORAGE_PROVIDER: preserve(), PLUGIN_STORAGE_S3_ACCESS_KEY_ID: preserve(),
  PLUGIN_STORAGE_S3_BUCKET: preserve(), PLUGIN_STORAGE_S3_ENDPOINT: preserve(), PLUGIN_STORAGE_S3_FORCE_PATH_STYLE: preserve(),
  PLUGIN_STORAGE_S3_PREFIX: preserve(), PLUGIN_STORAGE_S3_REGION: preserve(), PLUGIN_STORAGE_S3_SECRET_ACCESS_KEY: preserve(),
  PROCESS_ROLE: preserve(), RAILWAY_DOCKERFILE_PATH: preserve(), UPDATE_CHANNEL: preserve(), UPDATE_REPOSITORY_KEY_ID: preserve(), UPDATE_REPOSITORY_PUBLIC_KEY: preserve(),
  UPDATE_REPOSITORY_PUBLIC_KEYS_JSON: preserve(), WATTANAM_DISTRIBUTION: preserve(),
};

export default defineRailway(() => {
  const backendRelease = releaseImage("API_IMAGE");
  const webRelease = releaseImage("WEB_IMAGE");
  const gatewayRelease = releaseImage("GATEWAY_IMAGE");

  const Postgres = postgres("Postgres", { region: "asia-southeast1-eqsg3a" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
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
    env: { ...sharedBackendEnvironment, PORT: preserve(), PUBLIC_APP_URL: preserve() },
  });
  const worker = service("worker", {
    source: backendRelease,
    replicas: { "asia-southeast1-eqsg3a": 1 },
    volumeMounts: { "/data": workerVolume },
    env: { ...sharedBackendEnvironment, WORKER_PORT: preserve() },
  });
  const gateway = service("gateway", {
    source: gatewayRelease,
    replicas: { "asia-southeast1-eqsg3a": 1 },
    env: { API_UPSTREAM: preserve(), DNS_RESOLVER: preserve(), RAILWAY_DOCKERFILE_PATH: preserve(), WEB_UPSTREAM: preserve() },
  });

  return project("customer-school", {
    resources: [web, api, worker, Postgres, gateway, apiVolume, workerVolume, postgresVolume],
  });
});
