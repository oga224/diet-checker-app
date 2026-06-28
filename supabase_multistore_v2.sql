-- ============================================================
-- 多店舗対応 v2：店舗コード・顧客番号管理
-- Supabase SQL Editor で実行してください
-- ============================================================

-- 1. stores テーブルに code カラムを追加
alter table stores add column if not exists code text;

-- code に UNIQUE 制約を追加
do $$
begin
  alter table stores add constraint stores_code_unique unique (code);
exception when duplicate_table then null;
when others then null;
end $$;

-- 2. 4店舗を登録（code で UPSERT）
insert into stores (name, code) values
  ('ASAKA整体院',   'A'),
  ('つむぎ整体院',  'T'),
  ('せせらぎ整体',  'S'),
  ('ReCORE接骨院',  'R')
on conflict (code) do update set name = excluded.name;

-- 3. clients テーブルに customer_number カラムを追加
alter table clients add column if not exists customer_number text;

-- 4. 既存顧客への顧客番号付与（store_id が設定済みのもの）
-- 店舗コード + 5桁連番 例: A-00001
with ranked as (
  select
    c.id,
    s.code || '-' || lpad(
      row_number() over (
        partition by c.store_id
        order by c.created_at, c.id
      )::text,
      5, '0'
    ) as cn
  from clients c
  join stores s on s.id = c.store_id
  where c.customer_number is null
    and c.store_id is not null
)
update clients
set customer_number = ranked.cn
from ranked
where clients.id = ranked.id;

-- ============================================================
-- セットアップ手順:
--
-- Step 1: 自店舗のIDを確認
--   select id, name, code from stores;
--
-- Step 2: 管理者の store_id を設定
--   update profiles set store_id = '<stores.id>' where role = 'admin';
--
-- Step 3: 既存顧客に store_id を設定してから上記 WITH 節を再実行
--   update clients set store_id = '<stores.id>' where store_id is null;
--   ↑ を実行後に Step 4 の WITH 節を再実行
--
-- Step 4: 顧客番号確認
--   select id, name, customer_number, store_id from clients order by customer_number;
-- ============================================================
