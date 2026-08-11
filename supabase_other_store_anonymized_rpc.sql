-- ============================================================
-- Phase 5B-1B: 他店舗admin向け匿名化閲覧RPC
--
-- 【重要】本ファイルは外部レビュー完了後に手動実行することを想定しています。
--   内容を確認・承認したうえで、Supabase ダッシュボード > SQL Editor に
--   貼り付けて実行してください。レビュー未完了の状態では実行しないこと。
--
-- 目的：
--   ログイン済みの authenticated admin が、他店舗の顧客情報を
--   個人識別情報なしで閲覧するための読み取り専用RPCを追加する。
--   ここでの「匿名閲覧」は Supabase の anon ロールとは無関係。
--
--   既存の clients / weight_logs / meal_logs / stores テーブルの
--   RLS・Policy・GRANTは今回変更しない。これらのRPCは
--   SECURITY DEFINER として動作し、関数内部のロジックだけで
--   権限判定と返却列の制限を行う。
--
--   本ファイルはUIからまだ呼び出されない（Phase 5B-1Cで切替予定）。
--   既存の画面・既存のPolicy・既存のGRANTには一切影響しない。
--
--   4つの関数作成・権限設定は1トランザクションで原子的に適用する
--   （途中で失敗した場合に一部の関数だけが作成される状態を防ぐため）。
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. admin_get_other_store_client
--    他店舗の顧客1件の匿名化された基本情報（詳細画面用）
--    Phase 5B（詳細画面の匿名仮名廃止）で、一覧画面と同じ
--    customer_number を返すよう拡張する（新たな個人情報の追加ではなく、
--    既に admin_list_other_store_clients が返している情報と同一）。
--
--    PostgreSQLは RETURNS TABLE の列構成が変わる関数を
--    CREATE OR REPLACE だけでは変更できない（エラー：cannot change
--    return type of existing function）ため、admin_list_other_store_clients
--    と同様にこの関数だけ事前に DROP してから作成する
--    （他の2関数 admin_get_other_store_weight_logs /
--     admin_get_other_store_meal_logs はDROPしない）。
-- ------------------------------------------------------------
drop function if exists public.admin_get_other_store_client(uuid);

