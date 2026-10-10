-- ═══════════════════════════════════════════════════════════════════════════
-- ELK Kitchen — shared family recipes — v1
-- Run in: Supabase Dashboard → SQL Editor → paste → Run. Safe to re-run.
--
-- Uses the ELK project's existing family list (public.elk_family_members and
-- public.elk_is_family_member(), created by ELK Inventory's
-- supabase-family-access.sql). Refuses to run until that exists, so recipes
-- can never be shared with "any signed-in account".
--
-- Creates ONLY its own kitchen_* tables. Does not touch Inventory's tables,
-- the family list, profiles, auth.users, or any other app's tables.
--
--   kitchen_recipes           the reusable recipe (what you plan to make)
--   kitchen_cooking_entries   one occasion someone made it (what actually happened)
--   kitchen_favourites        per-person favourites
--   kitchen_recipe_revisions  every previous version of a recipe, kept automatically
--
-- Safety rules enforced here, not just in the app:
--   • only family members can read or write anything
--   • recipes cannot be deleted through the API (owner can, from the SQL Editor)
--   • every recipe edit bumps `version` and saves the old row as a revision,
--     so an edit can't silently destroy a recipe
--   • cooking history is append-only; people can remove only entries they recorded
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Preconditions ────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
BEGIN
  IF to_regprocedure('public.elk_is_family_member()') IS NULL THEN
    RAISE EXCEPTION 'ELK family access is not set up (public.elk_is_family_member() missing). Run ELK Inventory''s supabase-family-access.sql first — stopping, nothing changed.';
  END IF;
  FOREACH t IN ARRAY ARRAY['kitchen_recipes', 'kitchen_cooking_entries', 'kitchen_favourites', 'kitchen_recipe_revisions'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND COALESCE(obj_description(to_regclass('public.' || t), 'pg_class'), '') NOT LIKE 'elk-kitchen:%' THEN
      RAISE EXCEPTION 'public.% exists but was not created by ELK Kitchen — stopping, nothing changed.', t;
    END IF;
  END LOOP;
END $$;

-- ── Recipes ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kitchen_recipes (
  -- TEXT so recipes imported from a browser keep their original ids.
  id              TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
  title           TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  author_name     TEXT NOT NULL DEFAULT '' CHECK (length(author_name) <= 60),
  ingredients     TEXT NOT NULL DEFAULT '' CHECK (length(ingredients) <= 20000),
  instructions    TEXT NOT NULL DEFAULT '' CHECK (length(instructions) <= 40000),
  notes           TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 20000),
  tags            TEXT[] NOT NULL DEFAULT '{}',
  suggested_tags  TEXT[] NOT NULL DEFAULT '{}',
  approx_calories INTEGER CHECK (approx_calories IS NULL OR approx_calories BETWEEN 0 AND 20000),
  -- The original browser-only record, verbatim, when imported. Never changes.
  legacy          JSONB,
  version         INTEGER NOT NULL DEFAULT 1,
  -- Plain UUIDs, no foreign key: the stamp trigger keeps authorship fixed, so
  -- an ON DELETE SET NULL would make deleting that auth user fail (and the
  -- auth users belong to a project shared with another app).
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      UUID,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.kitchen_recipes IS 'elk-kitchen: shared family recipes.';
ALTER TABLE public.kitchen_recipes DROP CONSTRAINT IF EXISTS kitchen_recipes_created_by_fkey;
ALTER TABLE public.kitchen_recipes DROP CONSTRAINT IF EXISTS kitchen_recipes_updated_by_fkey;

CREATE TABLE IF NOT EXISTS public.kitchen_recipe_revisions (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- No foreign key: history outlives the recipe if the owner ever deletes one.
  recipe_id    TEXT NOT NULL,
  version      INTEGER NOT NULL,
  snapshot     JSONB NOT NULL,
  replaced_by  UUID,
  replaced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.kitchen_recipe_revisions IS 'elk-kitchen: previous versions of recipes (written by trigger only).';
CREATE INDEX IF NOT EXISTS kitchen_recipe_revisions_recipe_idx ON public.kitchen_recipe_revisions (recipe_id, version);

-- Who/when/version are set by the database, never trusted from the client.
CREATE OR REPLACE FUNCTION public.kitchen_recipes_stamp()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.version    := 1;
    NEW.created_by := auth.uid();
    NEW.created_at := NOW();
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'A recipe''s id cannot change.';
    END IF;
    NEW.version    := OLD.version + 1;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    NEW.legacy     := OLD.legacy;
  END IF;
  NEW.updated_by := auth.uid();
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

-- SECURITY DEFINER: writes history that API roles cannot write directly.
CREATE OR REPLACE FUNCTION public.kitchen_recipes_keep_revision()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.kitchen_recipe_revisions (recipe_id, version, snapshot, replaced_by)
  VALUES (OLD.id, OLD.version, to_jsonb(OLD), auth.uid());
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.kitchen_recipes_keep_revision() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kitchen_recipes_stamp()          FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS kitchen_recipes_stamp ON public.kitchen_recipes;
CREATE TRIGGER kitchen_recipes_stamp BEFORE INSERT OR UPDATE ON public.kitchen_recipes
  FOR EACH ROW EXECUTE FUNCTION public.kitchen_recipes_stamp();
DROP TRIGGER IF EXISTS kitchen_recipes_keep_revision ON public.kitchen_recipes;
CREATE TRIGGER kitchen_recipes_keep_revision AFTER UPDATE ON public.kitchen_recipes
  FOR EACH ROW EXECUTE FUNCTION public.kitchen_recipes_keep_revision();

-- ── Cooking history ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kitchen_cooking_entries (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text CHECK (length(id) BETWEEN 1 AND 140),
  -- RESTRICT: a recipe with history can't be deleted out from under it.
  recipe_id          TEXT NOT NULL REFERENCES public.kitchen_recipes(id) ON DELETE RESTRICT,
  cooked_on          DATE,
  cook_name          TEXT NOT NULL DEFAULT '' CHECK (length(cook_name) <= 60),
  ingredients_used   TEXT NOT NULL DEFAULT '' CHECK (length(ingredients_used) <= 20000),
  substitutions      TEXT NOT NULL DEFAULT '' CHECK (length(substitutions) <= 10000),
  family_reaction    TEXT NOT NULL DEFAULT '' CHECK (length(family_reaction) <= 10000),
  improve_next_time  TEXT NOT NULL DEFAULT '' CHECK (length(improve_next_time) <= 10000),
  notes              TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 10000),
  rating             NUMERIC(3,1) CHECK (rating IS NULL OR rating BETWEEN 0 AND 10),
  created_by         UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.kitchen_cooking_entries IS 'elk-kitchen: each time someone cooked a recipe.';
CREATE INDEX IF NOT EXISTS kitchen_cooking_entries_recipe_idx ON public.kitchen_cooking_entries (recipe_id, cooked_on DESC);

-- ── Favourites (per person) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kitchen_favourites (
  user_id    UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  recipe_id  TEXT NOT NULL REFERENCES public.kitchen_recipes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, recipe_id)
);
COMMENT ON TABLE public.kitchen_favourites IS 'elk-kitchen: which family member marked which recipe as a favourite.';

-- ── Access: family members only ──────────────────────────────────────────────
ALTER TABLE public.kitchen_recipes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_cooking_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_favourites       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_recipe_revisions ENABLE ROW LEVEL SECURITY;

-- Nothing for signed-out callers; and the operations the app never needs are
-- withheld outright, so a policy added by mistake later can't open them.
REVOKE ALL ON public.kitchen_recipes, public.kitchen_cooking_entries,
              public.kitchen_favourites, public.kitchen_recipe_revisions FROM PUBLIC, anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.kitchen_recipes FROM authenticated;
REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER ON public.kitchen_cooking_entries FROM authenticated;
REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER ON public.kitchen_favourites FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.kitchen_recipe_revisions FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.kitchen_recipes TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.kitchen_cooking_entries, public.kitchen_favourites TO authenticated;
GRANT SELECT ON public.kitchen_recipe_revisions TO authenticated;

-- Start from a clean slate on re-run: policies are OR'ed, so one stray
-- permissive policy would undo everything below.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('kitchen_recipes', 'kitchen_cooking_entries', 'kitchen_favourites', 'kitchen_recipe_revisions')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

CREATE POLICY "Family members can view recipes" ON public.kitchen_recipes FOR SELECT TO authenticated
  USING ((SELECT public.elk_is_family_member()));
CREATE POLICY "Family members can add recipes" ON public.kitchen_recipes FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.elk_is_family_member()));
CREATE POLICY "Family members can edit recipes" ON public.kitchen_recipes FOR UPDATE TO authenticated
  USING ((SELECT public.elk_is_family_member())) WITH CHECK ((SELECT public.elk_is_family_member()));

