-- ============================================================
-- Phase 5B-2H customer_number NULL化 rollback（本番復元・COMMIT前提）
--
-- ★ 緊急用ファイル。supabase_phase5b_2h_customer_number_null_apply.sql が
-- 本番に適用済みであることを前提とし、他店舗匿名化閲覧RPCの
-- customer_number出力を、NULL化前（Phase 5B-2H適用前）の元の定義へ
-- 正確に戻す。通常運用では実行しないこと。
--
-- 対象2関数：
--   1. public.admin_get_other_store_client(p_client_id uuid)   OID=18110
--   2. public.admin_list_other_store_clients(p_store_id uuid)  OID=18102
--
-- 変更対象外（本ファイルは一切変更しない）：
--   - public.admin_get_other_store_weight_logs(p_client_id uuid)
--   - public.admin_get_other_store_meal_logs(p_client_id uuid)
--
-- 復元内容：
-- 各関数のRETURN QUERY内、customer_number出力位置にある
-- 「null::text」を、applyで追加した「他店舗閲覧では顧客番号を公開
-- しない」というコメットごと取り除き、元のリポジトリ確定済み定義
-- （supabase_other_store_detail_customer_number_rpc_update.sql /
--  supabase_other_store_list_summary_rpc_update.sql）どおりの
-- 「c.customer_number」へ正確に戻す。それ以外の関数本体（関数名・
-- 入力引数・RETURNS TABLEの列数/列名/列順/列型・owner=postgres・
-- language=plpgsql・STABLE・SECURITY DEFINER・SET search_path = ''・
-- strict=false・leakproof=false・parallel=UNSAFE・auth.uid()判定・
-- admin role判定・store_id判定・is_super_admin分岐・permission denied・
-- SQLSTATE 42501・FROM/JOIN/WHERE/ORDER BY・体重/食事記録/食事写真有無
-- の取得処理）は一切変更しない。戻り値の列数・列名・列順・列型も
-- 一切変更しないため、DROP FUNCTIONは使用せず、CREATE OR REPLACE
-- FUNCTIONだけで復元する。GRANT・REVOKEは使用しない。
--
-- 正規化方法・実測MD5はapply.sql・Phase 5B-2H preflightと同一（本番
-- PostgreSQL上で下記の正規化式を直接実行して確定した実測値）：
--   md5(lower(regexp_replace(btrim(pg_catalog.pg_get_functiondef(oid)), '\s+', ' ', 'g')))
--
--   適用後（rollback前の現在値。precondition確認用）：
--     admin_get_other_store_client(uuid):   0778d69920d2ecc217544982ffffa475
--     admin_list_other_store_clients(uuid): 11ebdab66a1f401f51efa54d2b79e985
--   変更前（rollback後に戻るべき値。postcondition確認用）：
--     admin_get_other_store_client(uuid):   aa3bd7bc6d07d31da77f954cea5ac8f6
--     admin_list_other_store_clients(uuid): ef9206546886d961e80ccd32da31943d
--   変更対象外（rollback前後で不変であることを確認する）：
--     admin_get_other_store_weight_logs(uuid): 7ccb5a42b9754bded475a8e82caa7a2b
--     admin_get_other_store_meal_logs(uuid):   98baea7f078a068614c144e1100a781b
--
-- precondition（現在の本番状態がapply適用後の状態と完全一致する場合
-- だけ復元処理へ進む。1項目でも不一致ならRAISE EXCEPTIONで停止し、
-- 関数を一切変更しない）で、対象2関数のOID・属性・戻り値構成・ACL・
-- customer_number列の位置と型・適用後MD5・null::textを返していること・
-- c.customer_numberの実値を返していないこと、および変更対象外2関数の
-- MD5が不変であることを確認する。
--
-- postcondition（CREATE OR REPLACE FUNCTION後、COMMITより前）で、
-- 変更前MD5への完全復元・OID/owner/ACL/属性/戻り値構成の不変・
-- customer_number出力位置でc.customer_numberを返していること・
-- null::textへの置換が残っていないこと・role/店舗判定の維持・
-- 変更対象外2関数の不変を確認する。1項目でも不一致ならRAISE EXCEPTIONで
-- 停止し、トランザクション全体を確定しない。
--
-- 対象2関数・対象外2関数のいずれも、本ファイル内で実行呼び出しはしない
-- （実際の顧客データ・customer_number・氏名・UUID・store_code等は
--  一切取得・出力しない）。データ行のINSERT/UPDATE/DELETE/TRUNCATE、
-- DROP FUNCTION、ALTER FUNCTION、GRANT、REVOKE、Storage変更、
-- フロントエンド変更は一切行わない。
-- ============================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  v_expected_cols1_name text[] := array[
    'client_id','store_id','store_name','customer_number',
    'age','height_cm','goal_weight','is_active'
  ];
  v_expected_cols1_type text[] := array[
    'uuid','uuid','text','text',
    'integer','numeric','numeric','boolean'
  ];
  v_expected_cols2_name text[] := array[
    'client_id','store_id','store_name','customer_number',
    'age','height_cm','goal_weight','is_active',
    'start_weight','latest_weight','last_log_date',
    'last_log_morning_kg','last_log_evening_kg','last_log_water_ml',
    'last_log_toilet_count','last_log_sleep_hours','last_log_bowel_movement',
    'last_log_ate_breakfast','last_log_ate_lunch','last_log_ate_dinner','last_log_ate_snack',
    'last_log_breakfast_has_photo','last_log_lunch_has_photo','last_log_dinner_has_photo'
  ];
  v_expected_cols2_type text[] := array[
    'uuid','uuid','text','text',
    'integer','numeric','numeric','boolean',
    'numeric','numeric','date',
    'numeric','numeric','integer',
    'integer','numeric','boolean',
    'boolean','boolean','boolean','boolean',
    'boolean','boolean','boolean'
  ];
  v_func1_md5_after    text := '0778d69920d2ecc217544982ffffa475';
  v_func2_md5_after    text := '11ebdab66a1f401f51efa54d2b79e985';
  v_sibling1_md5       text := '7ccb5a42b9754bded475a8e82caa7a2b';
  v_sibling2_md5       text := '98baea7f078a068614c144e1100a781b';
  v_func1_expected_oid oid  := 18110;
  v_func2_expected_oid oid  := 18102;

  -- F1
  v_func1_count        int;
  v_func1_oid          regprocedure;
  v_func1_prokind      "char";
  v_func1_owner        text;
  v_func1_lang         text;
  v_func1_secdef       boolean;
  v_func1_volatile     "char";
  v_func1_strict       boolean;
  v_func1_leakproof    boolean;
  v_func1_parallel     "char";
  v_func1_proconfig    text[];
  v_func1_identity     text;
  v_func1_def          text;
  v_func1_def_md5      text;
  v_func1_cols_name    text[];
  v_func1_cols_type    text[];
  v_func1_cn_pos       int;
  v_func1_cn_type      text;
  v_func1_dep_count    int;
  v_func1_pre_acl      jsonb;
  v_func1_pre_auth     boolean;
  v_func1_pre_svc      boolean;
  v_func1_pre_anon     boolean;
  v_func1_pre_public   boolean;
  v_func1_acl_bad_count int;
  v_func1_acl_good_count int;

  -- F2
  v_func2_count        int;
  v_func2_oid          regprocedure;
  v_func2_prokind      "char";
  v_func2_owner        text;
  v_func2_lang         text;
  v_func2_secdef       boolean;
  v_func2_volatile     "char";
  v_func2_strict       boolean;
  v_func2_leakproof    boolean;
  v_func2_parallel     "char";
  v_func2_proconfig    text[];
  v_func2_identity     text;
  v_func2_def          text;
  v_func2_def_md5      text;
  v_func2_cols_name    text[];
  v_func2_cols_type    text[];
  v_func2_cn_pos       int;
  v_func2_cn_type      text;
  v_func2_dep_count    int;
  v_func2_pre_acl      jsonb;
  v_func2_pre_auth     boolean;
  v_func2_pre_svc      boolean;
  v_func2_pre_anon     boolean;
  v_func2_pre_public   boolean;
  v_func2_acl_bad_count int;
  v_func2_acl_good_count int;

  v_sibling1_oid regprocedure;
  v_sibling2_oid regprocedure;
  v_sibling1_def_md5 text;
  v_sibling2_def_md5 text;
