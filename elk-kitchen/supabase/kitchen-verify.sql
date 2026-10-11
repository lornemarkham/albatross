-- ═══════════════════════════════════════════════════════════════════════════
-- ELK Kitchen — check who can really read and write family recipes
-- Run in: Supabase Dashboard → SQL Editor → paste → Run, AFTER kitchen.sql.
--
-- Tests behaviour, not just that policies exist: it acts as
--   • the first person on the ELK family list (a real member),
--   • a made-up signed-in account that is not on the list (a stranger),
--   • a signed-out caller (anon),
-- tries the reads and writes each one should and shouldn't be able to do, and
-- shows one row per check. Every test write is undone before it finishes, so
-- it changes nothing. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS pg_temp.kitchen_verify;
CREATE TEMP TABLE kitchen_verify (n SERIAL, check_name TEXT, passed BOOLEAN, detail TEXT);

DO $$
DECLARE
  member   UUID;
  stranger UUID := gen_random_uuid();
  rid      TEXT := 'verify-' || replace(gen_random_uuid()::text, '-', '');
  names    TEXT[] := '{}';
  oks      BOOLEAN[] := '{}';
  details  TEXT[] := '{}';
  n        BIGINT;
  v        INTEGER;
  ok       BOOLEAN;
  msg      TEXT;
