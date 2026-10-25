CREATE TABLE "app_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"default_thb_per_jpy" numeric(12, 8),
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_singleton" CHECK ("app_settings"."id" = 1),
	CONSTRAINT "settings_rate" CHECK ("app_settings"."default_thb_per_jpy" > 0 AND "app_settings"."default_thb_per_jpy" <= 100),
	CONSTRAINT "settings_version" CHECK ("app_settings"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchasers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(60) NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchaser_name" CHECK ("purchasers"."name" = btrim("purchasers"."name") AND length("purchasers"."name") > 0),
	CONSTRAINT "purchaser_version" CHECK ("purchasers"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"purchaser_id" uuid NOT NULL,
	"original_currency" text NOT NULL,
	"original_amount" numeric(20, 2) NOT NULL,
	"thb_per_jpy" numeric(12, 8) NOT NULL,
	"rate_source" text NOT NULL,
	"amount_jpy" numeric(20, 0) NOT NULL,
	"amount_thb" numeric(20, 2) NOT NULL,
	"purchased_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"create_request_hash" text NOT NULL,
	CONSTRAINT "purchase_name" CHECK ("purchases"."name" = btrim("purchases"."name") AND length("purchases"."name") > 0),
	CONSTRAINT "purchase_description" CHECK (length("purchases"."description") <= 4000),
	CONSTRAINT "purchase_currency" CHECK ("purchases"."original_currency" IN ('JPY','THB')),
	CONSTRAINT "purchase_original" CHECK ("purchases"."original_amount" > 0 AND "purchases"."original_amount" <= 999999999.99 AND ("purchases"."original_currency" <> 'JPY' OR "purchases"."original_amount" = trunc("purchases"."original_amount"))),
	CONSTRAINT "purchase_rate" CHECK ("purchases"."thb_per_jpy" > 0 AND "purchases"."thb_per_jpy" <= 100),
	CONSTRAINT "purchase_source" CHECK ("purchases"."rate_source" IN ('default','manual')),
	CONSTRAINT "purchase_jpy" CHECK ("purchases"."amount_jpy" >= 0 AND "purchases"."amount_jpy" = CASE WHEN "purchases"."original_currency" = 'JPY' THEN "purchases"."original_amount" ELSE round("purchases"."original_amount" / "purchases"."thb_per_jpy", 0) END),
	CONSTRAINT "purchase_thb" CHECK ("purchases"."amount_thb" >= 0 AND "purchases"."amount_thb" = CASE WHEN "purchases"."original_currency" = 'THB' THEN "purchases"."original_amount" ELSE round("purchases"."original_amount" * "purchases"."thb_per_jpy", 2) END),
	CONSTRAINT "purchase_version" CHECK ("purchases"."version" > 0),
	CONSTRAINT "purchase_hash" CHECK ("purchases"."create_request_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_purchaser_id_purchasers_id_fk" FOREIGN KEY ("purchaser_id") REFERENCES "public"."purchasers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchaser_name_unique" ON "purchasers" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "purchase_active_date" ON "purchases" USING btree ("purchased_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "purchases"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "purchase_active_payer" ON "purchases" USING btree ("purchaser_id","purchased_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "purchases"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "purchase_trash" ON "purchases" USING btree ("deleted_at");