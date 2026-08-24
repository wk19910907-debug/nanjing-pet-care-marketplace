CREATE TABLE "ProviderAvailability" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderAvailability_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProviderAvailability_providerId_startsAt_endsAt_idx"
ON "ProviderAvailability"("providerId", "startsAt", "endsAt");

ALTER TABLE "ProviderAvailability"
ADD CONSTRAINT "ProviderAvailability_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
