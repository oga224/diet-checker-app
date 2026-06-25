-- weight_logs テーブルにスマホ入力項目を追加
-- Supabase ダッシュボード > SQL Editor で実行してください

alter table weight_logs
  add column if not exists water_ml        integer,       -- 水分量 (ml)
  add column if not exists toilet_count    integer,       -- トイレ回数
  add column if not exists sleep_hours     numeric(3,1),  -- 睡眠時間
  add column if not exists bowel_movement  boolean,       -- 排便の有無
  add column if not exists menstruation    boolean,       -- 生理の有無
  add column if not exists ate_breakfast   boolean,       -- 朝食
  add column if not exists ate_lunch       boolean,       -- 昼食
  add column if not exists ate_dinner      boolean,       -- 夕食
  add column if not exists ate_snack       boolean,       -- 間食
  add column if not exists comment         text;          -- 今日のコメント

-- RLS を無効化している場合は追加不要。
-- 有効にしている場合は anon に insert/update 権限を付与してください。
-- create policy "anon_insert_weight_logs" on weight_logs for insert to anon with check (true);
-- create policy "anon_update_weight_logs" on weight_logs for update to anon using (true);
