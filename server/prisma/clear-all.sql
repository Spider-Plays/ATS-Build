-- Run against the target Postgres database (e.g. psql "$DATABASE_URL" -f clear-all.sql)
-- Deletes all app data including demo users. Safe to re-run.

TRUNCATE TABLE
  "ActivityLog",
  "Feedback",
  "Offer",
  "Interview",
  "Candidate",
  "Requirement",
  "User"
RESTART IDENTITY CASCADE;
