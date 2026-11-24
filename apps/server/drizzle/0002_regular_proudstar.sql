DROP INDEX "agent_message_client_idx";--> statement-breakpoint
ALTER TABLE "agent_message" ADD COLUMN "user_id" text;--> statement-breakpoint
-- A message belongs to its thread's owner.
UPDATE "agent_message" AS m SET "user_id" = th."user_id" FROM "thread" AS th WHERE th."id" = m."thread_id";--> statement-breakpoint
ALTER TABLE "agent_message" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "model_shot" ADD COLUMN "created_by" text;--> statement-breakpoint
CREATE INDEX "render_job_cache_idx" ON "render_job" USING btree ("org_id","cache_key");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_message_client_idx" ON "agent_message" USING btree ("org_id","user_id","client_message_id");