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