CREATE POLICY "Family members can view recipe history" ON public.kitchen_recipe_revisions FOR SELECT TO authenticated
  USING ((SELECT public.elk_is_family_member()));

CREATE POLICY "Family members can view cooking history" ON public.kitchen_cooking_entries FOR SELECT TO authenticated
  USING ((SELECT public.elk_is_family_member()));
CREATE POLICY "Family members can record cooking" ON public.kitchen_cooking_entries FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.elk_is_family_member()) AND created_by = (SELECT auth.uid()));
CREATE POLICY "People can remove entries they recorded" ON public.kitchen_cooking_entries FOR DELETE TO authenticated
  USING ((SELECT public.elk_is_family_member()) AND created_by = (SELECT auth.uid()));

CREATE POLICY "Family members can see favourites" ON public.kitchen_favourites FOR SELECT TO authenticated
  USING ((SELECT public.elk_is_family_member()));
CREATE POLICY "People can add their own favourites" ON public.kitchen_favourites FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.elk_is_family_member()) AND user_id = (SELECT auth.uid()));
CREATE POLICY "People can remove their own favourites" ON public.kitchen_favourites FOR DELETE TO authenticated
  USING ((SELECT public.elk_is_family_member()) AND user_id = (SELECT auth.uid()));

NOTIFY pgrst, 'reload schema';