BEGIN
  SELECT user_id INTO member FROM public.elk_family_members ORDER BY user_id LIMIT 1;
  IF member IS NULL THEN RAISE EXCEPTION 'No one is on the ELK family list — nothing to test.'; END IF;

  -- Static: every kitchen policy names the family check, and none is for anon/public.
  SELECT count(*) INTO n FROM pg_policies WHERE tablename LIKE 'kitchen\_%'
    AND COALESCE(qual, '') || COALESCE(with_check, '') NOT LIKE '%elk_is_family_member%';
  names := array_append(names, 'every kitchen policy requires family membership'); oks := array_append(oks, (n = 0)); details := array_append(details, (n || ' policies without it'));
  SELECT count(*) INTO n FROM pg_policies WHERE tablename LIKE 'kitchen\_%' AND NOT (roles <@ ARRAY['authenticated']::name[]);
  names := array_append(names, 'no kitchen policy applies to signed-out callers'); oks := array_append(oks, (n = 0)); details := array_append(details, (n || ' policies for other roles'));
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
   WHERE s.nspname = 'public' AND c.relname LIKE 'kitchen\_%' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  names := array_append(names, 'row-level security is on for every kitchen table'); oks := array_append(oks, (n = 0)); details := array_append(details, (n || ' tables without it'));

  -- Everything below is undone at the end (the 'kitchen-verify-undo' exception).
  BEGIN
    -- ── As a family member ──────────────────────────────────────────────────
    PERFORM set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', member::text, true);
    SET LOCAL ROLE authenticated;

    INSERT INTO public.kitchen_recipes (id, title, ingredients) VALUES (rid, 'Verify test recipe', '1 cup test') RETURNING version INTO v;
    names := array_append(names, 'member can save a recipe'); oks := array_append(oks, (v = 1)); details := array_append(details, ('version ' || v));
    SELECT count(*) INTO n FROM public.kitchen_recipes WHERE id = rid;
    names := array_append(names, 'member can read it back'); oks := array_append(oks, (n = 1)); details := array_append(details, (n || ' rows'));
    UPDATE public.kitchen_recipes SET notes = 'edited' WHERE id = rid AND version = 1 RETURNING version INTO v;
    SELECT count(*) INTO n FROM public.kitchen_recipe_revisions WHERE recipe_id = rid;
    names := array_append(names, 'member edit keeps the previous version'); oks := array_append(oks, (v = 2 AND n = 1)); details := array_append(details, ('version ' || v || ', ' || n || ' revision'));
    UPDATE public.kitchen_recipes SET removed_at = NOW() WHERE id = rid;
    SELECT count(*) INTO n FROM public.kitchen_recipes WHERE id = rid AND removed_at IS NOT NULL AND removed_by = member;
    names := array_append(names, 'member "Delete" hides (and keeps) the recipe'); oks := array_append(oks, (n = 1)); details := array_append(details, (n || ' rows marked removed'));
    INSERT INTO public.kitchen_cooking_entries (recipe_id, cook_name) VALUES (rid, 'Verify');
    names := array_append(names, 'member can record cooking'); oks := array_append(oks, TRUE); details := array_append(details, 'ok');

    BEGIN
      DELETE FROM public.kitchen_recipes WHERE id = rid;
      ok := FALSE; msg := 'delete was allowed';
    EXCEPTION WHEN insufficient_privilege THEN ok := TRUE; msg := 'permission denied';
    END;
    names := array_append(names, 'nobody can destroy a recipe through the API'); oks := array_append(oks, ok); details := array_append(details, msg);

    BEGIN
      SELECT count(*) INTO n FROM public.inventory_items;
      SELECT count(*) INTO v FROM public.stock_lots;
      ok := TRUE; msg := n || ' inventory items, ' || v || ' pantry batches visible';
    EXCEPTION WHEN OTHERS THEN ok := FALSE; msg := SQLERRM;
    END;
    names := array_append(names, 'member can read the Inventory pantry'); oks := array_append(oks, ok); details := array_append(details, msg);

    -- ── As a signed-in stranger (not on the family list) ────────────────────
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', stranger::text, true);
    SET LOCAL ROLE authenticated;

    SELECT count(*) INTO n FROM public.kitchen_recipes;
    names := array_append(names, 'stranger sees no recipes'); oks := array_append(oks, (n = 0)); details := array_append(details, (n || ' rows'));
    SELECT count(*) INTO n FROM public.kitchen_cooking_entries;
    names := array_append(names, 'stranger sees no cooking history'); oks := array_append(oks, (n = 0)); details := array_append(details, (n || ' rows'));
    SELECT count(*) INTO n FROM public.kitchen_recipe_revisions;
    names := array_append(names, 'stranger sees no old versions'); oks := array_append(oks, (n = 0)); details := array_append(details, (n || ' rows'));
    BEGIN
      INSERT INTO public.kitchen_recipes (id, title) VALUES (rid || '-x', 'Spam');
      ok := FALSE; msg := 'insert was allowed';
    EXCEPTION WHEN insufficient_privilege THEN ok := TRUE; msg := 'refused';
    END;
    names := array_append(names, 'stranger cannot add a recipe'); oks := array_append(oks, ok); details := array_append(details, msg);
    UPDATE public.kitchen_recipes SET title = 'pwned' WHERE id = rid;
    GET DIAGNOSTICS n = ROW_COUNT;
    names := array_append(names, 'stranger cannot edit a recipe'); oks := array_append(oks, (n = 0)); details := array_append(details, (n || ' rows changed'));
    BEGIN
      INSERT INTO public.elk_family_members (user_id) VALUES (stranger);
      ok := FALSE; msg := 'joined the family list';
    EXCEPTION WHEN insufficient_privilege THEN ok := TRUE; msg := 'refused';
    END;
    names := array_append(names, 'stranger cannot add themselves to the family'); oks := array_append(oks, ok); details := array_append(details, msg);
    SELECT count(*) INTO n FROM public.inventory_items;
    SELECT count(*) INTO v FROM public.stock_lots;
    names := array_append(names, 'stranger sees no Inventory pantry'); oks := array_append(oks, (n = 0 AND v = 0)); details := array_append(details, (n || ' items, ' || v || ' batches'));

    -- ── Signed out (anon) ───────────────────────────────────────────────────
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    SET LOCAL ROLE anon;
    BEGIN
      SELECT count(*) INTO n FROM public.kitchen_recipes;
      ok := FALSE; msg := n || ' rows readable';
    EXCEPTION WHEN insufficient_privilege THEN ok := TRUE; msg := 'permission denied';
    END;
    names := array_append(names, 'signed-out callers cannot read recipes'); oks := array_append(oks, ok); details := array_append(details, msg);
    BEGIN
      INSERT INTO public.kitchen_recipes (id, title) VALUES (rid || '-a', 'Spam');
      ok := FALSE; msg := 'insert was allowed';
    EXCEPTION WHEN insufficient_privilege THEN ok := TRUE; msg := 'permission denied';
    END;
    names := array_append(names, 'signed-out callers cannot add recipes'); oks := array_append(oks, ok); details := array_append(details, msg);

    RESET ROLE;
    RAISE EXCEPTION 'kitchen-verify-undo';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'kitchen-verify-undo' THEN
      names := array_append(names, 'checks ran to the end'); oks := array_append(oks, FALSE); details := array_append(details, SQLERRM);
    END IF;
  END;
  RESET ROLE;

  FOR i IN 1 .. array_length(names, 1) LOOP
    INSERT INTO pg_temp.kitchen_verify (check_name, passed, detail) VALUES (names[i], oks[i], details[i]);
  END LOOP;
END $$;

SELECT CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result, check_name, detail
  FROM pg_temp.kitchen_verify ORDER BY n;
