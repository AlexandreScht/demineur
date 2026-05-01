CREATE TABLE IF NOT EXISTS "friendships" (
    "id" serial PRIMARY KEY,
    "owner_pseudo" varchar(32) NOT NULL,
    "owner_tag" varchar(4) NOT NULL,
    "friend_pseudo" varchar(32) NOT NULL,
    "friend_tag" varchar(4) NOT NULL,
    "created_at" timestamp DEFAULT NOW(),
    CONSTRAINT "friendships_unique" UNIQUE ("owner_pseudo", "owner_tag", "friend_pseudo", "friend_tag")
);

CREATE INDEX IF NOT EXISTS "friendships_owner_idx" ON "friendships" ("owner_pseudo", "owner_tag");
