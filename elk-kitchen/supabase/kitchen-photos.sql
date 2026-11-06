-- ═══════════════════════════════════════════════════════════════════════════
-- ELK Kitchen — recipe & batch photos (shared mode)
-- Run in: Supabase Dashboard → SQL Editor, AFTER kitchen.sql. Safe to re-run.
--
-- Creates ONE private storage bucket, `kitchen-photos`, and policies that let
-- only family members (public.elk_is_family_member()) read, add or replace
-- objects in it. There is no DELETE policy: the app can't delete photos.
-- Touches no other bucket and no other app's policies.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF to_regprocedure('public.elk_is_family_member()') IS NULL THEN
    RAISE EXCEPTION 'ELK family access is not set up — stopping, nothing changed.';
  END IF;
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION 'Supabase Storage is not enabled on this project — stopping, nothing changed.';
  END IF;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('kitchen-photos', 'kitchen-photos', false, 15728640,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Family members can view kitchen photos" ON storage.objects;
DROP POLICY IF EXISTS "Family members can add kitchen photos" ON storage.objects;
CREATE POLICY "Family members can view kitchen photos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'kitchen-photos' AND (SELECT public.elk_is_family_member()));
CREATE POLICY "Family members can add kitchen photos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'kitchen-photos' AND (SELECT public.elk_is_family_member()));
