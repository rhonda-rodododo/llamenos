-- Add notification_channel preference to user_security_prefs.
-- Allows users to choose between web_push and signal for security alerts.
ALTER TABLE "user_security_prefs" ADD COLUMN "notification_channel" text NOT NULL DEFAULT 'web_push';
