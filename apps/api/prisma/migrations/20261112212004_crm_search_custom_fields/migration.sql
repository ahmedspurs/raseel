-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'SELECT');

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "search_text" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "search_text" TEXT;

-- CreateTable
CREATE TABLE "custom_fields" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "options" TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "custom_fields_key_key" ON "custom_fields"("key");

-- CreateIndex
CREATE INDEX "contacts_search_text_trgm_idx" ON "contacts" USING GIN ("search_text" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "messages_search_text_trgm_idx" ON "messages" USING GIN ("search_text" gin_trgm_ops);

-- Backfill search text for existing rows with the same rules as normalizeSearch():
-- strip tashkeel/tatweel, unify alef/taa/yaa/hamza forms, map Arabic-Indic digits, lowercase.
UPDATE "messages" SET "search_text" = NULLIF(trim(regexp_replace(lower(translate(
  regexp_replace("body", '[ً-ٰٟۖ-ۭـ]', '', 'g'),
  'أإآٱةىؤئ٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', 'ااااهيوي01234567890123456789')), '\s+', ' ', 'g')), '')
WHERE "body" IS NOT NULL;

UPDATE "contacts" SET "search_text" = trim(regexp_replace(lower(translate(
  regexp_replace(concat_ws(' ', "name", "wa_name", "wa_id", "email", "company", "city"),
    '[ً-ٰٟۖ-ۭـ]', '', 'g'),
  'أإآٱةىؤئ٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', 'ااااهيوي01234567890123456789')), '\s+', ' ', 'g'));
