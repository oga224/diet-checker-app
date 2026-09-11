-- ============================================================
-- Phase 5B-2H customer_number NULL化 preflight（本番・COMMITしない検証専用）
--
-- 目的：
-- 次の2関数の RETURN QUERY 内にある customer_number 出力列の値だけを
-- 「c.customer_number」から「null::text」へ置き換えた定義を、本番
-- トランザクション内で一時的に CREATE OR REPLACE FUNCTION し、
-- PostgreSQLが実際に受理すること、および pg_catalog（pg_proc・
-- pg_get_functiondef等）へ実際に記録される定義・属性・ACL・依存関係を
-- 実測することだけを目的とする。本トランザクションは必ず ROLLBACK し、
-- 本番へは一切の変更を確定させない。
--
--   1. public.admin_get_other_store_client(p_client_id uuid)
--   2. public.admin_list_other_store_clients(p_store_id uuid)
--
-- 背景（Phase 5B-2H本番読み取り専用監査の確定結果）：
-- 対象4関数（上記2関数 + admin_get_other_store_weight_logs(uuid) +
-- admin_get_other_store_meal_logs(uuid)）は、いずれも存在・overload1件・
-- owner=postgres・language=plpgsql・SECURITY DEFINER・STABLE・
-- strict=false・leakproof=false・parallel=UNSAFE・
-- SET search_path TO ''・authenticated/service_roleはEXECUTE可能・
-- anon/PUBLICはEXECUTE不可・owner postgresはrolbypassrls=true・
-- 対象テーブルはRLS=true/FORCE RLS=false、という状態であった。
-- customer_numberを返しているのは上記2関数だけであり、いずれも
-- 出力列の途中（先頭でも末尾でもない）に存在する。対象4関数への
-- 依存オブジェクトはカタログ上0件であった。
--
-- 採用する設計：
-- customer_number列そのものは削除しない。戻り値の列名・列順・型を
-- すべて維持したまま、RETURN QUERY内の c.customer_number を
-- null::text へ置き換えるだけの CREATE OR REPLACE FUNCTION を行う。
-- これにより、戻り値型を一切変更しないため DROP FUNCTION が不要になり、
-- 関数OID・所有者・ACL・依存関係が維持される
-- （PostgreSQLの仕様として、CREATE OR REPLACE FUNCTION は既存関数の
--  所有者・権限を変更しない）。role判定・店舗判定・SELECT対象・
-- WHERE条件・JOIN・ORDER BYなど、customer_number出力値以外は一切
-- 変更しない。
--
-- 変更前定義の完全一致確認（本番PostgreSQL上で下記正規化式を直接実行して
-- 確定した実測値のMD5。pg_get_functiondef()実測結果からの算出ではなく、
-- 本番での正規化式そのものの実行結果であることを明記する）：
--   admin_get_other_store_client(p_client_id uuid):
--     aa3bd7bc6d07d31da77f954cea5ac8f6
--   admin_list_other_store_clients(p_store_id uuid):
--     ef9206546886d961e80ccd32da31943d
-- 正規化方法： lower(regexp_replace(btrim(pg_get_functiondef(oid)), '\s+', ' ', 'g'))
-- のmd5()。CREATE OR REPLACE FUNCTIONより前に、DOブロック内でこのMD5を
-- 含む全preconditionを確認し、1つでも不一致ならRAISE EXCEPTIONで
-- 停止する（関数は一切変更されない）。
--
-- 本ファイルはpreflight専用であり、apply/postcheck/rollback用の
-- 別ファイルは今回作成しない。対象2関数・対象外2関数（sibling）を
-- 含め、いずれのRPCもpreflight内で呼び出さない（実際の顧客データ・
-- customer_number・氏名・UUID・store_code等は一切取得・表示しない）。
-- CREATE OR REPLACE FUNCTION以外のDDL（DROP FUNCTION・ALTER FUNCTION・
-- CREATE/DROP/ALTER TABLE・CREATE/DROP POLICY・GRANT・REVOKE）、
-- データ行へのINSERT/UPDATE/DELETE/TRUNCATE、動的SQL・CALLは行わない。
-- ============================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  -- 期待値（本番監査の確定結果・リポジトリ確定済み定義から）
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
  -- 本番PostgreSQL上で正規化式を直接実行して確定した実測値
  v_func1_md5_expected text := 'aa3bd7bc6d07d31da77f954cea5ac8f6';
  v_func2_md5_expected text := 'ef9206546886d961e80ccd32da31943d';

  -- F1: admin_get_other_store_client(uuid)
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
  v_func1_def_norm     text;
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
  v_func1_owner_bypassrls boolean;

  -- F2: admin_list_other_store_clients(uuid)
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
  v_func2_def_norm     text;
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
  v_func2_owner_bypassrls boolean;

  -- 対象外2関数（sibling）：変更されないことの事前状態記録用
  v_sibling1_oid regprocedure;
  v_sibling2_oid regprocedure;
  v_sibling1_md5 text;
  v_sibling2_md5 text;
