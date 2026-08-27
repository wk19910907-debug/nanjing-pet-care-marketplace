ALTER TABLE "Payment"
ADD COLUMN "manualConfirmationKey" VARCHAR(100);

CREATE UNIQUE INDEX "Payment_manualConfirmationKey_key"
ON "Payment"("manualConfirmationKey");
