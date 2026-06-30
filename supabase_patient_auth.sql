-- ============================================================
-- 患者ログイン（顧客番号＋誕生日）対応
-- Supabase SQL Editor で実行してください（既存データは消えません）
-- ============================================================

-- clients に生年月日カラムを追加
alter table clients add column if not exists birthdate date;

-- profiles に初回ログイン管理カラムを追加
alter table profiles
  add column if not exists first_login_at  timestamptz,
  add column if not exists password_changed boolean default false;

-- ── RLS 再確認（患者は自分のデータのみ） ──────────────────────
-- 既存ポリシーがあれば一旦削除して再作成（冪等）
drop policy if exists "weight_logs: client all own" on weight_logs;
create policy "weight_logs: client all own" on weight_logs
  for all using (
    client_id = (select client_id from profiles where profiles.id = auth.uid())
  );

drop policy if exists "meal_logs: client all own" on meal_logs;
create policy "meal_logs: client all own" on meal_logs
  for all using (
    client_id = (select client_id from profiles where profiles.id = auth.uid())
  );

drop policy if exists "body_photos: client read own" on body_photos;
create policy "body_photos: client read own" on body_photos
  for select using (
    client_id = (select client_id from profiles where profiles.id = auth.uid())
  );

drop policy if exists "clients: client read own" on clients;
create policy "clients: client read own" on clients
  for select using (
    id = (select client_id from profiles where profiles.id = auth.uid())
  );
