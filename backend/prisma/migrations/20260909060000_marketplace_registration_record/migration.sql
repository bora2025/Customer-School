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