begin
  -- ══════════════════════════════════════════════════════════
  -- F1: public.admin_get_other_store_client(p_client_id uuid)
  -- ══════════════════════════════════════════════════════════

  -- 1-2. publicスキーマに存在し、overloadが正確に1件
  select count(*) into v_func1_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_get_other_store_client';
  if v_func1_count <> 1 then
    raise exception 'precondition failed [F1-01/02]: public.admin_get_other_store_client does not have exactly one overload (found %)', v_func1_count;
  end if;

  v_func1_oid := pg_catalog.to_regprocedure('public.admin_get_other_store_client(uuid)');
  if v_func1_oid is null then
    raise exception 'precondition failed [F1-03]: public.admin_get_other_store_client(uuid) could not be resolved via to_regprocedure';
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

  -- 3. identity_argumentsが正確に一致
  if v_func1_identity is distinct from 'p_client_id uuid' then
    raise exception 'precondition failed [F1-03b]: admin_get_other_store_client identity_arguments is not "p_client_id uuid" (found %)', v_func1_identity;
  end if;

  -- 4. prokind=function
  if v_func1_prokind <> 'f' then
    raise exception 'precondition failed [F1-04]: admin_get_other_store_client prokind is not a plain function (found %)', v_func1_prokind;
  end if;

  -- 5. owner=postgres
  if v_func1_owner is distinct from 'postgres' then
    raise exception 'precondition failed [F1-05]: admin_get_other_store_client owner is not "postgres" (found %)', v_func1_owner;
  end if;

  -- 6. language=plpgsql
  if v_func1_lang is distinct from 'plpgsql' then
    raise exception 'precondition failed [F1-06]: admin_get_other_store_client language is not "plpgsql" (found %)', v_func1_lang;
  end if;

  -- 7. SECURITY DEFINER=true
  if v_func1_secdef is distinct from true then
    raise exception 'precondition failed [F1-07]: admin_get_other_store_client is not SECURITY DEFINER';
  end if;

  -- 8. volatility=STABLE
  if v_func1_volatile is distinct from 's' then
    raise exception 'precondition failed [F1-08]: admin_get_other_store_client volatility is not STABLE (found %)', v_func1_volatile;
  end if;

  -- 9. strict=false
  if v_func1_strict is distinct from false then
    raise exception 'precondition failed [F1-09]: admin_get_other_store_client strict is not false';
  end if;

  -- 10. leakproof=false
  if v_func1_leakproof is distinct from false then
    raise exception 'precondition failed [F1-10]: admin_get_other_store_client leakproof is not false';
  end if;

  -- 11. parallel=UNSAFE
  if v_func1_parallel is distinct from 'u' then
    raise exception 'precondition failed [F1-11]: admin_get_other_store_client parallel is not UNSAFE (found %)', v_func1_parallel;
  end if;

  -- 12. proconfigが正確に array['search_path=""']::text[]
  -- （関数定義本体の SET search_path = '' は、pg_proc.proconfig 上では
  --  search_path="" という文字列として保存される。本番監査
  --  （Phase 5B-2H）実測値もこの表記であることを確認済み）
  if v_func1_proconfig is null or array_length(v_func1_proconfig, 1) <> 1 or v_func1_proconfig[1] <> 'search_path=""' then
    raise exception 'precondition failed [F1-12]: admin_get_other_store_client proconfig is not exactly array[search_path=""] (found %)', v_func1_proconfig;
  end if;

  -- 出力列（OUT/INOUT/TABLE='o'/'b'/'t'）を位置順に復元
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

  -- 13. 戻り値列構成（列名・型・順序）が本番監査結果と完全一致
  if v_func1_cols_name is distinct from v_expected_cols1_name or v_func1_cols_type is distinct from v_expected_cols1_type then
    raise exception 'precondition failed [F1-13]: admin_get_other_store_client output columns do not match the Phase 5B-2H audit result. names=% types=%', v_func1_cols_name, v_func1_cols_type;
  end if;

  v_func1_cn_pos  := array_position(v_func1_cols_name, 'customer_number');
  v_func1_cn_type := v_func1_cols_type[v_func1_cn_pos];

  -- 14. customer_numberがTABLE出力列として正確に1件
  if v_func1_cn_pos is null or (
    select count(*) from unnest(v_func1_cols_name) x where x = 'customer_number'
  ) <> 1 then
    raise exception 'precondition failed [F1-14]: admin_get_other_store_client does not have exactly one customer_number output column';
  end if;

  -- 15. customer_numberの型がtext
  if v_func1_cn_type is distinct from 'text' then
    raise exception 'precondition failed [F1-15]: admin_get_other_store_client customer_number column type is not text (found %)', v_func1_cn_type;
  end if;

  -- 16. customer_numberが出力列の途中（先頭でも末尾でもない）
  if v_func1_cn_pos = 1 or v_func1_cn_pos = array_length(v_func1_cols_name, 1) then
    raise exception 'precondition failed [F1-16]: admin_get_other_store_client customer_number is at position % (first or last), expected a middle position', v_func1_cn_pos;
  end if;

  -- 17. 関数定義本文がc.customer_numberを返している
  if v_func1_def is null or v_func1_def not ilike '%c.customer_number%' then
    raise exception 'precondition failed [F1-17]: admin_get_other_store_client definition does not currently reference c.customer_number';
  end if;

  -- 18. 関数定義本文が現在のrole・店舗判定を保持している
  if v_func1_def not ilike '%auth.uid()%' then
    raise exception 'precondition failed [F1-18a]: admin_get_other_store_client definition is missing auth.uid() check';
  end if;
  if v_func1_def not ilike '%role%' or v_func1_def not ilike '%''admin''%' then
    raise exception 'precondition failed [F1-18b]: admin_get_other_store_client definition is missing admin role check';
  end if;
  if v_func1_def not ilike '%store_id%' then
    raise exception 'precondition failed [F1-18c]: admin_get_other_store_client definition is missing store_id check';
  end if;
  if v_func1_def not ilike '%is_super%' then
    raise exception 'precondition failed [F1-18d]: admin_get_other_store_client definition is missing super_admin branch';
  end if;
  if v_func1_def not ilike '%permission denied%' or v_func1_def not ilike '%42501%' then
    raise exception 'precondition failed [F1-18e]: admin_get_other_store_client definition is missing permission denied / SQLSTATE 42501';
  end if;

  -- 19-20. EXECUTE権限
  v_func1_pre_auth := has_function_privilege('authenticated', v_func1_oid::oid, 'EXECUTE');
  v_func1_pre_svc  := has_function_privilege('service_role',  v_func1_oid::oid, 'EXECUTE');
  v_func1_pre_anon := has_function_privilege('anon',           v_func1_oid::oid, 'EXECUTE');
  select exists (
    select 1 from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid = v_func1_oid::oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) into v_func1_pre_public;

  if not v_func1_pre_auth then
    raise exception 'precondition failed [F1-19a]: authenticated cannot currently EXECUTE admin_get_other_store_client';
  end if;
  if not v_func1_pre_svc then
    raise exception 'precondition failed [F1-19b]: service_role cannot currently EXECUTE admin_get_other_store_client';
  end if;
  if v_func1_pre_anon then
    raise exception 'precondition failed [F1-20a]: anon unexpectedly can EXECUTE admin_get_other_store_client';
  end if;
  if v_func1_pre_public then
    raise exception 'precondition failed [F1-20b]: PUBLIC unexpectedly has a direct EXECUTE grant on admin_get_other_store_client';
  end if;

  -- 21. owner postgresのrolbypassrls=true
  select exists (
    select 1 from pg_catalog.pg_roles r where r.rolname = v_func1_owner and r.rolbypassrls = true
  ) into v_func1_owner_bypassrls;
  if not v_func1_owner_bypassrls then
    raise exception 'precondition failed [F1-21]: owner % of admin_get_other_store_client does not have rolbypassrls=true', v_func1_owner;
  end if;

  -- 22. 依存オブジェクト数=0
  select count(*) into v_func1_dep_count
  from pg_catalog.pg_depend d
  where d.refobjid = v_func1_oid::oid and d.refclassid = 'pg_catalog.pg_proc'::regclass;
  if v_func1_dep_count <> 0 then
    raise exception 'precondition failed [F1-22]: admin_get_other_store_client unexpectedly has % dependent catalog object(s) (expected 0)', v_func1_dep_count;
  end if;

  -- MD5完全一致（変更前定義がPhase 5B-2H本番監査の実測結果と完全に同一であることの最終確認）
  v_func1_def_norm := lower(regexp_replace(btrim(v_func1_def), '\s+', ' ', 'g'));
  v_func1_def_md5  := md5(v_func1_def_norm);
  if v_func1_def_md5 is distinct from v_func1_md5_expected then
    raise exception 'precondition failed [F1-MD5]: admin_get_other_store_client normalized definition MD5 is % but expected % (production definition has drifted since the Phase 5B-2H audit)', v_func1_def_md5, v_func1_md5_expected;
  end if;

  -- 23-25. 変更前ACL・OID・所有者をトランザクションローカル設定へ記録
  -- （true=is_local。トランザクション終了（ROLLBACK含む）で自動的に破棄される）
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

  perform set_config('phase5b2h_preflight.f1_pre_oid',   v_func1_oid::oid::text, true);
  perform set_config('phase5b2h_preflight.f1_pre_owner', v_func1_owner, true);
  perform set_config('phase5b2h_preflight.f1_pre_acl',   v_func1_pre_acl::text, true);

  -- ══════════════════════════════════════════════════════════
  -- F2: public.admin_list_other_store_clients(p_store_id uuid)
  -- ══════════════════════════════════════════════════════════

  -- 1-2. publicスキーマに存在し、overloadが正確に1件
  select count(*) into v_func2_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_list_other_store_clients';
  if v_func2_count <> 1 then
    raise exception 'precondition failed [F2-01/02]: public.admin_list_other_store_clients does not have exactly one overload (found %)', v_func2_count;
  end if;

  v_func2_oid := pg_catalog.to_regprocedure('public.admin_list_other_store_clients(uuid)');
  if v_func2_oid is null then
    raise exception 'precondition failed [F2-03]: public.admin_list_other_store_clients(uuid) could not be resolved via to_regprocedure';
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

  -- 3. identity_argumentsが正確に一致
  if v_func2_identity is distinct from 'p_store_id uuid' then
    raise exception 'precondition failed [F2-03b]: admin_list_other_store_clients identity_arguments is not "p_store_id uuid" (found %)', v_func2_identity;
  end if;

  -- 4. prokind=function
  if v_func2_prokind <> 'f' then
    raise exception 'precondition failed [F2-04]: admin_list_other_store_clients prokind is not a plain function (found %)', v_func2_prokind;
  end if;

  -- 5. owner=postgres
  if v_func2_owner is distinct from 'postgres' then
    raise exception 'precondition failed [F2-05]: admin_list_other_store_clients owner is not "postgres" (found %)', v_func2_owner;
  end if;

  -- 6. language=plpgsql
  if v_func2_lang is distinct from 'plpgsql' then
    raise exception 'precondition failed [F2-06]: admin_list_other_store_clients language is not "plpgsql" (found %)', v_func2_lang;
  end if;

  -- 7. SECURITY DEFINER=true
  if v_func2_secdef is distinct from true then
    raise exception 'precondition failed [F2-07]: admin_list_other_store_clients is not SECURITY DEFINER';
  end if;

  -- 8. volatility=STABLE
  if v_func2_volatile is distinct from 's' then
    raise exception 'precondition failed [F2-08]: admin_list_other_store_clients volatility is not STABLE (found %)', v_func2_volatile;
  end if;

  -- 9. strict=false
  if v_func2_strict is distinct from false then
    raise exception 'precondition failed [F2-09]: admin_list_other_store_clients strict is not false';
  end if;

  -- 10. leakproof=false
  if v_func2_leakproof is distinct from false then
    raise exception 'precondition failed [F2-10]: admin_list_other_store_clients leakproof is not false';
  end if;

  -- 11. parallel=UNSAFE
  if v_func2_parallel is distinct from 'u' then
    raise exception 'precondition failed [F2-11]: admin_list_other_store_clients parallel is not UNSAFE (found %)', v_func2_parallel;
  end if;

  -- 12. proconfigが正確に array['search_path=""']::text[]
  -- （関数定義本体の SET search_path = '' は、pg_proc.proconfig 上では
  --  search_path="" という文字列として保存される。本番監査
  --  （Phase 5B-2H）実測値もこの表記であることを確認済み）
  if v_func2_proconfig is null or array_length(v_func2_proconfig, 1) <> 1 or v_func2_proconfig[1] <> 'search_path=""' then
    raise exception 'precondition failed [F2-12]: admin_list_other_store_clients proconfig is not exactly array[search_path=""] (found %)', v_func2_proconfig;
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

  -- 13. 戻り値列構成（列名・型・順序）が本番監査結果と完全一致
  if v_func2_cols_name is distinct from v_expected_cols2_name or v_func2_cols_type is distinct from v_expected_cols2_type then
    raise exception 'precondition failed [F2-13]: admin_list_other_store_clients output columns do not match the Phase 5B-2H audit result. names=% types=%', v_func2_cols_name, v_func2_cols_type;
  end if;

  v_func2_cn_pos  := array_position(v_func2_cols_name, 'customer_number');
  v_func2_cn_type := v_func2_cols_type[v_func2_cn_pos];

  -- 14. customer_numberがTABLE出力列として正確に1件
  if v_func2_cn_pos is null or (
    select count(*) from unnest(v_func2_cols_name) x where x = 'customer_number'
  ) <> 1 then
    raise exception 'precondition failed [F2-14]: admin_list_other_store_clients does not have exactly one customer_number output column';
  end if;

  -- 15. customer_numberの型がtext
  if v_func2_cn_type is distinct from 'text' then
    raise exception 'precondition failed [F2-15]: admin_list_other_store_clients customer_number column type is not text (found %)', v_func2_cn_type;
  end if;

  -- 16. customer_numberが出力列の途中（先頭でも末尾でもない）
  if v_func2_cn_pos = 1 or v_func2_cn_pos = array_length(v_func2_cols_name, 1) then
    raise exception 'precondition failed [F2-16]: admin_list_other_store_clients customer_number is at position % (first or last), expected a middle position', v_func2_cn_pos;
  end if;

  -- 17. 関数定義本文がc.customer_numberを返している
  if v_func2_def is null or v_func2_def not ilike '%c.customer_number%' then
    raise exception 'precondition failed [F2-17]: admin_list_other_store_clients definition does not currently reference c.customer_number';
  end if;

  -- 18. 関数定義本文が現在のrole・店舗判定を保持している
  if v_func2_def not ilike '%auth.uid()%' then
    raise exception 'precondition failed [F2-18a]: admin_list_other_store_clients definition is missing auth.uid() check';
  end if;
  if v_func2_def not ilike '%role%' or v_func2_def not ilike '%''admin''%' then
    raise exception 'precondition failed [F2-18b]: admin_list_other_store_clients definition is missing admin role check';
  end if;
  if v_func2_def not ilike '%store_id%' then
    raise exception 'precondition failed [F2-18c]: admin_list_other_store_clients definition is missing store_id check';
  end if;
  if v_func2_def not ilike '%is_super%' then
    raise exception 'precondition failed [F2-18d]: admin_list_other_store_clients definition is missing super_admin branch';
  end if;
  if v_func2_def not ilike '%permission denied%' or v_func2_def not ilike '%42501%' then
    raise exception 'precondition failed [F2-18e]: admin_list_other_store_clients definition is missing permission denied / SQLSTATE 42501';
  end if;

  -- 19-20. EXECUTE権限
  v_func2_pre_auth := has_function_privilege('authenticated', v_func2_oid::oid, 'EXECUTE');
  v_func2_pre_svc  := has_function_privilege('service_role',  v_func2_oid::oid, 'EXECUTE');
  v_func2_pre_anon := has_function_privilege('anon',           v_func2_oid::oid, 'EXECUTE');
  select exists (
    select 1 from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid = v_func2_oid::oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) into v_func2_pre_public;

  if not v_func2_pre_auth then
    raise exception 'precondition failed [F2-19a]: authenticated cannot currently EXECUTE admin_list_other_store_clients';
  end if;
  if not v_func2_pre_svc then
    raise exception 'precondition failed [F2-19b]: service_role cannot currently EXECUTE admin_list_other_store_clients';
  end if;
  if v_func2_pre_anon then
    raise exception 'precondition failed [F2-20a]: anon unexpectedly can EXECUTE admin_list_other_store_clients';
  end if;
  if v_func2_pre_public then
    raise exception 'precondition failed [F2-20b]: PUBLIC unexpectedly has a direct EXECUTE grant on admin_list_other_store_clients';
  end if;

  -- 21. owner postgresのrolbypassrls=true
  select exists (
    select 1 from pg_catalog.pg_roles r where r.rolname = v_func2_owner and r.rolbypassrls = true
  ) into v_func2_owner_bypassrls;
  if not v_func2_owner_bypassrls then
    raise exception 'precondition failed [F2-21]: owner % of admin_list_other_store_clients does not have rolbypassrls=true', v_func2_owner;
  end if;

  -- 22. 依存オブジェクト数=0
  select count(*) into v_func2_dep_count
  from pg_catalog.pg_depend d
  where d.refobjid = v_func2_oid::oid and d.refclassid = 'pg_catalog.pg_proc'::regclass;
  if v_func2_dep_count <> 0 then
    raise exception 'precondition failed [F2-22]: admin_list_other_store_clients unexpectedly has % dependent catalog object(s) (expected 0)', v_func2_dep_count;
  end if;

  -- MD5完全一致
  v_func2_def_norm := lower(regexp_replace(btrim(v_func2_def), '\s+', ' ', 'g'));
  v_func2_def_md5  := md5(v_func2_def_norm);
  if v_func2_def_md5 is distinct from v_func2_md5_expected then
    raise exception 'precondition failed [F2-MD5]: admin_list_other_store_clients normalized definition MD5 is % but expected % (production definition has drifted since the Phase 5B-2H audit)', v_func2_def_md5, v_func2_md5_expected;
  end if;

  -- 23-25. 変更前ACL・OID・所有者をトランザクションローカル設定へ記録
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

  perform set_config('phase5b2h_preflight.f2_pre_oid',   v_func2_oid::oid::text, true);
  perform set_config('phase5b2h_preflight.f2_pre_owner', v_func2_owner, true);
  perform set_config('phase5b2h_preflight.f2_pre_acl',   v_func2_pre_acl::text, true);

  -- ══════════════════════════════════════════════════════════
  -- 対象外2関数（sibling）：今回変更しない2関数の変更前定義MD5を記録する
  -- （customer_numberを返さないため対象外だが、preflight実行によって
  --  意図せず変更されていないことを後段で確認するための基準値）
  -- ══════════════════════════════════════════════════════════
  v_sibling1_oid := pg_catalog.to_regprocedure('public.admin_get_other_store_weight_logs(uuid)');
  if v_sibling1_oid is null then
    raise exception 'precondition failed [SIB-01]: public.admin_get_other_store_weight_logs(uuid) could not be resolved via to_regprocedure';
  end if;
  v_sibling1_md5 := md5(lower(regexp_replace(btrim(pg_catalog.pg_get_functiondef(v_sibling1_oid::oid)), '\s+', ' ', 'g')));
  perform set_config('phase5b2h_preflight.sibling1_pre_md5', v_sibling1_md5, true);

  v_sibling2_oid := pg_catalog.to_regprocedure('public.admin_get_other_store_meal_logs(uuid)');
  if v_sibling2_oid is null then
    raise exception 'precondition failed [SIB-02]: public.admin_get_other_store_meal_logs(uuid) could not be resolved via to_regprocedure';
  end if;
  v_sibling2_md5 := md5(lower(regexp_replace(btrim(pg_catalog.pg_get_functiondef(v_sibling2_oid::oid)), '\s+', ' ', 'g')));
  perform set_config('phase5b2h_preflight.sibling2_pre_md5', v_sibling2_md5, true);