begin
  -- ══════════════════════════════════════════════════════════
  -- F1: 現在の本番状態が apply 適用後の状態と完全一致することの確認
  -- ══════════════════════════════════════════════════════════
  select count(*) into v_func1_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_get_other_store_client';
  if v_func1_count <> 1 then
    raise exception 'precondition failed [F1-01/02]: public.admin_get_other_store_client does not have exactly one overload (found %); refusing to run this rollback', v_func1_count;
  end if;

  v_func1_oid := pg_catalog.to_regprocedure('public.admin_get_other_store_client(uuid)');
  if v_func1_oid is null then
    raise exception 'precondition failed [F1-03]: public.admin_get_other_store_client(uuid) could not be resolved; refusing to run this rollback';
  end if;
  if v_func1_oid::oid <> v_func1_expected_oid then
    raise exception 'precondition failed [F1-OID]: admin_get_other_store_client OID is % but expected % (production object identity has drifted); refusing to run this rollback', v_func1_oid::oid, v_func1_expected_oid;
  end if;

  select
    p.prokind, pg_catalog.pg_get_userbyid(p.proowner), l.lanname, p.prosecdef, p.provolatile,
    p.proisstrict, p.proleakproof, p.proparallel, p.proconfig,
    pg_catalog.pg_get_function_identity_arguments(p.oid),
    pg_catalog.pg_get_functiondef(p.oid)
  into
    v_func1_prokind, v_func1_owner, v_func1_lang, v_func1_secdef, v_func1_volatile,
    v_func1_strict, v_func1_leakproof, v_func1_parallel, v_func1_proconfig,
    v_func1_identity, v_func1_def
  from pg_catalog.pg_proc p
  join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid = v_func1_oid::oid;

  if v_func1_identity is distinct from 'p_client_id uuid' then
    raise exception 'precondition failed [F1-04]: admin_get_other_store_client identity_arguments is not "p_client_id uuid" (found %); refusing to run this rollback', v_func1_identity;
  end if;
  if v_func1_prokind <> 'f' then
    raise exception 'precondition failed [F1-05]: admin_get_other_store_client prokind is not a plain function (found %); refusing to run this rollback', v_func1_prokind;
  end if;
  if v_func1_owner is distinct from 'postgres' then
    raise exception 'precondition failed [F1-06]: admin_get_other_store_client owner is not "postgres" (found %); refusing to run this rollback', v_func1_owner;
  end if;
  if v_func1_lang is distinct from 'plpgsql' then
    raise exception 'precondition failed [F1-07]: admin_get_other_store_client language is not "plpgsql" (found %); refusing to run this rollback', v_func1_lang;
  end if;
  if v_func1_secdef is distinct from true then
    raise exception 'precondition failed [F1-08]: admin_get_other_store_client is not SECURITY DEFINER; refusing to run this rollback';
  end if;
  if v_func1_volatile is distinct from 's' then
    raise exception 'precondition failed [F1-09]: admin_get_other_store_client volatility is not STABLE (found %); refusing to run this rollback', v_func1_volatile;
  end if;
  if v_func1_strict is distinct from false then
    raise exception 'precondition failed [F1-10]: admin_get_other_store_client strict is not false; refusing to run this rollback';
  end if;
  if v_func1_leakproof is distinct from false then
    raise exception 'precondition failed [F1-11]: admin_get_other_store_client leakproof is not false; refusing to run this rollback';
  end if;
  if v_func1_parallel is distinct from 'u' then
    raise exception 'precondition failed [F1-12]: admin_get_other_store_client parallel is not UNSAFE (found %); refusing to run this rollback', v_func1_parallel;
  end if;
  if v_func1_proconfig is null or array_length(v_func1_proconfig, 1) <> 1 or v_func1_proconfig[1] <> 'search_path=""' then
    raise exception 'precondition failed [F1-13]: admin_get_other_store_client proconfig is not exactly array[search_path=""] (found %); refusing to run this rollback', v_func1_proconfig;
  end if;

  select array_agg(pg_catalog.format_type(u.argtype, null) order by u.ord),
         array_agg(u.argname order by u.ord)
    into v_func1_cols_type, v_func1_cols_name
  from pg_catalog.pg_proc p
  cross join lateral unnest(
    p.proallargtypes,
    coalesce(p.proargmodes, array_fill(null::"char", array[coalesce(array_length(p.proallargtypes, 1), 0)])),
    coalesce(p.proargnames, array_fill(null::text,    array[coalesce(array_length(p.proallargtypes, 1), 0)]))
  ) with ordinality as u(argtype, argmode, argname, ord)
  where p.oid = v_func1_oid::oid and u.argmode in ('o','b','t');

  if v_func1_cols_name is distinct from v_expected_cols1_name or v_func1_cols_type is distinct from v_expected_cols1_type then
    raise exception 'precondition failed [F1-14]: admin_get_other_store_client output columns do not match the expected post-apply signature. names=% types=%; refusing to run this rollback', v_func1_cols_name, v_func1_cols_type;
  end if;

  v_func1_cn_pos  := array_position(v_func1_cols_name, 'customer_number');
  v_func1_cn_type := v_func1_cols_type[v_func1_cn_pos];
  if v_func1_cn_pos is null then
    raise exception 'precondition failed [F1-15]: admin_get_other_store_client does not have a customer_number output column; refusing to run this rollback';
  end if;
  if v_func1_cn_type is distinct from 'text' then
    raise exception 'precondition failed [F1-16]: admin_get_other_store_client customer_number column type is not text (found %); refusing to run this rollback', v_func1_cn_type;
  end if;

  if v_func1_def is null or v_func1_def not ilike '%null::text%' then
    raise exception 'precondition failed [F1-17a]: admin_get_other_store_client definition does not currently contain null::text; Phase 5B-2H apply does not appear to have completed. Refusing to run this rollback';
  end if;
  if v_func1_def ilike '%c.customer_number%' then
    raise exception 'precondition failed [F1-17b]: admin_get_other_store_client definition still returns c.customer_number; Phase 5B-2H apply does not appear to have completed. Refusing to run this rollback';
  end if;
  if v_func1_def not ilike '%auth.uid()%' then
    raise exception 'precondition failed [F1-18a]: admin_get_other_store_client definition is missing auth.uid() check; refusing to run this rollback';
  end if;
  if v_func1_def not ilike '%role%' or v_func1_def not ilike '%''admin''%' then
    raise exception 'precondition failed [F1-18b]: admin_get_other_store_client definition is missing admin role check; refusing to run this rollback';
  end if;
  if v_func1_def not ilike '%store_id%' then
    raise exception 'precondition failed [F1-18c]: admin_get_other_store_client definition is missing store_id check; refusing to run this rollback';
  end if;
  if v_func1_def not ilike '%is_super%' then
    raise exception 'precondition failed [F1-18d]: admin_get_other_store_client definition is missing super_admin branch; refusing to run this rollback';
  end if;
  if v_func1_def not ilike '%permission denied%' or v_func1_def not ilike '%42501%' then
    raise exception 'precondition failed [F1-18e]: admin_get_other_store_client definition is missing permission denied / SQLSTATE 42501; refusing to run this rollback';
  end if;

  v_func1_pre_auth := has_function_privilege('authenticated', v_func1_oid::oid, 'EXECUTE');
  v_func1_pre_svc  := has_function_privilege('service_role',  v_func1_oid::oid, 'EXECUTE');
  v_func1_pre_anon := has_function_privilege('anon',           v_func1_oid::oid, 'EXECUTE');
  select exists (
    select 1 from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid = v_func1_oid::oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) into v_func1_pre_public;
  if not v_func1_pre_auth or not v_func1_pre_svc or v_func1_pre_anon or v_func1_pre_public then
    raise exception 'precondition failed [F1-19]: admin_get_other_store_client EXECUTE privileges do not match the expected post-apply set (authenticated=%, service_role=%, anon=%, public_direct=%); refusing to run this rollback',
      v_func1_pre_auth, v_func1_pre_svc, v_func1_pre_anon, v_func1_pre_public;
  end if;

  select count(*) into v_func1_acl_bad_count
  from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
  where p.oid = v_func1_oid::oid
    and not (
      a.privilege_type = 'EXECUTE' and a.grantee <> 0
      and pg_catalog.pg_get_userbyid(a.grantee) in ('postgres','authenticated','service_role')
    );
  if v_func1_acl_bad_count <> 0 then
    raise exception 'precondition failed [F1-20a]: admin_get_other_store_client has % ACL entr(y/ies) outside {postgres,authenticated,service_role}:EXECUTE; refusing to run this rollback', v_func1_acl_bad_count;
  end if;
  select count(*) into v_func1_acl_good_count
  from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
  where p.oid = v_func1_oid::oid and a.privilege_type = 'EXECUTE' and a.grantee <> 0
    and pg_catalog.pg_get_userbyid(a.grantee) in ('postgres','authenticated','service_role');
  if v_func1_acl_good_count <> 3 then
    raise exception 'precondition failed [F1-20b]: admin_get_other_store_client does not have exactly 3 EXECUTE ACL entries for {postgres,authenticated,service_role} (found %); refusing to run this rollback', v_func1_acl_good_count;
  end if;

  select count(*) into v_func1_dep_count
  from pg_catalog.pg_depend d
  where d.refobjid = v_func1_oid::oid and d.refclassid = 'pg_catalog.pg_proc'::regclass;
  if v_func1_dep_count <> 0 then
    raise exception 'precondition failed [F1-21]: admin_get_other_store_client unexpectedly has % dependent catalog object(s) (expected 0); refusing to run this rollback', v_func1_dep_count;
  end if;

  v_func1_def_md5 := md5(lower(regexp_replace(btrim(v_func1_def), '\s+', ' ', 'g')));
  if v_func1_def_md5 is distinct from v_func1_md5_after then
    raise exception 'precondition failed [F1-MD5]: admin_get_other_store_client normalized definition MD5 is % but expected the post-apply value %; refusing to run this rollback', v_func1_def_md5, v_func1_md5_after;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'grantee',        case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
      'privilege_type', a.privilege_type,
      'is_grantable',   a.is_grantable
    ) order by (case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end), a.privilege_type),
    '[]'::jsonb)
  into v_func1_pre_acl
  from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
  where p.oid = v_func1_oid::oid;

  perform set_config('phase5b2h_rollback.f1_pre_oid',   v_func1_oid::oid::text, true);
  perform set_config('phase5b2h_rollback.f1_pre_owner', v_func1_owner, true);
  perform set_config('phase5b2h_rollback.f1_pre_acl',   v_func1_pre_acl::text, true);

  -- ══════════════════════════════════════════════════════════
  -- F2: 現在の本番状態が apply 適用後の状態と完全一致することの確認
  -- ══════════════════════════════════════════════════════════
  select count(*) into v_func2_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_list_other_store_clients';
  if v_func2_count <> 1 then
    raise exception 'precondition failed [F2-01/02]: public.admin_list_other_store_clients does not have exactly one overload (found %); refusing to run this rollback', v_func2_count;
  end if;

  v_func2_oid := pg_catalog.to_regprocedure('public.admin_list_other_store_clients(uuid)');
  if v_func2_oid is null then
    raise exception 'precondition failed [F2-03]: public.admin_list_other_store_clients(uuid) could not be resolved; refusing to run this rollback';
  end if;
  if v_func2_oid::oid <> v_func2_expected_oid then
    raise exception 'precondition failed [F2-OID]: admin_list_other_store_clients OID is % but expected % (production object identity has drifted); refusing to run this rollback', v_func2_oid::oid, v_func2_expected_oid;
  end if;

  select
    p.prokind, pg_catalog.pg_get_userbyid(p.proowner), l.lanname, p.prosecdef, p.provolatile,
    p.proisstrict, p.proleakproof, p.proparallel, p.proconfig,
    pg_catalog.pg_get_function_identity_arguments(p.oid),
    pg_catalog.pg_get_functiondef(p.oid)
  into
    v_func2_prokind, v_func2_owner, v_func2_lang, v_func2_secdef, v_func2_volatile,
    v_func2_strict, v_func2_leakproof, v_func2_parallel, v_func2_proconfig,
    v_func2_identity, v_func2_def
  from pg_catalog.pg_proc p
  join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid = v_func2_oid::oid;

  if v_func2_identity is distinct from 'p_store_id uuid' then
    raise exception 'precondition failed [F2-04]: admin_list_other_store_clients identity_arguments is not "p_store_id uuid" (found %); refusing to run this rollback', v_func2_identity;
  end if;
  if v_func2_prokind <> 'f' then
    raise exception 'precondition failed [F2-05]: admin_list_other_store_clients prokind is not a plain function (found %); refusing to run this rollback', v_func2_prokind;
  end if;
  if v_func2_owner is distinct from 'postgres' then
    raise exception 'precondition failed [F2-06]: admin_list_other_store_clients owner is not "postgres" (found %); refusing to run this rollback', v_func2_owner;
  end if;
  if v_func2_lang is distinct from 'plpgsql' then
    raise exception 'precondition failed [F2-07]: admin_list_other_store_clients language is not "plpgsql" (found %); refusing to run this rollback', v_func2_lang;
  end if;
  if v_func2_secdef is distinct from true then
    raise exception 'precondition failed [F2-08]: admin_list_other_store_clients is not SECURITY DEFINER; refusing to run this rollback';
  end if;
  if v_func2_volatile is distinct from 's' then
    raise exception 'precondition failed [F2-09]: admin_list_other_store_clients volatility is not STABLE (found %); refusing to run this rollback', v_func2_volatile;
  end if;
  if v_func2_strict is distinct from false then
    raise exception 'precondition failed [F2-10]: admin_list_other_store_clients strict is not false; refusing to run this rollback';
  end if;
  if v_func2_leakproof is distinct from false then
    raise exception 'precondition failed [F2-11]: admin_list_other_store_clients leakproof is not false; refusing to run this rollback';
  end if;
  if v_func2_parallel is distinct from 'u' then
    raise exception 'precondition failed [F2-12]: admin_list_other_store_clients parallel is not UNSAFE (found %); refusing to run this rollback', v_func2_parallel;
  end if;
  if v_func2_proconfig is null or array_length(v_func2_proconfig, 1) <> 1 or v_func2_proconfig[1] <> 'search_path=""' then
    raise exception 'precondition failed [F2-13]: admin_list_other_store_clients proconfig is not exactly array[search_path=""] (found %); refusing to run this rollback', v_func2_proconfig;
  end if;

  select array_agg(pg_catalog.format_type(u.argtype, null) order by u.ord),
         array_agg(u.argname order by u.ord)
    into v_func2_cols_type, v_func2_cols_name
  from pg_catalog.pg_proc p
  cross join lateral unnest(
    p.proallargtypes,
    coalesce(p.proargmodes, array_fill(null::"char", array[coalesce(array_length(p.proallargtypes, 1), 0)])),
    coalesce(p.proargnames, array_fill(null::text,    array[coalesce(array_length(p.proallargtypes, 1), 0)]))
  ) with ordinality as u(argtype, argmode, argname, ord)
  where p.oid = v_func2_oid::oid and u.argmode in ('o','b','t');

  if v_func2_cols_name is distinct from v_expected_cols2_name or v_func2_cols_type is distinct from v_expected_cols2_type then
    raise exception 'precondition failed [F2-14]: admin_list_other_store_clients output columns do not match the expected post-apply signature. names=% types=%; refusing to run this rollback', v_func2_cols_name, v_func2_cols_type;
  end if;

  v_func2_cn_pos  := array_position(v_func2_cols_name, 'customer_number');
  v_func2_cn_type := v_func2_cols_type[v_func2_cn_pos];
  if v_func2_cn_pos is null then
    raise exception 'precondition failed [F2-15]: admin_list_other_store_clients does not have a customer_number output column; refusing to run this rollback';
  end if;
  if v_func2_cn_type is distinct from 'text' then
    raise exception 'precondition failed [F2-16]: admin_list_other_store_clients customer_number column type is not text (found %); refusing to run this rollback', v_func2_cn_type;
  end if;

  if v_func2_def is null or v_func2_def not ilike '%null::text%' then
    raise exception 'precondition failed [F2-17a]: admin_list_other_store_clients definition does not currently contain null::text; Phase 5B-2H apply does not appear to have completed. Refusing to run this rollback';
  end if;
  if v_func2_def ilike '%c.customer_number%' then
    raise exception 'precondition failed [F2-17b]: admin_list_other_store_clients definition still returns c.customer_number; Phase 5B-2H apply does not appear to have completed. Refusing to run this rollback';
  end if;
  if v_func2_def not ilike '%auth.uid()%' then
    raise exception 'precondition failed [F2-18a]: admin_list_other_store_clients definition is missing auth.uid() check; refusing to run this rollback';
  end if;
  if v_func2_def not ilike '%role%' or v_func2_def not ilike '%''admin''%' then
    raise exception 'precondition failed [F2-18b]: admin_list_other_store_clients definition is missing admin role check; refusing to run this rollback';
  end if;
  if v_func2_def not ilike '%store_id%' then
    raise exception 'precondition failed [F2-18c]: admin_list_other_store_clients definition is missing store_id check; refusing to run this rollback';
  end if;
  if v_func2_def not ilike '%is_super%' then
    raise exception 'precondition failed [F2-18d]: admin_list_other_store_clients definition is missing super_admin branch; refusing to run this rollback';
  end if;
  if v_func2_def not ilike '%permission denied%' or v_func2_def not ilike '%42501%' then
    raise exception 'precondition failed [F2-18e]: admin_list_other_store_clients definition is missing permission denied / SQLSTATE 42501; refusing to run this rollback';
  end if;

  v_func2_pre_auth := has_function_privilege('authenticated', v_func2_oid::oid, 'EXECUTE');
  v_func2_pre_svc  := has_function_privilege('service_role',  v_func2_oid::oid, 'EXECUTE');
  v_func2_pre_anon := has_function_privilege('anon',           v_func2_oid::oid, 'EXECUTE');
  select exists (
    select 1 from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid = v_func2_oid::oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) into v_func2_pre_public;
  if not v_func2_pre_auth or not v_func2_pre_svc or v_func2_pre_anon or v_func2_pre_public then
    raise exception 'precondition failed [F2-19]: admin_list_other_store_clients EXECUTE privileges do not match the expected post-apply set (authenticated=%, service_role=%, anon=%, public_direct=%); refusing to run this rollback',
      v_func2_pre_auth, v_func2_pre_svc, v_func2_pre_anon, v_func2_pre_public;
  end if;

  select count(*) into v_func2_acl_bad_count
  from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
  where p.oid = v_func2_oid::oid
    and not (
      a.privilege_type = 'EXECUTE' and a.grantee <> 0
      and pg_catalog.pg_get_userbyid(a.grantee) in ('postgres','authenticated','service_role')
    );
  if v_func2_acl_bad_count <> 0 then
    raise exception 'precondition failed [F2-20a]: admin_list_other_store_clients has % ACL entr(y/ies) outside {postgres,authenticated,service_role}:EXECUTE; refusing to run this rollback', v_func2_acl_bad_count;
  end if;
  select count(*) into v_func2_acl_good_count
  from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
  where p.oid = v_func2_oid::oid and a.privilege_type = 'EXECUTE' and a.grantee <> 0
    and pg_catalog.pg_get_userbyid(a.grantee) in ('postgres','authenticated','service_role');
  if v_func2_acl_good_count <> 3 then
    raise exception 'precondition failed [F2-20b]: admin_list_other_store_clients does not have exactly 3 EXECUTE ACL entries for {postgres,authenticated,service_role} (found %); refusing to run this rollback', v_func2_acl_good_count;
  end if;

  select count(*) into v_func2_dep_count
  from pg_catalog.pg_depend d
  where d.refobjid = v_func2_oid::oid and d.refclassid = 'pg_catalog.pg_proc'::regclass;
  if v_func2_dep_count <> 0 then
    raise exception 'precondition failed [F2-21]: admin_list_other_store_clients unexpectedly has % dependent catalog object(s) (expected 0); refusing to run this rollback', v_func2_dep_count;
  end if;

  v_func2_def_md5 := md5(lower(regexp_replace(btrim(v_func2_def), '\s+', ' ', 'g')));
  if v_func2_def_md5 is distinct from v_func2_md5_after then
    raise exception 'precondition failed [F2-MD5]: admin_list_other_store_clients normalized definition MD5 is % but expected the post-apply value %; refusing to run this rollback', v_func2_def_md5, v_func2_md5_after;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'grantee',        case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
      'privilege_type', a.privilege_type,
      'is_grantable',   a.is_grantable
    ) order by (case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end), a.privilege_type),
    '[]'::jsonb)
  into v_func2_pre_acl
  from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
  where p.oid = v_func2_oid::oid;

  perform set_config('phase5b2h_rollback.f2_pre_oid',   v_func2_oid::oid::text, true);
  perform set_config('phase5b2h_rollback.f2_pre_owner', v_func2_owner, true);
  perform set_config('phase5b2h_rollback.f2_pre_acl',   v_func2_pre_acl::text, true);

  -- ══════════════════════════════════════════════════════════
  -- 対象外2関数（sibling）：rollback前の定義MD5が既知の実測値と一致すること
  -- ══════════════════════════════════════════════════════════
  v_sibling1_oid := pg_catalog.to_regprocedure('public.admin_get_other_store_weight_logs(uuid)');
  if v_sibling1_oid is null then
    raise exception 'precondition failed [SIB-01]: public.admin_get_other_store_weight_logs(uuid) could not be resolved; refusing to run this rollback';
  end if;
  v_sibling1_def_md5 := md5(lower(regexp_replace(btrim(pg_catalog.pg_get_functiondef(v_sibling1_oid::oid)), '\s+', ' ', 'g')));
  if v_sibling1_def_md5 is distinct from v_sibling1_md5 then
    raise exception 'precondition failed [SIB-MD5-1]: admin_get_other_store_weight_logs normalized definition MD5 is % but expected % (out-of-scope function has drifted); refusing to run this rollback', v_sibling1_def_md5, v_sibling1_md5;
  end if;

  v_sibling2_oid := pg_catalog.to_regprocedure('public.admin_get_other_store_meal_logs(uuid)');
  if v_sibling2_oid is null then
    raise exception 'precondition failed [SIB-02]: public.admin_get_other_store_meal_logs(uuid) could not be resolved; refusing to run this rollback';
  end if;
  v_sibling2_def_md5 := md5(lower(regexp_replace(btrim(pg_catalog.pg_get_functiondef(v_sibling2_oid::oid)), '\s+', ' ', 'g')));
  if v_sibling2_def_md5 is distinct from v_sibling2_md5 then
    raise exception 'precondition failed [SIB-MD5-2]: admin_get_other_store_meal_logs normalized definition MD5 is % but expected % (out-of-scope function has drifted); refusing to run this rollback', v_sibling2_def_md5, v_sibling2_md5;
  end if;
