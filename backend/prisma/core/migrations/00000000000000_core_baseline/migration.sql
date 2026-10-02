-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "phoneNormalized" TEXT,
    "photo" TEXT,
    "role" TEXT NOT NULL,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecretEncrypted" TEXT,
    "mfaRecoveryCodes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "token" TEXT,
    "tokenHash" TEXT,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorRole" TEXT,
    "actorName" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "resourceLabel" TEXT,
    "changes" JSONB,
    "metadata" JSONB,
    "method" TEXT,
    "path" TEXT,
    "statusCode" INTEGER,
    "ip" TEXT,
    "userAgent" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditCleanupSchedule" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "retainDays" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastDeletedCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AuditCleanupSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "announcementsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "messagesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "digestFrequency" TEXT NOT NULL DEFAULT 'NONE',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installation" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "installationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'installed',
    "schoolName" TEXT NOT NULL,
    "schoolSlug" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "coreVersion" TEXT NOT NULL,
    "acceptedLicenseVersion" TEXT,
    "acceptedLicenseAt" TIMESTAMP(3),
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Installation_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "MarketplaceRegistration" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "installationId" TEXT NOT NULL,
    "keyFingerprint" TEXT NOT NULL,
    "accountId" TEXT,
    "label" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceSchoolControl" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "access" TEXT NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "warningsJson" TEXT NOT NULL DEFAULT '[]',
    "billingJson" TEXT NOT NULL DEFAULT '{}',
    "lastVerifiedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceSchoolControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplacePendingLink" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "requestId" TEXT NOT NULL,
    "scope" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplacePendingLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceProxyLink" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "grantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountEmailMasked" TEXT,
    "scope" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sessionExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceProxyLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginPermissionGrant" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PluginPermissionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginNotificationUsage" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluginNotificationUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginMigration" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "migrationId" TEXT NOT NULL,
    "pluginVersion" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "destructive" BOOLEAN NOT NULL DEFAULT false,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PluginMigration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginSetting" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluginSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginJobDefinition" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "intervalSeconds" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastStartedAt" TIMESTAMP(3),
    "lastCompletedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluginJobDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginJobRun" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "PluginJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "SiteSetting" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "siteName" TEXT NOT NULL DEFAULT 'Wattaman',
    "siteTagline" TEXT NOT NULL DEFAULT 'Smart School Management',
    "logoUrl" TEXT NOT NULL DEFAULT '',
    "heroSlides" TEXT NOT NULL DEFAULT '[]',
    "footerAddress" TEXT NOT NULL DEFAULT '',
    "footerPhone" TEXT NOT NULL DEFAULT '',
    "footerEmail" TEXT NOT NULL DEFAULT '',
    "footerFacebook" TEXT NOT NULL DEFAULT '',
    "footerInstagram" TEXT NOT NULL DEFAULT '',
    "footerTwitter" TEXT NOT NULL DEFAULT '',
    "footerYoutube" TEXT NOT NULL DEFAULT '',
    "footerCopyright" TEXT NOT NULL DEFAULT '',
    "primaryColor" TEXT NOT NULL DEFAULT '#4f46e5',
    "customCss" TEXT NOT NULL DEFAULT '',
    "aboutBadge" TEXT NOT NULL DEFAULT 'About Us',
    "aboutTitle" TEXT NOT NULL DEFAULT 'A Smarter Way to Manage Your School',
    "aboutDescription" TEXT NOT NULL DEFAULT '',
    "aboutImageUrl" TEXT NOT NULL DEFAULT '',
    "aboutFeatures" TEXT NOT NULL DEFAULT '[]',
    "aboutCtaLabel" TEXT NOT NULL DEFAULT 'Get Started Today',
    "aboutCtaHref" TEXT NOT NULL DEFAULT '/login',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneNormalized_key" ON "User"("phoneNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_revokedAt_idx" ON "RefreshToken"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_consumedAt_idx" ON "PasswordResetToken"("userId", "consumedAt");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_resource_resourceId_createdAt_idx" ON "AuditLog"("resource", "resourceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditCleanupSchedule_enabled_idx" ON "AuditCleanupSchedule"("enabled");

-- CreateIndex
CREATE INDEX "Notification_userId_sentAt_idx" ON "Notification"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "Notification_sentAt_idx" ON "Notification"("sentAt");

-- CreateIndex
CREATE INDEX "Notification_readAt_idx" ON "Notification"("readAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Installation_installationId_key" ON "Installation"("installationId");

-- CreateIndex
CREATE UNIQUE INDEX "Installation_schoolSlug_key" ON "Installation"("schoolSlug");

-- CreateIndex
CREATE INDEX "PluginInstallation_status_idx" ON "PluginInstallation"("status");

-- CreateIndex
CREATE INDEX "PluginInstallation_publisher_idx" ON "PluginInstallation"("publisher");

-- CreateIndex
CREATE INDEX "PluginPermissionGrant_pluginId_permissionId_idx" ON "PluginPermissionGrant"("pluginId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "PluginPermissionGrant_pluginId_permissionId_role_key" ON "PluginPermissionGrant"("pluginId", "permissionId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "PluginNotificationUsage_pluginId_windowStart_key" ON "PluginNotificationUsage"("pluginId", "windowStart");

-- CreateIndex
CREATE INDEX "PluginMigration_pluginId_appliedAt_idx" ON "PluginMigration"("pluginId", "appliedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PluginMigration_pluginId_migrationId_key" ON "PluginMigration"("pluginId", "migrationId");

-- CreateIndex
CREATE UNIQUE INDEX "PluginSetting_pluginId_key_key" ON "PluginSetting"("pluginId", "key");

-- CreateIndex
CREATE INDEX "PluginJobDefinition_enabled_lastStartedAt_idx" ON "PluginJobDefinition"("enabled", "lastStartedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PluginJobDefinition_pluginId_jobId_key" ON "PluginJobDefinition"("pluginId", "jobId");

-- CreateIndex
CREATE INDEX "PluginJobRun_pluginId_jobId_startedAt_idx" ON "PluginJobRun"("pluginId", "jobId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PluginEntitlementCache_pluginId_key" ON "PluginEntitlementCache"("pluginId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "_wattanam_schema_lineage" (
    "id" TEXT NOT NULL,
    "lineage" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "_wattanam_schema_lineage_pkey" PRIMARY KEY ("id")
);

INSERT INTO "_wattanam_schema_lineage" ("id", "lineage", "schema_version")
VALUES ('singleton', 'wattanam-core-v1', 1);