end $$;

-- ══════════════════════════════════════════════════════════
-- すべてのpreconditionを通過した後にのみ到達する、一時的なCREATE OR
-- REPLACE FUNCTION。DOブロックは$$で区切られているため、内部でさらに
-- $$区切りの関数本体を持つCREATE FUNCTIONを直接ネストできない。そのため
-- precondition用のDOブロックとは別の、独立したトップレベルDDL文として
-- 実行する（同一トランザクション内であることに変わりはない）。
--
-- 変更点は各関数のRETURN QUERY内、customer_number出力位置にあった
-- 「c.customer_number」を「null::text」へ置き換えた1箇所だけ。
-- 関数名・入力引数・戻り値列名/列順/列型・language plpgsql・STABLE・
-- SECURITY DEFINER・SET search_path = ''・role判定・auth.uid()判定・
-- 呼び出し元store_id判定・対象store_id判定・同一店舗拒否・
-- super_admin分岐・permission denied・SQLSTATE 42501・SELECT対象・
-- WHERE条件・JOIN・ORDER BYは、リポジトリ確定済み定義
-- （supabase_other_store_detail_customer_number_rpc_update.sql /
--  supabase_other_store_list_summary_rpc_update.sql）および上記
-- MD5一致確認済みの本番定義から一切変更しない。
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
    -- 他店舗閲覧では顧客番号を公開しない。戻り値型維持のためNULL::textを返す。
    null::text,
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
    -- 他店舗閲覧では顧客番号を公開しない。戻り値型維持のためNULL::textを返す。
    null::text,
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
-- 対象外2関数（admin_get_other_store_weight_logs / admin_get_other_store_meal_logs）
-- が今回のpreflightによって変更されていないことの確認。カタログの
-- 正規化後定義文字列のMD5をpreflight開始時点の値と比較するのみで、
-- いずれの関数も呼び出さない。
--
-- 【表示順について】Supabase SQL Editorは複数のSELECTがある場合、
-- 最後の結果セットだけを表示する。このSELECTは最終結果として表示する
-- 対象ではないため、変更対象2RPCの一時変更後確認SELECT（このすぐ後、
-- rollback;の直前）より先に配置する。
-- ══════════════════════════════════════════════════════════
with siblings(function_name, oid, pre_md5) as (
  values
    (
      'admin_get_other_store_weight_logs(uuid)',
      pg_catalog.to_regprocedure('public.admin_get_other_store_weight_logs(uuid)')::oid,
      current_setting('phase5b2h_preflight.sibling1_pre_md5')
    ),
    (
      'admin_get_other_store_meal_logs(uuid)',
      pg_catalog.to_regprocedure('public.admin_get_other_store_meal_logs(uuid)')::oid,
      current_setting('phase5b2h_preflight.sibling2_pre_md5')
    )
)
select
  s.function_name,
  s.oid::text as function_oid,
  s.pre_md5   as pre_definition_normalized_md5,
  md5(lower(regexp_replace(btrim(pg_catalog.pg_get_functiondef(s.oid)), '\s+', ' ', 'g'))) as post_definition_normalized_md5,
  (
    md5(lower(regexp_replace(btrim(pg_catalog.pg_get_functiondef(s.oid)), '\s+', ' ', 'g'))) = s.pre_md5
  ) as definition_unchanged
