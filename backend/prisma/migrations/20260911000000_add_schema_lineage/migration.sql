-- Mark upgraded full installations without changing or removing any existing school data.
CREATE TABLE IF NOT EXISTS "_wattanam_schema_lineage" (
    "id" TEXT NOT NULL,
    "lineage" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "_wattanam_schema_lineage_pkey" PRIMARY KEY ("id")
);

INSERT INTO "_wattanam_schema_lineage" ("id", "lineage", "schema_version")
VALUES ('singleton', 'wattanam-legacy-v1', 1)
ON CONFLICT ("id") DO NOTHING;
