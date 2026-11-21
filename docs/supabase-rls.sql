-- Run after `npm run db:migrate` on a Supabase project.
-- Deny-all for Supabase's public API (anon/authenticated). The app connects directly as the
-- database owner (DATABASE_URL), which bypasses RLS, so it keeps working.
-- If a table is busy, ALTER TABLE waits for a lock; set lock_timeout and re-run for the leftovers.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;

-- Pin search_path on the audit-chain functions.
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'audit\_%' LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f.sig);
  END LOOP;
END $$;
