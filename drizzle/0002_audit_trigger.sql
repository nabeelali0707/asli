-- Tamper-evident audit log enforced INSIDE the database.
--  * BEFORE INSERT trigger assigns a contiguous chain_index and computes
--    hash = sha256(prev_hash || canonical(row)), serialised by an advisory lock.
--  * audit_head stores the latest index + hash, so deleting the newest rows is detectable.
--  * UPDATE / DELETE on audit_log raise an exception (append-only).
--  * audit_verify() names the first broken row: edited, deleted (index gap) or truncated (head mismatch).
CREATE TABLE IF NOT EXISTS "audit_head" (
  "id" integer PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "chain_index" integer NOT NULL,
  "hash" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_canonical(r audit_log) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'tenantId', r.tenant_id,
    'at', to_char(r.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actorType', r.actor_type,
    'actorId', r.actor_id,
    'actorRole', r.actor_role,
    'action', r.action,
    'targetType', r.target_type,
    'targetId', r.target_id,
    'outcome', r.outcome,
    'detail', r.detail,
    'requestId', r.request_id,
    'chainIndex', r.chain_index
  )::text
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_chain_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prev_idx integer;
  prev_h text;
BEGIN
  PERFORM pg_advisory_xact_lock(7316551);
  SELECT chain_index, hash INTO prev_idx, prev_h FROM audit_head WHERE id = 1;
  IF NOT FOUND THEN
    prev_idx := 0;
    prev_h := repeat('0', 64);
  END IF;
  NEW.chain_index := prev_idx + 1;
  NEW.prev_hash := prev_h;
  NEW.hash := encode(sha256(convert_to(prev_h || audit_canonical(NEW), 'UTF8')), 'hex');
  INSERT INTO audit_head (id, chain_index, hash, updated_at) VALUES (1, NEW.chain_index, NEW.hash, now())
    ON CONFLICT (id) DO UPDATE SET chain_index = EXCLUDED.chain_index, hash = EXCLUDED.hash, updated_at = now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- Re-chain any rows written before this migration (one-time), then install the triggers.
DO $$
DECLARE
  r audit_log;
  idx integer := 0;
  h text := repeat('0', 64);
BEGIN
  FOR r IN SELECT * FROM audit_log ORDER BY seq LOOP
    idx := idx + 1;
    r.chain_index := idx;
    r.prev_hash := h;
    h := encode(sha256(convert_to(h || audit_canonical(r), 'UTF8')), 'hex');
    UPDATE audit_log SET chain_index = idx, prev_hash = r.prev_hash, hash = h WHERE seq = r.seq;
  END LOOP;
  IF idx > 0 THEN
    INSERT INTO audit_head (id, chain_index, hash) VALUES (1, idx, h)
      ON CONFLICT (id) DO UPDATE SET chain_index = EXCLUDED.chain_index, hash = EXCLUDED.hash;
  END IF;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_chain_insert ON audit_log;
--> statement-breakpoint
CREATE TRIGGER audit_chain_insert BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_chain_before_insert();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (attempted %)', TG_OP USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_no_update ON audit_log;
--> statement-breakpoint
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_verify() RETURNS TABLE (ok boolean, checked integer, first_broken_seq bigint, first_broken_index integer, problem text)
LANGUAGE plpgsql AS $$
DECLARE
  r audit_log;
  expected integer := 0;
  h text := repeat('0', 64);
  head_idx integer;
  head_hash text;
BEGIN
  FOR r IN SELECT * FROM audit_log ORDER BY chain_index, seq LOOP
    expected := expected + 1;
    IF r.chain_index <> expected THEN
      RETURN QUERY SELECT false, expected - 1, r.seq, expected, format('row(s) missing: expected index %s, found %s (deleted rows)', expected, r.chain_index);
      RETURN;
    END IF;
    IF r.prev_hash <> h THEN
      RETURN QUERY SELECT false, expected - 1, r.seq, r.chain_index, 'prev_hash does not link to the previous row';
      RETURN;
    END IF;
    h := encode(sha256(convert_to(h || audit_canonical(r), 'UTF8')), 'hex');
    IF r.hash <> h THEN
      RETURN QUERY SELECT false, expected - 1, r.seq, r.chain_index, 'row content was changed after it was written';
      RETURN;
    END IF;
  END LOOP;
  SELECT a.chain_index, a.hash INTO head_idx, head_hash FROM audit_head a WHERE a.id = 1;
  IF FOUND AND (head_idx <> expected OR head_hash <> h) THEN
    RETURN QUERY SELECT false, expected, NULL::bigint, expected + 1, format('newest row(s) deleted: head says %s rows, found %s', head_idx, expected);
    RETURN;
  END IF;
  RETURN QUERY SELECT true, expected, NULL::bigint, NULL::integer, NULL::text;
END
$$;