from siblings s
order by s.function_name;

-- ══════════════════════════════════════════════════════════
-- CREATE OR REPLACE FUNCTION直後に、同一トランザクション内でpg_catalog
-- から実測値を取得する（対象2関数・対象外2関数のいずれも一切呼び出さない。
-- 実際の顧客データ・customer_number・氏名・UUID・store_code等は取得しない）。
--
-- 【表示順について】Supabase SQL Editorは複数のSELECTがある場合、
-- 最後の結果セットだけを表示するため、このSELECTをファイル内の最後の
-- SELECT（rollback;の直前）に配置する。列・判定ロジックは元の定義から
-- 変更していない。
-- ══════════════════════════════════════════════════════════
with
target_functions(function_name, oid, expected_col_count, expected_col_names) as (
  values
    (
      'admin_get_other_store_client(uuid)',
      pg_catalog.to_regprocedure('public.admin_get_other_store_client(uuid)')::oid,
      8,
      array['client_id','store_id','store_name','customer_number','age','height_cm','goal_weight','is_active']
    ),
    (
      'admin_list_other_store_clients(uuid)',
      pg_catalog.to_regprocedure('public.admin_list_other_store_clients(uuid)')::oid,
      24,
      array['client_id','store_id','store_name','customer_number','age','height_cm','goal_weight','is_active',
            'start_weight','latest_weight','last_log_date','last_log_morning_kg','last_log_evening_kg',
            'last_log_water_ml','last_log_toilet_count','last_log_sleep_hours','last_log_bowel_movement',
            'last_log_ate_breakfast','last_log_ate_lunch','last_log_ate_dinner','last_log_ate_snack',
            'last_log_breakfast_has_photo','last_log_lunch_has_photo','last_log_dinner_has_photo']
    )
),
pre_state(function_name, pre_oid, pre_owner, pre_acl) as (
  values
    (
      'admin_get_other_store_client(uuid)',
      current_setting('phase5b2h_preflight.f1_pre_oid'),
      current_setting('phase5b2h_preflight.f1_pre_owner'),
      current_setting('phase5b2h_preflight.f1_pre_acl')::jsonb
    ),
    (
      'admin_list_other_store_clients(uuid)',
      current_setting('phase5b2h_preflight.f2_pre_oid'),
      current_setting('phase5b2h_preflight.f2_pre_owner'),
      current_setting('phase5b2h_preflight.f2_pre_acl')::jsonb
    )
),
func_catalog as (
  select
    tf.function_name,
    tf.expected_col_count,
    tf.expected_col_names,
    p.oid,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid)              as result_type,
    pg_catalog.pg_get_userbyid(p.proowner)                as owner_name,
    l.lanname                                              as language_name,
    p.prosecdef, p.provolatile, p.proisstrict, p.proleakproof, p.proparallel,
    p.proconfig, p.proacl, p.proowner, p.proallargtypes, p.proargmodes, p.proargnames,
    pg_catalog.pg_get_functiondef(p.oid)                  as def_text
  from target_functions tf
  join pg_catalog.pg_proc p on p.oid = tf.oid
  join pg_catalog.pg_language l on l.oid = p.prolang
),
func_output_columns as (
  select
    fc.function_name,
    fc.oid,
    pos.ord,
    pos.argmode,
    pos.argname,
    pg_catalog.format_type(pos.argtype, null) as arg_type
  from func_catalog fc
  cross join lateral unnest(
    fc.proallargtypes,
    coalesce(fc.proargmodes, array_fill(null::"char", array[coalesce(array_length(fc.proallargtypes, 1), 0)])),
    coalesce(fc.proargnames, array_fill(null::text,    array[coalesce(array_length(fc.proallargtypes, 1), 0)]))
  ) with ordinality as pos(argtype, argmode, argname, ord)
  where fc.proallargtypes is not null
),
func_out_only as (
  select * from func_output_columns where argmode in ('o','b','t')
),
func_out_agg as (
  select
    function_name,
    array_agg(argname order by ord)               as col_names,
    count(*)                                       as col_count,
    min(ord) filter (where argname = 'customer_number') as cn_pos
  from func_out_only
  group by function_name
),
func_cn_type as (
  select function_name, arg_type as cn_type
  from func_out_only
  where argname = 'customer_number'
),
func_acl as (
  select
    fc.function_name,
    coalesce(jsonb_agg(jsonb_build_object(
      'grantee',        case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
      'privilege_type', a.privilege_type,
      'is_grantable',   a.is_grantable
    ) order by (case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end), a.privilege_type),
    '[]'::jsonb) as acl_full
  from func_catalog fc
  cross join lateral pg_catalog.aclexplode(coalesce(fc.proacl, pg_catalog.acldefault('f', fc.proowner))) a
  group by fc.function_name
)
select
  fc.function_name,
  fc.identity_arguments,
  fc.result_type,
  fc.owner_name                                                         as owner,
  fc.language_name                                                      as language,
  fc.prosecdef                                                          as security_definer,
  case fc.provolatile when 'i' then 'IMMUTABLE' when 's' then 'STABLE' when 'v' then 'VOLATILE' else null end as volatility,
  fc.proisstrict                                                        as strict,
  fc.proleakproof                                                       as leakproof,
  case fc.proparallel when 's' then 'SAFE' when 'r' then 'RESTRICTED' when 'u' then 'UNSAFE' else null end as parallel,
  to_jsonb(coalesce(fc.proconfig, array[]::text[]))                     as proconfig,
  exists (
    select 1 from unnest(coalesce(fc.proconfig, array[]::text[])) cfg where cfg like 'search_path=%'
  )                                                                      as has_explicit_search_path_setting,
  fc.oid::text                                                          as function_oid,
  (fc.oid::text = ps.pre_oid)                                           as function_oid_unchanged,
  (fc.owner_name = ps.pre_owner)                                        as owner_unchanged,
  coalesce(fa.acl_full, '[]'::jsonb)                                    as acl_full,
  (coalesce(fa.acl_full, '[]'::jsonb) = ps.pre_acl)                     as acl_unchanged,
  has_function_privilege('authenticated', fc.oid, 'EXECUTE')            as authenticated_can_execute,
  has_function_privilege('service_role',  fc.oid, 'EXECUTE')            as service_role_can_execute,
  has_function_privilege('anon',           fc.oid, 'EXECUTE')           as anon_can_execute,
  exists (
    select 1 from pg_catalog.aclexplode(coalesce(fc.proacl, pg_catalog.acldefault('f', fc.proowner))) a
    where a.grantee = 0 and a.privilege_type = 'EXECUTE'
  )                                                                      as public_direct_execute,
  fc.def_text                                                           as function_definition_full,
  lower(regexp_replace(btrim(fc.def_text), '\s+', ' ', 'g'))            as function_definition_normalized,
  md5(lower(regexp_replace(btrim(fc.def_text), '\s+', ' ', 'g')))       as function_definition_normalized_md5,
  (foa.cn_pos is not null)                                              as customer_number_output_exists,
  (fct.cn_type = 'text')                                                as customer_number_output_type_is_text,
  (foa.col_count = fc.expected_col_count)                               as output_column_count_unchanged,
  (foa.col_names = fc.expected_col_names)                               as output_column_order_unchanged,
  (fc.def_text ilike '%null::text%')                                    as definition_contains_null_text,
  (fc.def_text not ilike '%c.customer_number%')                         as definition_no_longer_returns_c_customer_number,
  (fc.def_text ilike '%auth.uid()%')                                    as has_auth_uid_check,
  (fc.def_text ilike '%role%' and fc.def_text ilike '%''admin''%')      as has_admin_role_check,
  (fc.def_text ilike '%store_id%')                                      as has_store_id_check,
  (fc.def_text ilike '%is_super%')                                      as has_super_admin_branch,
  (fc.def_text ilike '%permission denied%' and fc.def_text ilike '%42501%') as has_permission_denied_and_sqlstate
from func_catalog fc
left join pre_state    ps  on ps.function_name = fc.function_name
left join func_out_agg foa on foa.function_name = fc.function_name
left join func_cn_type fct on fct.function_name = fc.function_name
left join func_acl     fa  on fa.function_name = fc.function_name
order by fc.function_name;

rollback;
