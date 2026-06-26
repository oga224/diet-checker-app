-- 管理者代行入力を区別するための input_by カラムを追加
-- Supabase SQL Editor で実行してください（既存データは消えません）

alter table weight_logs
  add column if not exists input_by text
    default 'client'
    check (input_by in ('client', 'admin'));

-- 既存レコードは全てお客さん本人入力扱いにする
update weight_logs set input_by = 'client' where input_by is null;
