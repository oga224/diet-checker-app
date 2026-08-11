-- ============================================================
-- Phase 5B: 他店舗詳細RPC（admin_get_other_store_client）に
-- 顧客番号を追加する差分SQL。詳細画面の「匿名顧客N」表示を廃止し、
-- 一覧画面と同じ顧客番号を識別表示として使うための変更。
--
-- 【重要】本ファイルは外部レビュー完了後に手動実行することを想定しています。
--   内容を確認・承認したうえで、Supabase ダッシュボード > SQL Editor に
--   貼り付けて実行してください。レビュー未完了の状態では実行しないこと。
--
-- 対象は admin_get_other_store_client(uuid) だけであり、
-- admin_list_other_store_clients / admin_get_other_store_weight_logs /
-- admin_get_other_store_meal_logs の3関数、RLS・既存Policy・
-- テーブルGRANT・profiles・next_customer_numberは一切変更しない。
--
-- customer_number は既に admin_list_other_store_clients（他店舗一覧RPC）が
-- 返却・表示を許可している情報であり、詳細RPCへの追加によって
-- 一覧画面で既に見られる範囲を超える新たな個人情報公開にはならない。
-- 氏名・かな・電話・住所・memo・契約情報・生年月日実値・コメント本文・
-- body_photos・食事写真URLは今回も一切追加しない。
--
-- PostgreSQLは RETURNS TABLE の列構成が変わる関数を
-- CREATE OR REPLACE だけでは変更できない（エラー：cannot change
-- return type of existing function）ため、既存関数を一度 DROP してから
-- 同一トランザクション内で再作成し、REVOKE/GRANTも再設定する。
-- 動的SQLは使用せず、データ変更（INSERT/UPDATE/DELETE）も行わない。
-- ============================================================

begin;

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

commit;
