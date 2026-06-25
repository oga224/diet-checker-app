-- ============================================================
-- 写真アップロード機能のセットアップ
-- Supabase ダッシュボード > SQL Editor で実行してください
-- ============================================================

-- meal_logs に食事写真URL列を追加（日次1レコード方式）
alter table meal_logs
  add column if not exists breakfast_photo_url text,
  add column if not exists lunch_photo_url      text,
  add column if not exists dinner_photo_url     text,
  add column if not exists snack_photo_url      text;

-- meal_logs の日次ユニーク制約（既存データがある場合はスキップ）
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'meal_logs_client_id_date_key'
  ) then
    alter table meal_logs add constraint meal_logs_client_id_date_key unique(client_id, date);
  end if;
end$$;

-- body_photos に4方向写真URL列を追加
alter table body_photos
  add column if not exists front_photo_url text,
  add column if not exists back_photo_url  text,
  add column if not exists right_photo_url text,
  add column if not exists left_photo_url  text;

-- body_photos の日次ユニーク制約
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'body_photos_client_id_date_key'
  ) then
    alter table body_photos add constraint body_photos_client_id_date_key unique(client_id, date);
  end if;
end$$;

-- ============================================================
-- Storage バケット作成（SQL Editorでは作成できないため
-- Supabase ダッシュボード > Storage から手動で作成してください）
-- バケット名: meal-photos  (Public: ON)
-- バケット名: body-photos  (Public: ON)
-- ============================================================

-- RLS を無効にしている場合は以下は不要です。
-- 有効にしている場合は insert/select 権限を付与してください。
-- create policy "anon_insert_meal_logs"   on meal_logs   for insert to anon with check (true);
-- create policy "anon_update_meal_logs"   on meal_logs   for update to anon using (true);
-- create policy "anon_insert_body_photos" on body_photos for insert to anon with check (true);
-- create policy "anon_update_body_photos" on body_photos for update to anon using (true);
-- create policy "anon_select_body_photos" on body_photos for select to anon using (true);
