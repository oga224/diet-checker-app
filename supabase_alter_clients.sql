-- clients テーブルに新カラムを追加
-- Supabase ダッシュボード > SQL Editor で実行してください

alter table clients
  add column if not exists age           integer,
  add column if not exists height_cm     numeric(5,1),
  add column if not exists address       text,
  add column if not exists contract_type text;
