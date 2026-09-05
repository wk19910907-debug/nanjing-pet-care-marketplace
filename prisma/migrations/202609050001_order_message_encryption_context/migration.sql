-- NULL denotes Task 6 rows created before message AAD was introduced. New rows use 1.
ALTER TABLE "OrderMessage" ADD COLUMN "encryptionContextVersion" INTEGER;

ALTER TABLE "OrderMessage"
  ADD CONSTRAINT "OrderMessage_encryptionContextVersion_check"
  CHECK ("encryptionContextVersion" IS NULL OR "encryptionContextVersion" = 1);
