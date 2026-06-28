-- admin_comments テーブルに編集・削除フラグを追加
-- Supabase SQL Editor で実行してください

alter table admin_comments
  add column if not exists edited_at  timestamptz,
  add column if not exists is_deleted boolean default false;