end $$;

-- ══════════════════════════════════════════════════════════
-- すべてのpreconditionを通過した後にのみ到達する、対象2関数のCREATE OR
-- REPLACE FUNCTION。customer_number出力位置の値を、applyが追加した
-- コメント付きの「null::text」から、元のリポジトリ確定済み定義どおりの
-- 「c.customer_number」へ正確に戻す。それ以外は一切変更しない。
-- ══════════════════════════════════════════════════════════

create or replace function public.admin_get_other_store_client(p_client_id uuid)
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
as $func1$
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
$func1$;

create or replace function public.admin_list_other_store_clients(p_store_id uuid)
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
as $func2$
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
$func2$;

-- ══════════════════════════════════════════════════════════
-- postcondition（1つでも不成立ならcommitさせない）
-- ══════════════════════════════════════════════════════════
do $$
declare
  v_expected_cols1_name text[] := array[
    'client_id','store_id','store_name','customer_number',
    'age','height_cm','goal_weight','is_active'
  ];
  v_expected_cols1_type text[] := array[
    'uuid','uuid','text','text',
    'integer','numeric','numeric','boolean'
  ];
  v_expected_cols2_name text[] := array[
    'client_id','store_id','store_name','customer_number',
    'age','height_cm','goal_weight','is_active',
    'start_weight','latest_weight','last_log_date',
    'last_log_morning_kg','last_log_evening_kg','last_log_water_ml',
    'last_log_toilet_count','last_log_sleep_hours','last_log_bowel_movement',
    'last_log_ate_breakfast','last_log_ate_lunch','last_log_ate_dinner','last_log_ate_snack',
    'last_log_breakfast_has_photo','last_log_lunch_has_photo','last_log_dinner_has_photo'
  ];
  v_expected_cols2_type text[] := array[
    'uuid','uuid','text','text',
    'integer','numeric','numeric','boolean',
    'numeric','numeric','date',
    'numeric','numeric','integer',
    'integer','numeric','boolean',
    'boolean','boolean','boolean','boolean',
    'boolean','boolean','boolean'
  ];
  v_func1_md5_before   text := 'aa3bd7bc6d07d31da77f954cea5ac8f6';
  v_func2_md5_before   text := 'ef9206546886d961e80ccd32da31943d';
  v_sibling1_md5       text := '7ccb5a42b9754bded475a8e82caa7a2b';
  v_sibling2_md5       text := '98baea7f078a068614c144e1100a781b';
  v_func1_expected_oid oid  := 18110;
  v_func2_expected_oid oid  := 18102;

  v_func1_count     int;
  v_func1_oid       regprocedure;
  v_func1_owner     text;
  v_func1_lang      text;
  v_func1_secdef    boolean;
  v_func1_volatile  "char";
  v_func1_strict    boolean;
  v_func1_leakproof boolean;
  v_func1_parallel  "char";
  v_func1_proconfig text[];
  v_func1_def       text;
  v_func1_def_md5   text;
  v_func1_cols_name text[];
  v_func1_cols_type text[];
  v_func1_cn_pos    int;
  v_func1_cn_type   text;
  v_func1_post_acl  jsonb;
  v_func1_post_auth boolean;
  v_func1_post_svc  boolean;
  v_func1_post_anon boolean;
  v_func1_post_public boolean;
  v_func1_acl_bad_count int;
  v_func1_acl_good_count int;

  v_func2_count     int;
  v_func2_oid       regprocedure;
  v_func2_owner     text;
  v_func2_lang      text;
  v_func2_secdef    boolean;
  v_func2_volatile  "char";
  v_func2_strict    boolean;
  v_func2_leakproof boolean;
  v_func2_parallel  "char";
  v_func2_proconfig text[];
  v_func2_def       text;
  v_func2_def_md5   text;
  v_func2_cols_name text[];
  v_func2_cols_type text[];
  v_func2_cn_pos    int;
  v_func2_cn_type   text;
  v_func2_post_acl  jsonb;
  v_func2_post_auth boolean;
  v_func2_post_svc  boolean;
  v_func2_post_anon boolean;
  v_func2_post_public boolean;
  v_func2_acl_bad_count int;
  v_func2_acl_good_count int;

  v_sibling1_oid regprocedure;
  v_sibling2_oid regprocedure;
  v_sibling1_def_md5 text;
  v_sibling2_def_md5 text;
