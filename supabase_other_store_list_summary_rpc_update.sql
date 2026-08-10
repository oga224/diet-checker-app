-- ============================================================
-- Phase 5B: 他店舗一覧RPC（admin_list_other_store_clients）に
-- 顧客番号・体重サマリー・入力状況判定用の最小限データを追加する差分SQL。
--
-- 【重要】本ファイルは外部レビュー完了後に手動実行することを想定しています。
--   内容を確認・承認したうえで、Supabase ダッシュボード > SQL Editor に
--   貼り付けて実行してください。レビュー未完了の状態では実行しないこと。
--
-- 対象は admin_list_other_store_clients(uuid) だけであり、
-- admin_get_other_store_client / admin_get_other_store_weight_logs /
-- admin_get_other_store_meal_logs の3関数、RLS・既存Policy・
-- テーブルGRANT・profiles・next_customer_numberは一切変更しない。
--
-- PostgreSQLは RETURNS TABLE の列構成が変わる関数を
-- CREATE OR REPLACE だけでは変更できない（エラー：cannot change
-- return type of existing function）ため、既存関数を一度 DROP してから
-- 同一トランザクション内で再作成し、REVOKE/GRANTも再設定する。
-- 動的SQLは使用せず、データ変更（INSERT/UPDATE/DELETE）も行わない。
-- ============================================================

begin;

drop function if exists public.admin_list_other_store_clients(uuid);

create function public.admin_list_other_store_clients(p_store_id uuid)
returns table (
  client_id                    uuid,
  store_id                     uuid,
  store_name                   text,
  customer_number              text,
  age                          integer,
  height_cm                    numeric,
  goal_weight                  numeric,
  is_active                    boolean,
  start_weight                 numeric,
  latest_weight                numeric,
  last_log_date                date,
  last_log_morning_kg          numeric,
  last_log_evening_kg          numeric,
  last_log_water_ml            integer,
  last_log_toilet_count        integer,
  last_log_sleep_hours         numeric,
  last_log_bowel_movement      boolean,
  last_log_ate_breakfast       boolean,
  last_log_ate_lunch           boolean,
  last_log_ate_dinner          boolean,
  last_log_ate_snack           boolean,
  last_log_breakfast_has_photo boolean,
  last_log_lunch_has_photo     boolean,
  last_log_dinner_has_photo    boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_caller_role          text;
  v_caller_store_id      uuid;
  v_caller_is_super      boolean;
  v_target_store_exists  boolean;
begin
  -- 未ログイン拒否
  if auth.uid() is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  -- 呼び出し元の管理者情報を確認（bodyやパラメータではなく auth.uid() を起点にする）
  select p.role, p.store_id, coalesce(p.is_super_admin, false)
    into v_caller_role, v_caller_store_id, v_caller_is_super
  from public.profiles p
  where p.id = auth.uid();

  -- role が admin 以外（client・未登録含む）は拒否
  if v_caller_role is distinct from 'admin' then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  -- super_admin 以外で store_id 未設定の admin は拒否
  if not v_caller_is_super and v_caller_store_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  -- 対象店舗が存在するか確認
  select exists(select 1 from public.stores s where s.id = p_store_id)
    into v_target_store_exists;

  -- 存在しない店舗も、権限不足の場合と同じ一般的なエラーにする（存在有無を漏らさない）
  if not v_target_store_exists then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  -- super_admin 以外は「自店舗ではない」場合だけ許可（自店舗は通常のアクセス経路を使う）
  if not v_caller_is_super and p_store_id = v_caller_store_id then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  return query
  select
    c.id,
    c.store_id,
    s.name,
    c.customer_number,
    case when c.birthdate is null then null
         else date_part('year', age(current_date, c.birthdate))::integer
    end,
    c.height_cm,
    c.goal_weight,
    coalesce(c.is_active, true),
    sw.start_weight,
    lw.latest_weight,
    ll.last_log_date,
    ll.morning_kg,
    ll.evening_kg,
    ll.water_ml,
    ll.toilet_count,
    ll.sleep_hours,
    ll.bowel_movement,
    ll.ate_breakfast,
    ll.ate_lunch,
    ll.ate_dinner,
    ll.ate_snack,
    (ml.breakfast_photo_url is not null),
    (ml.lunch_photo_url is not null),
    (ml.dinner_photo_url is not null)
  from public.clients c
  join public.stores s on s.id = c.store_id
  -- 開始体重：有効な morning_kg を持つ最古の記録（同日は id 昇順）。
  -- 一覧画面の computeWeightSummary と同じ定義。
  left join lateral (
    select w.morning_kg as start_weight
    from public.weight_logs w
    where w.client_id = c.id and w.morning_kg is not null
    order by w.date asc, w.id asc
    limit 1
  ) sw on true
  -- 最新体重：有効な morning_kg を持つ最新の記録（同日は id 降順）。
  left join lateral (
    select w.morning_kg as latest_weight
    from public.weight_logs w
    where w.client_id = c.id and w.morning_kg is not null
    order by w.date desc, w.id desc
    limit 1
  ) lw on true
  -- 直近の記録（体重の有無を問わない）：入力状況バッジ・スコア評価用。
  -- 一覧画面の findLatestLog と同じ定義（同日は id 降順）。
  left join lateral (
    select w.date as last_log_date, w.morning_kg, w.evening_kg, w.water_ml,
           w.toilet_count, w.sleep_hours, w.bowel_movement,
           w.ate_breakfast, w.ate_lunch, w.ate_dinner, w.ate_snack
    from public.weight_logs w
    where w.client_id = c.id
    order by w.date desc, w.id desc
    limit 1
  ) ll on true
  -- 直近記録日の食事写真「有無」のみ（実URLは返さない）。
  left join lateral (
    select m.breakfast_photo_url, m.lunch_photo_url, m.dinner_photo_url
    from public.meal_logs m
    where m.client_id = c.id and m.date = ll.last_log_date
    limit 1
  ) ml on true
  where c.store_id = p_store_id
  order by c.id;
end;
$$;

revoke all on function public.admin_list_other_store_clients(uuid) from PUBLIC;
revoke all on function public.admin_list_other_store_clients(uuid) from anon;
grant execute on function public.admin_list_other_store_clients(uuid) to authenticated;

commit;
