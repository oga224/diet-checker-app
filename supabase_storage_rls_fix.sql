-- =====================================================
-- Supabase Storage バケット & RLS ポリシー修正
-- Supabase ダッシュボード > SQL Editor で実行してください
-- =====================================================

-- 1. バケット作成（存在しない場合は作成、存在する場合は public=true に更新）
INSERT INTO storage.buckets (id, name, public)
  VALUES ('meal-photos', 'meal-photos', true)
  ON CONFLICT (id) DO UPDATE SET public = true;

INSERT INTO storage.buckets (id, name, public)
  VALUES ('body-photos', 'body-photos', true)
  ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. 既存ポリシーを削除（名前の揺れも含めて全削除）
DROP POLICY IF EXISTS "meal_photos_select"  ON storage.objects;
DROP POLICY IF EXISTS "meal_photos_insert"  ON storage.objects;
DROP POLICY IF EXISTS "meal_photos_update"  ON storage.objects;
DROP POLICY IF EXISTS "meal_photos_delete"  ON storage.objects;
DROP POLICY IF EXISTS "body_photos_select"  ON storage.objects;
DROP POLICY IF EXISTS "body_photos_insert"  ON storage.objects;
DROP POLICY IF EXISTS "body_photos_update"  ON storage.objects;
DROP POLICY IF EXISTS "body_photos_delete"  ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to upload meal photos"  ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to upload body photos"  ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to delete meal photos"  ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to delete body photos"  ON storage.objects;
DROP POLICY IF EXISTS "Public read access for meal photos"               ON storage.objects;
DROP POLICY IF EXISTS "Public read access for body photos"               ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload meal photos"       ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload body photos"       ON storage.objects;

-- 3. meal-photos ポリシー（認証済みユーザーは全操作可、未認証は読み取りのみ）
--    ※ 患者の auth.uid() は clients.id とは異なるため、パス制限は設けない
CREATE POLICY "meal_photos_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'meal-photos');

CREATE POLICY "meal_photos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'meal-photos');

CREATE POLICY "meal_photos_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'meal-photos');

CREATE POLICY "meal_photos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'meal-photos');

-- 4. body-photos ポリシー
CREATE POLICY "body_photos_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'body-photos');

CREATE POLICY "body_photos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'body-photos');

CREATE POLICY "body_photos_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'body-photos');

CREATE POLICY "body_photos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'body-photos');
