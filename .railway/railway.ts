import { defineRailway, github, postgres, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const CustomerSchool = github("bora2025/Customer-School");

  const Postgres = postgres("Postgres", { region: "asia-southeast1-eqsg3a" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const apiVolume = volume("api-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "asia-southeast1-eqsg3a", sizeMB: 50000 });
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "asia-southeast1-eqsg3a", sizeMB: 50000 });
  const web = service("web", {
    source: CustomerSchool,
    replicas: { "asia-southeast1-eqsg3a": 1 },
    env: { API_URL: preserve(), MARKETPLACE_URL: preserve(), NEXT_PUBLIC_API_URL: preserve(), NEXT_PUBLIC_WATTANAM_DISTRIBUTION: preserve(), NODE_ENV: preserve(), PORT: preserve(), RAILWAY_DOCKERFILE_PATH: preserve(), WATTANAM_DISTRIBUTION: preserve() },
  });
  const api = service("api", {
    source: CustomerSchool,
    replicas: { "asia-southeast1-eqsg3a": 1 },
    volumeMounts: { "/data": apiVolume },
    env: { BACKUP_DIR: preserve(), COOKIE_SECURE: preserve(), CORS_ORIGINS: preserve(), DATABASE_URL: preserve(), ENTITLEMENT_KEY_ID: preserve(), ENTITLEMENT_PUBLIC_KEY: preserve(), JWT_SECRET: preserve(), MARKETPLACE_REQUEST_TIMEOUT_MS: preserve(), MARKETPLACE_URL: preserve(), NODE_ENV: preserve(), PLUGIN_DATA_DIR: preserve(), PLUGIN_DIR: preserve(), PORT: preserve(), PUBLIC_APP_URL: preserve(), RAILWAY_DOCKERFILE_PATH: preserve(), UPDATE_REPOSITORY_KEY_ID: preserve(), UPDATE_REPOSITORY_PUBLIC_KEY: preserve(), WATTANAM_DISTRIBUTION: preserve() },
  });
  const gateway = service("gateway", {
    source: CustomerSchool,
    replicas: { "asia-southeast1-eqsg3a": 1 },
    env: { API_UPSTREAM: preserve(), DNS_RESOLVER: preserve(), RAILWAY_DOCKERFILE_PATH: preserve(), WEB_UPSTREAM: preserve() },
  });

  return project("customer-school", {
    resources: [web, api, Postgres, gateway, apiVolume, postgresVolume],
  });
});
