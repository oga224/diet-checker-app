-- ============================================================
-- Supabase Auth セットアップ
-- Supabase ダッシュボード > SQL Editor で実行してください
-- ============================================================

-- 1. profiles テーブル（ユーザーのロールとお客さんIDを管理）
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'client' check (role in ('admin', 'client')),
  client_id  uuid references clients(id) on delete set null,
  created_at timestamptz default now()
);

-- 2. profiles の RLS
alter table profiles enable row level security;
create policy "profiles: own select" on profiles
  for select using (auth.uid() = id);

-- ============================================================
-- 3. clients テーブルの RLS
-- ============================================================
alter table clients enable row level security;

create policy "clients: admin all" on clients
  for all using (
    exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
  );

create policy "clients: client read own" on clients
  for select using (
    id = (select client_id from profiles where profiles.id = auth.uid())
  );

-- ============================================================
-- 4. weight_logs の RLS
-- ============================================================
alter table weight_logs enable row level security;

create policy "weight_logs: admin all" on weight_logs
  for all using (
    exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
  );

create policy "weight_logs: client all own" on weight_logs
  for all using (
    client_id = (select client_id from profiles where profiles.id = auth.uid())
  );

-- ============================================================
-- 5. meal_logs の RLS
-- ============================================================
alter table meal_logs enable row level security;

create policy "meal_logs: admin all" on meal_logs
  for all using (
    exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
  );

create policy "meal_logs: client all own" on meal_logs
  for all using (
    client_id = (select client_id from profiles where profiles.id = auth.uid())
  );

-- ============================================================
-- 6. body_photos の RLS
-- ============================================================
alter table body_photos enable row level security;

create policy "body_photos: admin all" on body_photos
  for all using (
    exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
  );

create policy "body_photos: client read own" on body_photos
  for select using (
    client_id = (select client_id from profiles where profiles.id = auth.uid())
  );

-- ============================================================
-- 7. admin_comments の RLS
-- ============================================================
alter table admin_comments enable row level security;

create policy "admin_comments: admin all" on admin_comments
  for all using (
    exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
  );

create policy "admin_comments: client all own" on admin_comments
  for all using (
    client_id = (select client_id from profiles where profiles.id = auth.uid())
  );

-- ============================================================
-- 8. Storage の RLS（認証ユーザーのみアップロード可）
-- ============================================================
-- 既存の匿名ポリシーを削除
drop policy if exists "allow_anon_upload_meal"   on storage.objects;
drop policy if exists "allow_anon_delete_meal"   on storage.objects;
drop policy if exists "allow_anon_upload_body"   on storage.objects;
drop policy if exists "allow_anon_delete_body"   on storage.objects;

-- 認証ユーザーのみアップロード・削除可（読み取りはバケットがPublicなので不要）
create policy "meal_photos: auth insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'meal-photos');
create policy "meal_photos: auth delete" on storage.objects
  for delete to authenticated using (bucket_id = 'meal-photos');

create policy "body_photos: auth insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'body-photos');
create policy "body_photos: auth delete" on storage.objects
  for delete to authenticated using (bucket_id = 'body-photos');

-- ============================================================
-- 9. ユーザー登録手順（Supabase Dashboard > Authentication > Users）
-- ============================================================
-- [管理者の登録]
-- 1. Authentication > Users > "Add user" でメール・パスワードを入力して作成
-- 2. 作成されたユーザーのUIDをコピー
-- 3. 以下のSQLを実行（UIDを置き換えてください）:
--
-- insert into profiles (id, role)
-- values ('<管理者のUID>', 'admin');
--
-- [お客さんの登録]
-- 1. Authentication > Users > "Add user" でメール・パスワードを入力して作成
-- 2. 作成されたユーザーのUIDをコピー
-- 3. clients テーブルのお客さんIDも確認する
-- 4. 以下のSQLを実行（UIDとclient_idを置き換えてください）:
--
-- insert into profiles (id, role, client_id)
-- values ('<お客さんのUID>', 'client', '<clients テーブルの id>');
