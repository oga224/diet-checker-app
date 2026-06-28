-- ============================================================
-- マルチストア対応 スキーマ
-- Supabase SQL Editor で実行してください（既存データは消えません）
-- ============================================================

-- 1. stores テーブル（店舗マスタ）
create table if not exists stores (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz default now()
);

-- 2. clients に所属店舗を追加
alter table clients
  add column if not exists store_id uuid references stores(id);

-- 3. profiles に所属店舗と super_admin フラグを追加
alter table profiles
  add column if not exists store_id       uuid references stores(id),
  add column if not exists is_super_admin boolean default false;

-- ============================================================
-- 初期セットアップ手順：
--
-- Step 1: stores に自店舗を登録
--   insert into stores (name) values ('〇〇整骨院');
--   → 発行された id をメモする
--
-- Step 2: 既存 admin ユーザーに store_id を設定
--   update profiles set store_id = '<stores.id>' where role = 'admin';
--
-- Step 3: 既存 clients に store_id を設定
--   update clients set store_id = '<stores.id>';
--
-- Step 4: RLS（任意・高セキュリティ向け）
-- ============================================================

-- 4. RLS: admin_comments（コメント）- 同一店舗 or super_admin のみ
alter table admin_comments enable row level security;

-- 既存ポリシーが残っている場合は先に削除
drop policy if exists "admin_comments: admin all"        on admin_comments;
drop policy if exists "admin_comments: client all own"   on admin_comments;

-- 管理者: 同一店舗クライアントのコメントのみ（super_admin は全て）
create policy "admin_comments: admin same store or super"
  on admin_comments for all
  using (
    exists (
      select 1 from profiles p
      join clients c on c.id = admin_comments.client_id
      where p.id = auth.uid()
        and p.role = 'admin'
        and (p.is_super_admin = true or p.store_id = c.store_id or p.store_id is null or c.store_id is null)
    )
  );

-- クライアント: 自分のコメントのみ（変更なし）
create policy "admin_comments: client all own"
  on admin_comments for all
  using (
    client_id = (select client_id from profiles where profiles.id = auth.uid())
  );

-- 5. RLS: body_photos（体型写真）- 同一店舗 or super_admin のみ
alter table body_photos enable row level security;

drop policy if exists "body_photos: admin all"       on body_photos;
drop policy if exists "body_photos: client read own" on body_photos;

create policy "body_photos: admin same store or super"
  on body_photos for all
  using (
    exists (
      select 1 from profiles p
      join clients c on c.id = body_photos.client_id
      where p.id = auth.uid()
        and p.role = 'admin'
        and (p.is_super_admin = true or p.store_id = c.store_id or p.store_id is null or c.store_id is null)
    )
  );

create policy "body_photos: client read own"
  on body_photos for select
  using (
    client_id = (select client_id from profiles where profiles.id = auth.uid())
  );