create function public.admin_get_other_store_client(p_client_id uuid)
returns table (
  client_id       uuid,
  store_id        uuid,
  store_name      text,
  customer_number text,
  age             integer,
  height_cm       numeric,
  goal_weight     numeric,
  is_active       boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_caller_role      text;
  v_caller_store_id  uuid;
  v_caller_is_super  boolean;
  v_target_store_id  uuid;
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

  -- 対象顧客の store_id を取得
  select c.store_id into v_target_store_id
  from public.clients c
  where c.id = p_client_id;

  -- 顧客が存在しない場合も、権限不足の場合と同じ扱いにする（存在有無を漏らさない）
  if v_target_store_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  -- super_admin 以外は「自店舗ではない」場合だけ許可（自店舗は通常のアクセス経路を使う）
  if not v_caller_is_super and v_target_store_id = v_caller_store_id then
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
    coalesce(c.is_active, true)
  from public.clients c
  join public.stores s on s.id = c.store_id
  where c.id = p_client_id;
end;
$$;

revoke all on function public.admin_get_other_store_client(uuid) from PUBLIC;
revoke all on function public.admin_get_other_store_client(uuid) from anon;
grant execute on function public.admin_get_other_store_client(uuid) to authenticated;

-- ------------------------------------------------------------
-- 2. admin_list_other_store_clients
--    指定した他店舗の顧客一覧（一覧画面用、複数行）
--    Phase 5B（一覧項目追加）で、顧客番号・体重サマリー・
--    入力状況判定に必要な最小限の値を追加で返すよう拡張。
--    氏名・かな・電話・住所・memo・契約情報・生年月日実値・
--    コメント本文・admin_comments・body_photos・食事写真URLは返さない。
--
--    PostgreSQLは RETURNS TABLE の列構成が変わる関数を
--    CREATE OR REPLACE だけでは変更できない（エラー：cannot change
--    return type of existing function）。本ファイルは新規環境への
--    初回適用を主目的とするが、旧い列構成（Phase 5B以前）が既に
--    適用された環境へ再実行しても安全に置換できるよう、この関数だけ
--    事前に DROP してから作成する（他の3関数はDROPしない）。
-- ------------------------------------------------------------
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
  if auth.uid() is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select p.role, p.store_id, coalesce(p.is_super_admin, false)
    into v_caller_role, v_caller_store_id, v_caller_is_super
  from public.profiles p
  where p.id = auth.uid();

  if v_caller_role is distinct from 'admin' then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if not v_caller_is_super and v_caller_store_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select exists(select 1 from public.stores s where s.id = p_store_id)
    into v_target_store_exists;

  if not v_target_store_exists then
    raise exception 'permission denied' using errcode = '42501';
  end if;

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

-- ------------------------------------------------------------
-- 3. admin_get_other_store_weight_logs
--    他店舗の指定顧客の体重・生活記録全件
--    （体重グラフ・月間表1・健康スコア用）
--    comment 列は本文を返さず、有無だけを has_comment として返す
-- ------------------------------------------------------------
create or replace function public.admin_get_other_store_weight_logs(p_client_id uuid)
returns table (
  log_date          date,
  morning_kg        numeric,
  evening_kg        numeric,
  water_ml          integer,
  toilet_count      integer,
  sleep_hours       numeric,
  bowel_movement    boolean,
  menstruation      boolean,
  ate_breakfast     boolean,
  ate_lunch         boolean,
  ate_dinner        boolean,
  ate_snack         boolean,
  ate_out_breakfast boolean,
  ate_out_lunch     boolean,
  ate_out_dinner    boolean,
  has_comment       boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_caller_role      text;
  v_caller_store_id  uuid;
  v_caller_is_super  boolean;
  v_target_store_id  uuid;
begin
  if auth.uid() is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select p.role, p.store_id, coalesce(p.is_super_admin, false)
    into v_caller_role, v_caller_store_id, v_caller_is_super
  from public.profiles p
  where p.id = auth.uid();

  if v_caller_role is distinct from 'admin' then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if not v_caller_is_super and v_caller_store_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select c.store_id into v_target_store_id
  from public.clients c
  where c.id = p_client_id;

  if v_target_store_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if not v_caller_is_super and v_target_store_id = v_caller_store_id then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  return query
  select
    w.date,
    w.morning_kg,
    w.evening_kg,
    w.water_ml,
    w.toilet_count,
    w.sleep_hours,
    w.bowel_movement,
    w.menstruation,
    w.ate_breakfast,
    w.ate_lunch,
    w.ate_dinner,
    w.ate_snack,
    w.ate_out_breakfast,
    w.ate_out_lunch,
    w.ate_out_dinner,
    (nullif(btrim(w.comment), '') is not null) as has_comment
  from public.weight_logs w
  where w.client_id = p_client_id
  order by w.date, w.id;
end;
$$;

revoke all on function public.admin_get_other_store_weight_logs(uuid) from PUBLIC;
revoke all on function public.admin_get_other_store_weight_logs(uuid) from anon;
grant execute on function public.admin_get_other_store_weight_logs(uuid) to authenticated;

-- ------------------------------------------------------------
-- 4. admin_get_other_store_meal_logs
--    他店舗の指定顧客の食事写真参照情報全件
--    （月間表2・食事写真表示用。URLは既存の公開URL形式のまま。
--     Storageのprivate化は別Phaseで扱う）
-- ------------------------------------------------------------
create or replace function public.admin_get_other_store_meal_logs(p_client_id uuid)
returns table (
  log_date            date,
  breakfast_photo_url text,
  lunch_photo_url     text,
  dinner_photo_url    text,
  snack_photo_url     text
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_caller_role      text;
  v_caller_store_id  uuid;
  v_caller_is_super  boolean;
  v_target_store_id  uuid;
begin
  if auth.uid() is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select p.role, p.store_id, coalesce(p.is_super_admin, false)
    into v_caller_role, v_caller_store_id, v_caller_is_super
  from public.profiles p
  where p.id = auth.uid();

  if v_caller_role is distinct from 'admin' then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if not v_caller_is_super and v_caller_store_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select c.store_id into v_target_store_id
  from public.clients c
  where c.id = p_client_id;

  if v_target_store_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if not v_caller_is_super and v_target_store_id = v_caller_store_id then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  return query
  select
    m.date,
    m.breakfast_photo_url,
    m.lunch_photo_url,
    m.dinner_photo_url,
    m.snack_photo_url
  from public.meal_logs m
  where m.client_id = p_client_id
  order by m.date;
end;
$$;

revoke all on function public.admin_get_other_store_meal_logs(uuid) from PUBLIC;
revoke all on function public.admin_get_other_store_meal_logs(uuid) from anon;
grant execute on function public.admin_get_other_store_meal_logs(uuid) to authenticated;

commit;
