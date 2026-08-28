-- Removes the Quant Updates (weekly/daily email) feature.
--
-- Reverses 0007_weekly_updates.sql, 0008_rename_weekly_updates_table.sql and
-- 0009_weekly_updates_reliability.sql. All six tables were exclusive to that
-- feature: nothing else in the app read or wrote them, and each was empty when
-- this migration was written.
--
-- Indexes and RLS policies are dropped implicitly with their tables.

drop table if exists weekly_update_dead_letters;
drop table if exists weekly_update_runs;
drop table if exists quant_update_deliveries;
-- Pre-0008 name, in case an environment never ran the rename.
drop table if exists weekly_quant_updates;
drop table if exists email_suppressions;
drop table if exists email_subscriptions;
drop table if exists watchlists;
