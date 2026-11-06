-- ═══════════════════════════════════════════════════════════════════════════
-- ELK Kitchen — recipe & batch photos, cooking clips and voice notes (shared mode) — v2
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

-- v2 (Start cooking): short video clips and voice notes go in the same
-- private bucket. Only ever adds types to the list; changes nothing else.
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY(SELECT DISTINCT unnest(COALESCE(allowed_mime_types, '{}'::text[]) || ARRAY[
         'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
         'video/mp4', 'video/webm', 'video/quicktime', 'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/aac']) ORDER BY 1)
 WHERE id = 'kitchen-photos';

DROP POLICY IF EXISTS "Family members can view kitchen photos" ON storage.objects;
DROP POLICY IF EXISTS "Family members can add kitchen photos" ON storage.objects;
CREATE POLICY "Family members can view kitchen photos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'kitchen-photos' AND (SELECT public.elk_is_family_member()));
CREATE POLICY "Family members can add kitchen photos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'kitchen-photos' AND (SELECT public.elk_is_family_member()));
