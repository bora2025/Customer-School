CREATE TABLE "PluginPermissionGrant" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PluginPermissionGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PluginPermissionGrant_pluginId_permissionId_role_key" ON "PluginPermissionGrant"("pluginId", "permissionId", "role");
CREATE INDEX "PluginPermissionGrant_pluginId_permissionId_idx" ON "PluginPermissionGrant"("pluginId", "permissionId");
