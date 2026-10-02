CREATE TABLE "PluginEntitlementCache" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "tokenId" TEXT,
    "signedTokenJson" TEXT,
    "expiresAt" TIMESTAMP(3),
    "updatesThrough" TIMESTAMP(3),
    "offlineRecheckAfter" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "lastRefreshAttemptAt" TIMESTAMP(3),
    "lastRefreshSucceededAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PluginEntitlementCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PluginEntitlementCache_pluginId_key" ON "PluginEntitlementCache"("pluginId");
