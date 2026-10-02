CREATE TABLE "MarketplaceSchoolControl" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "access" TEXT NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "warningsJson" TEXT NOT NULL DEFAULT '[]',
    "lastVerifiedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarketplaceSchoolControl_pkey" PRIMARY KEY ("id")
);
