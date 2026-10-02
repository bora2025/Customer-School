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

