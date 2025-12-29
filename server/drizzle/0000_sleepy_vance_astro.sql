CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"pseudo" varchar(255) NOT NULL,
	"current_room_id" varchar(50),
	"last_active" timestamp DEFAULT now(),
	CONSTRAINT "users_pseudo_unique" UNIQUE("pseudo")
);
