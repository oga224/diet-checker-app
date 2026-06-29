-- clients テーブルに is_active カラムを追加
-- Supabase SQL Editor で実行してください（既存データは消えません）

alter table clients
  add column if not exists is_active boolean default true;

-- 既存顧客をすべて「プログラム中」に設定
update clients set is_active = true where is_active is null;
