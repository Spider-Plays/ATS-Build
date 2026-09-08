-- Run in Neon Console → SQL Editor (production branch → neondb)
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