begin
  -- ══════════════════════════════════════════════════════════
  -- F1
  -- ══════════════════════════════════════════════════════════
  select count(*) into v_func1_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_get_other_store_client';
  if v_func1_count <> 1 then
    raise exception 'postcondition failed [F1-P01]: admin_get_other_store_client does not have exactly one overload after rollback (found %)', v_func1_count;
  end if;

  v_func1_oid := pg_catalog.to_regprocedure('public.admin_get_other_store_client(uuid)');
  if v_func1_oid is null or v_func1_oid::oid <> v_func1_expected_oid then
    raise exception 'postcondition failed [F1-P02]: admin_get_other_store_client OID after rollback is % but expected % (OID must be unchanged by CREATE OR REPLACE)', v_func1_oid::oid, v_func1_expected_oid;
  end if;
  if v_func1_oid::oid::text <> current_setting('phase5b2h_rollback.f1_pre_oid') then
    raise exception 'postcondition failed [F1-P02b]: admin_get_other_store_client OID changed during rollback (before=%, after=%)', current_setting('phase5b2h_rollback.f1_pre_oid'), v_func1_oid::oid::text;
  end if;

  select
    pg_catalog.pg_get_userbyid(p.proowner), l.lanname, p.prosecdef, p.provolatile,
    p.proisstrict, p.proleakproof, p.proparallel, p.proconfig,
    pg_catalog.pg_get_functiondef(p.oid)
  into
    v_func1_owner, v_func1_lang, v_func1_secdef, v_func1_volatile,
    v_func1_strict, v_func1_leakproof, v_func1_parallel, v_func1_proconfig,
    v_func1_def
  from pg_catalog.pg_proc p
  join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid = v_func1_oid::oid;

  if v_func1_owner is distinct from current_setting('phase5b2h_rollback.f1_pre_owner') then
    raise exception 'postcondition failed [F1-P03]: admin_get_other_store_client owner changed during rollback (before=%, after=%)', current_setting('phase5b2h_rollback.f1_pre_owner'), v_func1_owner;
  end if;
  if v_func1_owner is distinct from 'postgres' then
    raise exception 'postcondition failed [F1-P03b]: admin_get_other_store_client owner is not postgres after rollback (found %)', v_func1_owner;
  end if;
  if v_func1_lang is distinct from 'plpgsql' then
    raise exception 'postcondition failed [F1-P04]: admin_get_other_store_client language is not plpgsql after rollback (found %)', v_func1_lang;
  end if;
  if v_func1_secdef is distinct from true then
    raise exception 'postcondition failed [F1-P05]: admin_get_other_store_client is not SECURITY DEFINER after rollback';
  end if;
  if v_func1_volatile is distinct from 's' then
    raise exception 'postcondition failed [F1-P06]: admin_get_other_store_client volatility is not STABLE after rollback (found %)', v_func1_volatile;
  end if;
  if v_func1_strict is distinct from false then
    raise exception 'postcondition failed [F1-P07]: admin_get_other_store_client strict is not false after rollback';
  end if;
  if v_func1_leakproof is distinct from false then
    raise exception 'postcondition failed [F1-P08]: admin_get_other_store_client leakproof is not false after rollback';
  end if;
  if v_func1_parallel is distinct from 'u' then
    raise exception 'postcondition failed [F1-P09]: admin_get_other_store_client parallel is not UNSAFE after rollback (found %)', v_func1_parallel;
  end if;
  if v_func1_proconfig is null or array_length(v_func1_proconfig, 1) <> 1 or v_func1_proconfig[1] <> 'search_path=""' then
    raise exception 'postcondition failed [F1-P10]: admin_get_other_store_client proconfig is not exactly array[search_path=""] after rollback (found %)', v_func1_proconfig;
  end if;

  select array_agg(pg_catalog.format_type(u.argtype, null) order by u.ord),
         array_agg(u.argname order by u.ord)
    into v_func1_cols_type, v_func1_cols_name
  from pg_catalog.pg_proc p
  cross join lateral unnest(
    p.proallargtypes,
    coalesce(p.proargmodes, array_fill(null::"char", array[coalesce(array_length(p.proallargtypes, 1), 0)])),
    coalesce(p.proargnames, array_fill(null::text,    array[coalesce(array_length(p.proallargtypes, 1), 0)]))
  ) with ordinality as u(argtype, argmode, argname, ord)
  where p.oid = v_func1_oid::oid and u.argmode in ('o','b','t');

  if v_func1_cols_name is distinct from v_expected_cols1_name or v_func1_cols_type is distinct from v_expected_cols1_type then
    raise exception 'postcondition failed [F1-P11]: admin_get_other_store_client output columns changed after rollback. names=% types=%', v_func1_cols_name, v_func1_cols_type;
  end if;

  v_func1_cn_pos  := array_position(v_func1_cols_name, 'customer_number');
  v_func1_cn_type := v_func1_cols_type[v_func1_cn_pos];
  if v_func1_cn_pos is null then
    raise exception 'postcondition failed [F1-P12]: admin_get_other_store_client no longer has a customer_number output column after rollback';
  end if;
  if v_func1_cn_type is distinct from 'text' then
    raise exception 'postcondition failed [F1-P13]: admin_get_other_store_client customer_number column type is not text after rollback (found %)', v_func1_cn_type;
  end if;

  v_func1_def_md5 := md5(lower(regexp_replace(btrim(v_func1_def), '\s+', ' ', 'g')));
  if v_func1_def_md5 is distinct from v_func1_md5_before then
    raise exception 'postcondition failed [F1-P14]: admin_get_other_store_client normalized definition MD5 after rollback is % but expected the pre-apply value % (did not fully restore the original definition)', v_func1_def_md5, v_func1_md5_before;
  end if;
  if v_func1_def ilike '%null::text%' then
    raise exception 'postcondition failed [F1-P15]: admin_get_other_store_client definition still contains null::text after rollback';
  end if;
  if v_func1_def not ilike '%c.customer_number%' then
    raise exception 'postcondition failed [F1-P16]: admin_get_other_store_client definition does not return c.customer_number after rollback';
  end if;
  if v_func1_def not ilike '%auth.uid()%' then
    raise exception 'postcondition failed [F1-P17a]: admin_get_other_store_client definition lost auth.uid() check after rollback';
  end if;
  if v_func1_def not ilike '%role%' or v_func1_def not ilike '%''admin''%' then
    raise exception 'postcondition failed [F1-P17b]: admin_get_other_store_client definition lost admin role check after rollback';
  end if;
  if v_func1_def not ilike '%store_id%' then
    raise exception 'postcondition failed [F1-P17c]: admin_get_other_store_client definition lost store_id check after rollback';
  end if;
  if v_func1_def not ilike '%is_super%' then
    raise exception 'postcondition failed [F1-P17d]: admin_get_other_store_client definition lost super_admin branch after rollback';
  end if;
  if v_func1_def not ilike '%permission denied%' or v_func1_def not ilike '%42501%' then
    raise exception 'postcondition failed [F1-P17e]: admin_get_other_store_client definition lost permission denied / SQLSTATE 42501 after rollback';
  end if;

  v_func1_post_auth   := has_function_privilege('authenticated', v_func1_oid::oid, 'EXECUTE');
  v_func1_post_svc    := has_function_privilege('service_role',  v_func1_oid::oid, 'EXECUTE');
  v_func1_post_anon   := has_function_privilege('anon',           v_func1_oid::oid, 'EXECUTE');
  select exists (
    select 1 from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid = v_func1_oid::oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) into v_func1_post_public;
  if not v_func1_post_auth or not v_func1_post_svc or v_func1_post_anon or v_func1_post_public then
    raise exception 'postcondition failed [F1-P18]: admin_get_other_store_client EXECUTE privileges after rollback do not match the intended set (authenticated=%, service_role=%, anon=%, public_direct=%)',
      v_func1_post_auth, v_func1_post_svc, v_func1_post_anon, v_func1_post_public;
  end if;

  select count(*) into v_func1_acl_bad_count
  from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
  where p.oid = v_func1_oid::oid
    and not (
      a.privilege_type = 'EXECUTE' and a.grantee <> 0
      and pg_catalog.pg_get_userbyid(a.grantee) in ('postgres','authenticated','service_role')
    );
  if v_func1_acl_bad_count <> 0 then
    raise exception 'postcondition failed [F1-P19a]: admin_get_other_store_client has % ACL entr(y/ies) outside {postgres,authenticated,service_role}:EXECUTE after rollback', v_func1_acl_bad_count;
  end if;
  select count(*) into v_func1_acl_good_count
  from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
  where p.oid = v_func1_oid::oid and a.privilege_type = 'EXECUTE' and a.grantee <> 0
    and pg_catalog.pg_get_userbyid(a.grantee) in ('postgres','authenticated','service_role');
  if v_func1_acl_good_count <> 3 then
    raise exception 'postcondition failed [F1-P19b]: admin_get_other_store_client does not have exactly 3 EXECUTE ACL entries after rollback (found %)', v_func1_acl_good_count;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'grantee',        case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
      'privilege_type', a.privilege_type,
      'is_grantable',   a.is_grantable
    ) order by (case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end), a.privilege_type),
    '[]'::jsonb)
  into v_func1_post_acl
  from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
  where p.oid = v_func1_oid::oid;
  if v_func1_post_acl::text is distinct from current_setting('phase5b2h_rollback.f1_pre_acl') then
    raise exception 'postcondition failed [F1-P20]: admin_get_other_store_client ACL changed during rollback (before=%, after=%)', current_setting('phase5b2h_rollback.f1_pre_acl'), v_func1_post_acl::text;
  end if;

  -- ══════════════════════════════════════════════════════════
  -- F2
  -- ══════════════════════════════════════════════════════════
  select count(*) into v_func2_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_list_other_store_clients';
  if v_func2_count <> 1 then
    raise exception 'postcondition failed [F2-P01]: admin_list_other_store_clients does not have exactly one overload after rollback (found %)', v_func2_count;
  end if;

  v_func2_oid := pg_catalog.to_regprocedure('public.admin_list_other_store_clients(uuid)');
  if v_func2_oid is null or v_func2_oid::oid <> v_func2_expected_oid then
    raise exception 'postcondition failed [F2-P02]: admin_list_other_store_clients OID after rollback is % but expected % (OID must be unchanged by CREATE OR REPLACE)', v_func2_oid::oid, v_func2_expected_oid;
  end if;
  if v_func2_oid::oid::text <> current_setting('phase5b2h_rollback.f2_pre_oid') then
    raise exception 'postcondition failed [F2-P02b]: admin_list_other_store_clients OID changed during rollback (before=%, after=%)', current_setting('phase5b2h_rollback.f2_pre_oid'), v_func2_oid::oid::text;
  end if;

  select
    pg_catalog.pg_get_userbyid(p.proowner), l.lanname, p.prosecdef, p.provolatile,
    p.proisstrict, p.proleakproof, p.proparallel, p.proconfig,
    pg_catalog.pg_get_functiondef(p.oid)
  into
    v_func2_owner, v_func2_lang, v_func2_secdef, v_func2_volatile,
    v_func2_strict, v_func2_leakproof, v_func2_parallel, v_func2_proconfig,
    v_func2_def
  from pg_catalog.pg_proc p
  join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid = v_func2_oid::oid;

  if v_func2_owner is distinct from current_setting('phase5b2h_rollback.f2_pre_owner') then
    raise exception 'postcondition failed [F2-P03]: admin_list_other_store_clients owner changed during rollback (before=%, after=%)', current_setting('phase5b2h_rollback.f2_pre_owner'), v_func2_owner;
  end if;
  if v_func2_owner is distinct from 'postgres' then
    raise exception 'postcondition failed [F2-P03b]: admin_list_other_store_clients owner is not postgres after rollback (found %)', v_func2_owner;
  end if;
  if v_func2_lang is distinct from 'plpgsql' then
    raise exception 'postcondition failed [F2-P04]: admin_list_other_store_clients language is not plpgsql after rollback (found %)', v_func2_lang;
  end if;
  if v_func2_secdef is distinct from true then
    raise exception 'postcondition failed [F2-P05]: admin_list_other_store_clients is not SECURITY DEFINER after rollback';
  end if;
  if v_func2_volatile is distinct from 's' then
    raise exception 'postcondition failed [F2-P06]: admin_list_other_store_clients volatility is not STABLE after rollback (found %)', v_func2_volatile;
  end if;
  if v_func2_strict is distinct from false then
    raise exception 'postcondition failed [F2-P07]: admin_list_other_store_clients strict is not false after rollback';
  end if;
  if v_func2_leakproof is distinct from false then
    raise exception 'postcondition failed [F2-P08]: admin_list_other_store_clients leakproof is not false after rollback';
  end if;
  if v_func2_parallel is distinct from 'u' then
    raise exception 'postcondition failed [F2-P09]: admin_list_other_store_clients parallel is not UNSAFE after rollback (found %)', v_func2_parallel;
  end if;
  if v_func2_proconfig is null or array_length(v_func2_proconfig, 1) <> 1 or v_func2_proconfig[1] <> 'search_path=""' then
    raise exception 'postcondition failed [F2-P10]: admin_list_other_store_clients proconfig is not exactly array[search_path=""] after rollback (found %)', v_func2_proconfig;
  end if;

  select array_agg(pg_catalog.format_type(u.argtype, null) order by u.ord),
         array_agg(u.argname order by u.ord)
    into v_func2_cols_type, v_func2_cols_name
  from pg_catalog.pg_proc p
  cross join lateral unnest(
    p.proallargtypes,
    coalesce(p.proargmodes, array_fill(null::"char", array[coalesce(array_length(p.proallargtypes, 1), 0)])),
    coalesce(p.proargnames, array_fill(null::text,    array[coalesce(array_length(p.proallargtypes, 1), 0)]))
  ) with ordinality as u(argtype, argmode, argname, ord)
  where p.oid = v_func2_oid::oid and u.argmode in ('o','b','t');

  if v_func2_cols_name is distinct from v_expected_cols2_name or v_func2_cols_type is distinct from v_expected_cols2_type then
    raise exception 'postcondition failed [F2-P11]: admin_list_other_store_clients output columns changed after rollback. names=% types=%', v_func2_cols_name, v_func2_cols_type;
  end if;

  v_func2_cn_pos  := array_position(v_func2_cols_name, 'customer_number');
  v_func2_cn_type := v_func2_cols_type[v_func2_cn_pos];
  if v_func2_cn_pos is null then
    raise exception 'postcondition failed [F2-P12]: admin_list_other_store_clients no longer has a customer_number output column after rollback';
  end if;
  if v_func2_cn_type is distinct from 'text' then
    raise exception 'postcondition failed [F2-P13]: admin_list_other_store_clients customer_number column type is not text after rollback (found %)', v_func2_cn_type;
  end if;

  v_func2_def_md5 := md5(lower(regexp_replace(btrim(v_func2_def), '\s+', ' ', 'g')));
  if v_func2_def_md5 is distinct from v_func2_md5_before then
    raise exception 'postcondition failed [F2-P14]: admin_list_other_store_clients normalized definition MD5 after rollback is % but expected the pre-apply value % (did not fully restore the original definition)', v_func2_def_md5, v_func2_md5_before;
  end if;
  if v_func2_def ilike '%null::text%' then
    raise exception 'postcondition failed [F2-P15]: admin_list_other_store_clients definition still contains null::text after rollback';
  end if;
  if v_func2_def not ilike '%c.customer_number%' then
    raise exception 'postcondition failed [F2-P16]: admin_list_other_store_clients definition does not return c.customer_number after rollback';
  end if;
  if v_func2_def not ilike '%auth.uid()%' then
    raise exception 'postcondition failed [F2-P17a]: admin_list_other_store_clients definition lost auth.uid() check after rollback';
  end if;
  if v_func2_def not ilike '%role%' or v_func2_def not ilike '%''admin''%' then
    raise exception 'postcondition failed [F2-P17b]: admin_list_other_store_clients definition lost admin role check after rollback';
  end if;
  if v_func2_def not ilike '%store_id%' then
    raise exception 'postcondition failed [F2-P17c]: admin_list_other_store_clients definition lost store_id check after rollback';
  end if;
  if v_func2_def not ilike '%is_super%' then
    raise exception 'postcondition failed [F2-P17d]: admin_list_other_store_clients definition lost super_admin branch after rollback';
  end if;
  if v_func2_def not ilike '%permission denied%' or v_func2_def not ilike '%42501%' then
    raise exception 'postcondition failed [F2-P17e]: admin_list_other_store_clients definition lost permission denied / SQLSTATE 42501 after rollback';
  end if;

  v_func2_post_auth   := has_function_privilege('authenticated', v_func2_oid::oid, 'EXECUTE');
  v_func2_post_svc    := has_function_privilege('service_role',  v_func2_oid::oid, 'EXECUTE');
  v_func2_post_anon   := has_function_privilege('anon',           v_func2_oid::oid, 'EXECUTE');
  select exists (
    select 1 from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid = v_func2_oid::oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) into v_func2_post_public;
  if not v_func2_post_auth or not v_func2_post_svc or v_func2_post_anon or v_func2_post_public then
    raise exception 'postcondition failed [F2-P18]: admin_list_other_store_clients EXECUTE privileges after rollback do not match the intended set (authenticated=%, service_role=%, anon=%, public_direct=%)',
      v_func2_post_auth, v_func2_post_svc, v_func2_post_anon, v_func2_post_public;
  end if;

  select count(*) into v_func2_acl_bad_count
  from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
  where p.oid = v_func2_oid::oid
    and not (
      a.privilege_type = 'EXECUTE' and a.grantee <> 0
      and pg_catalog.pg_get_userbyid(a.grantee) in ('postgres','authenticated','service_role')
    );
  if v_func2_acl_bad_count <> 0 then
    raise exception 'postcondition failed [F2-P19a]: admin_list_other_store_clients has % ACL entr(y/ies) outside {postgres,authenticated,service_role}:EXECUTE after rollback', v_func2_acl_bad_count;
  end if;
  select count(*) into v_func2_acl_good_count
  from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
  where p.oid = v_func2_oid::oid and a.privilege_type = 'EXECUTE' and a.grantee <> 0
    and pg_catalog.pg_get_userbyid(a.grantee) in ('postgres','authenticated','service_role');
  if v_func2_acl_good_count <> 3 then
    raise exception 'postcondition failed [F2-P19b]: admin_list_other_store_clients does not have exactly 3 EXECUTE ACL entries after rollback (found %)', v_func2_acl_good_count;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'grantee',        case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
      'privilege_type', a.privilege_type,
      'is_grantable',   a.is_grantable
    ) order by (case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end), a.privilege_type),
    '[]'::jsonb)
  into v_func2_post_acl
  from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
  where p.oid = v_func2_oid::oid;
  if v_func2_post_acl::text is distinct from current_setting('phase5b2h_rollback.f2_pre_acl') then
    raise exception 'postcondition failed [F2-P20]: admin_list_other_store_clients ACL changed during rollback (before=%, after=%)', current_setting('phase5b2h_rollback.f2_pre_acl'), v_func2_post_acl::text;
  end if;

  -- ══════════════════════════════════════════════════════════
  -- 対象外2関数（sibling）：rollback後も定義MD5が不変であること
  -- ══════════════════════════════════════════════════════════
  v_sibling1_oid := pg_catalog.to_regprocedure('public.admin_get_other_store_weight_logs(uuid)');
  if v_sibling1_oid is null then
    raise exception 'postcondition failed [SIB-P01]: public.admin_get_other_store_weight_logs(uuid) could not be resolved after rollback';
  end if;
  v_sibling1_def_md5 := md5(lower(regexp_replace(btrim(pg_catalog.pg_get_functiondef(v_sibling1_oid::oid)), '\s+', ' ', 'g')));
  if v_sibling1_def_md5 is distinct from v_sibling1_md5 then
    raise exception 'postcondition failed [SIB-P02]: admin_get_other_store_weight_logs definition changed during rollback (expected MD5 %, found %)', v_sibling1_md5, v_sibling1_def_md5;
  end if;

  v_sibling2_oid := pg_catalog.to_regprocedure('public.admin_get_other_store_meal_logs(uuid)');
  if v_sibling2_oid is null then
    raise exception 'postcondition failed [SIB-P03]: public.admin_get_other_store_meal_logs(uuid) could not be resolved after rollback';
  end if;
  v_sibling2_def_md5 := md5(lower(regexp_replace(btrim(pg_catalog.pg_get_functiondef(v_sibling2_oid::oid)), '\s+', ' ', 'g')));
  if v_sibling2_def_md5 is distinct from v_sibling2_md5 then
    raise exception 'postcondition failed [SIB-P04]: admin_get_other_store_meal_logs definition changed during rollback (expected MD5 %, found %)', v_sibling2_md5, v_sibling2_def_md5;
  end if;
end $$;

commit;
