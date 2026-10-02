-- New sessions store only a SHA-256 digest. The nullable legacy column permits
-- a one-use compatibility path for sessions issued before this migration.
ALTER TABLE "RefreshToken" ALTER COLUMN "token" DROP NOT NULL;
ALTER TABLE "RefreshToken" ADD COLUMN "tokenHash" TEXT;
ALTER TABLE "RefreshToken" ADD COLUMN "revokedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_userId_revokedAt_idx" ON "RefreshToken"("userId", "revokedAt");
