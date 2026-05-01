-- Add new columns
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tag" varchar(4);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "game_mode" varchar(32);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "game_difficulty" varchar(32);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "game_level" integer;

-- Backfill existing rows with a random 4-char tag
UPDATE "users"
SET "tag" = UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 4))
WHERE "tag" IS NULL;

-- Tag becomes mandatory
ALTER TABLE "users" ALTER COLUMN "tag" SET NOT NULL;

-- Drop the old unique constraint on pseudo (multiple accounts may share a pseudo)
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_pseudo_unique";

-- Composite unique on (pseudo, tag) ensures full identifier is unique
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_pseudo_tag_unique'
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_pseudo_tag_unique" UNIQUE ("pseudo", "tag");
  END IF;
END $$;