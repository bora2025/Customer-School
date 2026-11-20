-- CreateTable
CREATE TABLE "PluginDeviceCredential" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PluginDeviceCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PluginDeviceCredential_tokenHash_key" ON "PluginDeviceCredential"("tokenHash");

-- CreateIndex
CREATE INDEX "PluginDeviceCredential_pluginId_idx" ON "PluginDeviceCredential"("pluginId");
