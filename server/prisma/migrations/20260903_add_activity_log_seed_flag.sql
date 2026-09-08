-- Migration: add_activity_log_seed_flag
-- Add `seed` boolean column to ActivityLog to mark seed-created logs
-- so they can be excluded from notification feeds.
ALTER TABLE "ActivityLog" ADD COLUMN "seed" BOOLEAN NOT NULL DEFAULT false;
