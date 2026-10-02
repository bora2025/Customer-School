-- CreateTable
CREATE TABLE "PluginInstallation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "publisher" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'installed',
    "manifestJson" TEXT NOT NULL,
    "packageSha256" TEXT NOT NULL,
    "installedPath" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,

    CONSTRAINT "PluginInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PluginInstallation_status_idx" ON "PluginInstallation"("status");

-- CreateIndex
CREATE INDEX "PluginInstallation_publisher_idx" ON "PluginInstallation"("publisher");
