ALTER TABLE "users" ADD COLUMN "fingerprint_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "local_storage_token" varchar(64);--> statement-breakpoint
CREATE INDEX "users_fingerprint_idx" ON "users" ("fingerprint_hash");--> statement-breakpoint
CREATE INDEX "users_ls_token_idx" ON "users" ("local_storage_token");
