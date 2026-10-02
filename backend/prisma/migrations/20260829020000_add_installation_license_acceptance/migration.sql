-- B-011: record whether/which license version the installing owner accepted.
-- Nullable and non-blocking by design -- DEC-001 (core license) is still `proposed`,
-- so this records acceptance when provided without presuming a business decision.
ALTER TABLE "Installation" ADD COLUMN "acceptedLicenseVersion" TEXT;
ALTER TABLE "Installation" ADD COLUMN "acceptedLicenseAt" TIMESTAMP(3);
