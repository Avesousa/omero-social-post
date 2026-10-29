CREATE TYPE "public"."attempt_outcome" AS ENUM('success', 'retryable_error', 'auth_error', 'permanent_error', 'interrupted');--> statement-breakpoint
CREATE TYPE "public"."channel_status" AS ENUM('connected', 'needs_reconnect', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."delivery_item_status" AS ENUM('pending', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'publishing', 'published', 'failed', 'missed');--> statement-breakpoint
CREATE TYPE "public"."metrics_checkpoint" AS ENUM('1h', '24h', '7d', 'manual');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('delivery_failed', 'channel_reauth', 'token_expiring', 'post_missed');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('draft', 'scheduled', 'publishing', 'published', 'partially_published', 'failed', 'missed');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('x', 'linkedin');--> statement-breakpoint
CREATE TYPE "public"."scheduled_via" AS ENUM('manual', 'queue', 'now');--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" "provider" NOT NULL,
	"external_id" text NOT NULL,
	"handle" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"status" "channel_status" DEFAULT 'connected' NOT NULL,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"token_expires_at" timestamp with time zone,
	"refresh_expires_at" timestamp with time zone,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"settings" jsonb DEFAULT '{"longPostsEnabled":false}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channels_provider_external_id_unique" UNIQUE("provider","external_id")
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "media_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"customized" boolean DEFAULT false NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"last_error_code" text,
	"last_error_message" text,
	"needs_attention" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_post_id_channel_id_unique" UNIQUE("post_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "delivery_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"delivery_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" "attempt_outcome",
	"error_code" text,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "delivery_item_media" (
	"delivery_item_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "delivery_item_media_pk" PRIMARY KEY("delivery_item_id","position")
);
--> statement-breakpoint
CREATE TABLE "delivery_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"delivery_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"status" "delivery_item_status" DEFAULT 'pending' NOT NULL,
	"remote_id" text,
	"remote_url" text,
	"published_at" timestamp with time zone,
	CONSTRAINT "delivery_items_delivery_id_position_unique" UNIQUE("delivery_id","position")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"base_content" text DEFAULT '' NOT NULL,
	"status" "post_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"scheduled_via" "scheduled_via",
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_slots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"weekday" smallint NOT NULL,
	"local_time" time NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "queue_slots_weekday_local_time_unique" UNIQUE("weekday","local_time"),
	CONSTRAINT "queue_slots_weekday_check" CHECK ("queue_slots"."weekday" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" "notification_type" NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_metrics" (
	"id" uuid PRIMARY KEY NOT NULL,
	"delivery_item_id" uuid NOT NULL,
	"checkpoint" "metrics_checkpoint" NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"impressions" integer,
	"likes" integer,
	"reposts" integer,
	"replies" integer,
	"quotes" integer,
	"bookmarks" integer,
	"raw" jsonb
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_item_media" ADD CONSTRAINT "delivery_item_media_delivery_item_id_delivery_items_id_fk" FOREIGN KEY ("delivery_item_id") REFERENCES "public"."delivery_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_item_media" ADD CONSTRAINT "delivery_item_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD CONSTRAINT "post_metrics_delivery_item_id_delivery_items_id_fk" FOREIGN KEY ("delivery_item_id") REFERENCES "public"."delivery_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "deliveries_post_id_idx" ON "deliveries" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "deliveries_channel_id_status_idx" ON "deliveries" USING btree ("channel_id","status");--> statement-breakpoint
CREATE INDEX "delivery_attempts_delivery_id_started_at_idx" ON "delivery_attempts" USING btree ("delivery_id","started_at");--> statement-breakpoint
CREATE INDEX "delivery_item_media_media_id_idx" ON "delivery_item_media" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "posts_status_scheduled_at_idx" ON "posts" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "posts_scheduled_at_idx" ON "posts" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "notifications_read_at_created_at_idx" ON "notifications" USING btree ("read_at","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "post_metrics_delivery_item_id_fetched_at_idx" ON "post_metrics" USING btree ("delivery_item_id","fetched_at" DESC NULLS LAST);