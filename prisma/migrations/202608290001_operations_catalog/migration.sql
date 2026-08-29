CREATE TABLE "OperationsCatalog" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "catFeedingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "catFeedingBasePriceFen" INTEGER NOT NULL DEFAULT 3200,
    "dogWalkingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "dogWalkingBasePriceFen" INTEGER NOT NULL DEFAULT 3700,
    "openDistricts" TEXT[],
    "announcement" VARCHAR(120) NOT NULL DEFAULT '',
    "updatedByUserId" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationsCatalog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OperationsCatalog_price_bounds" CHECK (
      "catFeedingBasePriceFen" BETWEEN 1 AND 100000
      AND "dogWalkingBasePriceFen" BETWEEN 1 AND 100000
    ),
    CONSTRAINT "OperationsCatalog_version_positive" CHECK ("version" > 0),
    CONSTRAINT "OperationsCatalog_open_districts_nonempty" CHECK (cardinality("openDistricts") > 0)
);

CREATE INDEX "OperationsCatalog_updatedByUserId_idx" ON "OperationsCatalog"("updatedByUserId");

ALTER TABLE "OperationsCatalog"
ADD CONSTRAINT "OperationsCatalog_updatedByUserId_fkey"
FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "OperationsCatalog" (
  "id",
  "openDistricts"
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  ARRAY['JIANYE', 'GULOU', 'XUANWU', 'QINHUAI']::TEXT[]
)
ON CONFLICT ("id") DO NOTHING;
