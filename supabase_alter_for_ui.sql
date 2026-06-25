-- ============================================================
-- UI改善のためのテーブル変更
-- Supabase SQL Editor で実行してください（既存データは消えません）
-- ============================================================

-- clients テーブル：プログラム中/終了 フラグを追加
alter table clients
  add column if not exists is_active boolean default true;

-- 既存レコードをすべて「プログラム中」に設定
update clients set is_active = true where is_active is null;

-- weight_logs テーブル：外食記録を追加
alter table weight_logs
  add column if not exists ate_out_breakfast boolean,
  add column if not exists ate_out_lunch     boolean,
  add column if not exists ate_out_dinner    boolean;
