-- ============================================================
-- Phase 5B-2H customer_number NULL化 postcheck（読み取り専用）
--
-- supabase_phase5b_2h_customer_number_null_apply.sql 適用後、対象2関数
-- （admin_get_other_store_client(uuid) OID=18110 /
--  admin_list_other_store_clients(uuid) OID=18102）の属性・戻り値列構成・
-- customer_number出力列のNULL化挙動・EXECUTE権限、および変更対象外2関数
-- （admin_get_other_store_weight_logs(uuid) / admin_get_other_store_meal_
-- logs(uuid)）の定義が不変であることを、pg_catalogの読み取りだけで確認
-- する。対象RPC・対象外RPCのいずれも本ファイル内で実行呼び出しはしない。
--
-- 本ファイルはレビュー・確認専用であり、それ自体は一切のデータ変更・
-- スキーマ変更・権限変更を行わない（DDL・DML・GRANT/REVOKE・DO・CALL・
-- 動的SQLなし）。実際の顧客データ・customer_number・氏名・UUID・
-- store_code等の実値は一切取得・出力しない。
--
-- 正規化方法・期待値はapply.sqlと同一（本番PostgreSQL上で正規化式を
-- 直接実行して確定した実測値。外部ツールでの再計算値ではない）：
--   md5(lower(regexp_replace(btrim(pg_catalog.pg_get_functiondef(oid)), '\s+', ' ', 'g')))
--   admin_get_other_store_client(uuid)   変更後: 0778d69920d2ecc217544982ffffa475
--   admin_list_other_store_clients(uuid) 変更後: 11ebdab66a1f401f51efa54d2b79e985
--   admin_get_other_store_weight_logs(uuid) 不変: 7ccb5a42b9754bded475a8e82caa7a2b
--   admin_get_other_store_meal_logs(uuid)   不変: 98baea7f078a068614c144e1100a781b
--
-- 【scalar subqueryについて】
-- 過去のpostcheckで「subquery must return only one column」が発生した
-- 経緯があるため、本ファイルはSELECT-list内で複数列を返すサブクエリを
-- 一切使用しない。関数ごとの属性・判定は単一のCTE（func_checks）の列と
-- して直接保持し、セクションごとの集計はCTE行に対する集約関数
-- （jsonb_agg・bool_and）だけで行う。jsonb_aggがNULLになる場合
-- （対象0件）は、必ず外側のcoalesceで '[]'::jsonb に丸める。
--
-- すべてのUNION ALLブランチは (section text, result jsonb,
-- matches_expected boolean) の3列・同一型に統一する。
-- ============================================================

begin;
set transaction read only;

with

-- ------------------------------------------------------------
-- 対象2関数の期待値（apply.sql・Phase 5B-2H preflightの実測値と同一）
-- ------------------------------------------------------------
target_functions(function_name, want_base_name, oid, want_identity, want_oid, want_col_count, want_col_names, want_col_types, want_md5) as (
  values
    (
      'admin_get_other_store_client(uuid)',
      'admin_get_other_store_client',
      pg_catalog.to_regprocedure('public.admin_get_other_store_client(uuid)')::oid,
      'p_client_id uuid',
      18110::oid,
      8,
      array['client_id','store_id','store_name','customer_number','age','height_cm','goal_weight','is_active'],
      array['uuid','uuid','text','text','integer','numeric','numeric','boolean'],
      '0778d69920d2ecc217544982ffffa475'
    ),
    (
      'admin_list_other_store_clients(uuid)',
      'admin_list_other_store_clients',
      pg_catalog.to_regprocedure('public.admin_list_other_store_clients(uuid)')::oid,
      'p_store_id uuid',
      18102::oid,
      24,
      array['client_id','store_id','store_name','customer_number','age','height_cm','goal_weight','is_active',
            'start_weight','latest_weight','last_log_date','last_log_morning_kg','last_log_evening_kg',
            'last_log_water_ml','last_log_toilet_count','last_log_sleep_hours','last_log_bowel_movement',
            'last_log_ate_breakfast','last_log_ate_lunch','last_log_ate_dinner','last_log_ate_snack',
            'last_log_breakfast_has_photo','last_log_lunch_has_photo','last_log_dinner_has_photo'],
      array['uuid','uuid','text','text','integer','numeric','numeric','boolean',
            'numeric','numeric','date','numeric','numeric','integer','integer','numeric',
            'boolean','boolean','boolean','boolean','boolean','boolean','boolean','boolean'],
      '11ebdab66a1f401f51efa54d2b79e985'
    )
),
func_catalog as (
  select
    tf.function_name, tf.want_base_name, tf.want_identity, tf.want_oid, tf.want_col_count,
    tf.want_col_names, tf.want_col_types, tf.want_md5,
    p.oid,
    p.prokind,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_userbyid(p.proowner)                as owner_name,
    l.lanname                                              as language_name,
    p.prosecdef, p.provolatile, p.proisstrict, p.proleakproof, p.proparallel, p.proconfig,
    p.proacl, p.proowner, p.proallargtypes, p.proargmodes, p.proargnames,
    -- pg_get_functiondef()は集約関数・window関数等へ適用すると失敗しうるため、
    -- prokindが通常関数またはプロシージャである場合だけCASE式で安全に評価する
    -- （WHERE句によるフィルタの評価順序には依存しない）。
    case when p.prokind in ('f','p') then pg_catalog.pg_get_functiondef(p.oid) else null end as def_text
  from target_functions tf
  left join pg_catalog.pg_proc p on p.oid = tf.oid
  left join pg_catalog.pg_language l on l.oid = p.prolang
),
-- publicスキーマ内で同じbase function name（シグネチャを問わない）を持つ
-- 関数の総数。完全一致するuuidシグネチャが1件存在するだけではPASSにせず、
-- 同名の別overloadが1件でもあれば overload_count <> 1 として不合格にする。
func_overload_count as (
  select
    tf.function_name,
    (
      select count(*)
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = tf.want_base_name
    ) as overload_count
  from target_functions tf
),
-- SECURITY DEFINER関数のownerがRLSを迂回できる根拠（rolbypassrls）を確認する。
func_owner_bypassrls as (
  select
    fc.function_name,
    r.rolbypassrls as owner_has_bypassrls
  from func_catalog fc
  left join pg_catalog.pg_roles r on r.rolname = fc.owner_name
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
    array_agg(argname order by ord)  as col_names,
    array_agg(arg_type order by ord) as col_types,
    count(*)                         as col_count,
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
    -- 期待するACLは厳密に3件（authenticated/postgres/service_role、各EXECUTEかつ
    -- is_grantable=false）だけ。WITH GRANT OPTION付きの同名ロールはbadとして数える。
    count(*) filter (where not (
      a.privilege_type = 'EXECUTE' and a.grantee <> 0 and a.is_grantable = false
      and pg_catalog.pg_get_userbyid(a.grantee) in ('postgres','authenticated','service_role')
    )) as acl_bad_count,
    count(*) filter (where a.privilege_type = 'EXECUTE' and a.grantee <> 0 and a.is_grantable = false
      and pg_catalog.pg_get_userbyid(a.grantee) in ('postgres','authenticated','service_role')
    ) as acl_good_count,
    coalesce(jsonb_agg(jsonb_build_object(
      'grantee',        case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
      'privilege_type', a.privilege_type,
      'is_grantable',   a.is_grantable
    ) order by (case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end), a.privilege_type),
    '[]'::jsonb) as acl_full
  from (select * from func_catalog where oid is not null) fc
  cross join lateral pg_catalog.aclexplode(coalesce(fc.proacl, pg_catalog.acldefault('f', fc.proowner))) a
  group by fc.function_name
),

-- ------------------------------------------------------------
-- 関数ごとの属性・判定を1行に集約（複数列を返すスカラーサブクエリを
-- 作らないための基盤CTE）
-- ------------------------------------------------------------
func_checks as (
  select
    fc.function_name,
    fc.oid,
    fc.want_oid,
    fc.want_identity,
    fc.identity_arguments,
    fc.owner_name,
    fc.language_name,
    fc.prokind,
    fc.prosecdef,
    fc.provolatile,
    fc.proisstrict,
    fc.proleakproof,
    fc.proparallel,
    fc.proconfig,
    fc.def_text,
    fc.want_col_count,
    fc.want_col_names,
    fc.want_col_types,
    fc.want_md5,
    foa.col_names,
    foa.col_types,
    foa.col_count,
    foa.cn_pos,
    fct.cn_type,
    foc.overload_count,
    fob.owner_has_bypassrls,
    coalesce(fa.acl_bad_count, -1)  as acl_bad_count,
    coalesce(fa.acl_good_count, -1) as acl_good_count,
    coalesce(fa.acl_full, '[]'::jsonb) as acl_full,
    (fc.oid is not null)                          as exists_ok,
    (fc.oid is not null and fc.oid = fc.want_oid)  as oid_ok,
    (fc.identity_arguments = fc.want_identity)     as identity_ok,
    (fc.owner_name = 'postgres')                   as owner_ok,
    (fc.language_name = 'plpgsql')                 as language_ok,
    (foc.overload_count = 1)                       as overload_count_ok,
    (fc.prokind = 'f')                             as prokind_ok,
    (fc.prosecdef = true)                          as secdef_ok,
    (fc.provolatile = 's')                         as volatility_ok,
    (fc.proisstrict = false)                       as strict_ok,
    (fc.proleakproof = false)                      as leakproof_ok,
    (fc.proparallel = 'u')                         as parallel_ok,
    (fc.proconfig = array['search_path=""']::text[]) as search_path_ok,
    (fc.owner_name = 'postgres' and coalesce(fob.owner_has_bypassrls, false) = true) as owner_bypassrls_ok,
    (foa.col_count = fc.want_col_count)            as col_count_ok,
    (foa.col_names = fc.want_col_names)            as col_names_ok,
    (foa.col_types = fc.want_col_types)            as col_types_ok,
    (fct.cn_type is not null)                      as cn_exists_ok,
    (fct.cn_type = 'text')                         as cn_type_ok,
    (md5(lower(regexp_replace(btrim(fc.def_text), '\s+', ' ', 'g'))) = fc.want_md5) as md5_ok,
    (fc.def_text ilike '%null::text%')             as has_null_text,
    (fc.def_text not ilike '%c.customer_number%')  as no_customer_number_value,
    (fc.def_text ilike '%auth.uid()%')             as has_auth_uid,
    (fc.def_text ilike '%role%' and fc.def_text ilike '%''admin''%') as has_admin_role,
    (fc.def_text ilike '%store_id%')                as has_store_id,
    (fc.def_text ilike '%is_super%')                as has_super_admin,
    (fc.def_text ilike '%permission denied%' and fc.def_text ilike '%42501%') as has_permission_denied,
    (case when fc.oid is not null then has_function_privilege('authenticated', fc.oid, 'EXECUTE') else null end) as authenticated_can_execute,
    (case when fc.oid is not null then has_function_privilege('service_role',  fc.oid, 'EXECUTE') else null end) as service_role_can_execute,
    (case when fc.oid is not null then has_function_privilege('anon',           fc.oid, 'EXECUTE') else null end) as anon_can_execute,
    (case when fc.oid is not null then exists (
      select 1 from pg_catalog.aclexplode(coalesce(fc.proacl, pg_catalog.acldefault('f', fc.proowner))) a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) else null end) as public_direct_execute,
    -- ACL全文が、authenticated/postgres/service_role（各EXECUTE・is_grantable=false）の
    -- ちょうど3件だけと並び順まで完全一致することを確認する（PUBLICや他ロールの
    -- 混入、WITH GRANT OPTION付与、件数不足・過剰のいずれも不一致として検出する）。
    (
      coalesce(fa.acl_full, '[]'::jsonb) = jsonb_build_array(
        jsonb_build_object('grantee', 'authenticated', 'privilege_type', 'EXECUTE', 'is_grantable', false),
        jsonb_build_object('grantee', 'postgres',       'privilege_type', 'EXECUTE', 'is_grantable', false),
        jsonb_build_object('grantee', 'service_role',   'privilege_type', 'EXECUTE', 'is_grantable', false)
      )
    ) as acl_exact_ok
  from func_catalog fc
  left join func_out_agg foa on foa.function_name = fc.function_name
  left join func_cn_type fct on fct.function_name = fc.function_name
  left join func_acl     fa  on fa.function_name = fc.function_name
  left join func_overload_count foc on foc.function_name = fc.function_name
  left join func_owner_bypassrls fob on fob.function_name = fc.function_name
),

-- ------------------------------------------------------------
-- 01_function_attributes
-- ------------------------------------------------------------
sec01 as (
  select
    'function_attributes' as section,
    coalesce(jsonb_agg(jsonb_build_object(
      'function_name',                  function_name,
      'identity_arguments',             identity_arguments,
      'identity_arguments_expected',    want_identity,
      'oid',                             oid::text,
      'oid_expected',                    want_oid::text,
      'overload_count',                  overload_count,
      'prokind',                         case prokind
        when 'f' then 'function' when 'p' then 'procedure'
        when 'a' then 'aggregate' when 'w' then 'window'
        else prokind::text end,
      'owner',                           owner_name,
      'owner_has_bypassrls',              owner_has_bypassrls,
      'language',                        language_name,
      'security_definer',                prosecdef,
      'volatility',                      case provolatile when 'i' then 'IMMUTABLE' when 's' then 'STABLE' when 'v' then 'VOLATILE' else null end,
      'strict',                          proisstrict,
      'leakproof',                       proleakproof,
      'parallel',                        case proparallel when 's' then 'SAFE' when 'r' then 'RESTRICTED' when 'u' then 'UNSAFE' else null end,
      'proconfig',                       to_jsonb(coalesce(proconfig, array[]::text[])),
      'has_explicit_search_path_setting', search_path_ok
    ) order by function_name), '[]'::jsonb) as result,
    coalesce(bool_and(
      exists_ok and oid_ok and identity_ok and overload_count_ok and prokind_ok
      and owner_ok and language_ok and secdef_ok
      and volatility_ok and strict_ok and leakproof_ok and parallel_ok and search_path_ok
      and owner_bypassrls_ok
    ), false) as matches_expected
  from func_checks
),

-- ------------------------------------------------------------
-- 02_output_signatures
-- ------------------------------------------------------------
sec02 as (
  select
    'output_signatures' as section,
    coalesce(jsonb_agg(jsonb_build_object(
      'function_name',          function_name,
      'column_count',           col_count,
      'column_count_expected',  want_col_count,
      'column_names',           to_jsonb(coalesce(col_names, array[]::text[])),
      'column_types',           to_jsonb(coalesce(col_types, array[]::text[])),
      'customer_number_position', cn_pos,
      'customer_number_type',     cn_type
    ) order by function_name), '[]'::jsonb) as result,
    coalesce(bool_and(
      col_count_ok and col_names_ok and col_types_ok and cn_exists_ok and cn_type_ok
    ), false) as matches_expected
  from func_checks
),

-- ------------------------------------------------------------
-- 03_customer_number_null_behavior
-- ------------------------------------------------------------
sec03 as (
  select
    'customer_number_null_behavior' as section,
    coalesce(jsonb_agg(jsonb_build_object(
      'function_name',                   function_name,
      'definition_normalized_md5',       md5(lower(regexp_replace(btrim(def_text), '\s+', ' ', 'g'))),
      'definition_normalized_md5_expected', want_md5,
      'definition_contains_null_text',    has_null_text,
      'definition_no_longer_returns_c_customer_number', no_customer_number_value,
      'has_auth_uid_check',                has_auth_uid,
      'has_admin_role_check',              has_admin_role,
      'has_store_id_check',                has_store_id,
      'has_super_admin_branch',            has_super_admin,
      'has_permission_denied_and_sqlstate', has_permission_denied
    ) order by function_name), '[]'::jsonb) as result,
    coalesce(bool_and(
      md5_ok and has_null_text and no_customer_number_value
      and has_auth_uid and has_admin_role and has_store_id and has_super_admin and has_permission_denied
    ), false) as matches_expected
  from func_checks
),

-- ------------------------------------------------------------
-- 04_function_execute_privileges
-- ------------------------------------------------------------
sec04 as (
  select
    'function_execute_privileges' as section,
    coalesce(jsonb_agg(jsonb_build_object(
      'function_name',             function_name,
      'authenticated_can_execute', authenticated_can_execute,
      'service_role_can_execute',  service_role_can_execute,
      'anon_can_execute',          anon_can_execute,
      'public_direct_execute',     public_direct_execute,
      'acl_full',                  acl_full,
      'acl_entries_outside_expected_roles', acl_bad_count,
      'acl_entries_matching_expected_roles', acl_good_count,
      'acl_exact_match',           acl_exact_ok
    ) order by function_name), '[]'::jsonb) as result,
    coalesce(bool_and(
      coalesce(authenticated_can_execute, false)
      and coalesce(service_role_can_execute, false)
      and not coalesce(anon_can_execute, true)
      and not coalesce(public_direct_execute, true)
      and acl_bad_count = 0
      and acl_good_count = 3
      and acl_exact_ok
    ), false) as matches_expected
  from func_checks
),

-- ------------------------------------------------------------
-- 05_sibling_functions_unchanged
-- ------------------------------------------------------------
siblings(function_name, oid, want_md5) as (
  values
    (
      'admin_get_other_store_weight_logs(uuid)',
      pg_catalog.to_regprocedure('public.admin_get_other_store_weight_logs(uuid)')::oid,
      '7ccb5a42b9754bded475a8e82caa7a2b'
    ),
    (
      'admin_get_other_store_meal_logs(uuid)',
      pg_catalog.to_regprocedure('public.admin_get_other_store_meal_logs(uuid)')::oid,
      '98baea7f078a068614c144e1100a781b'
    )
),
sibling_checks as (
  select
    s.function_name,
    s.oid,
    s.want_md5,
    (s.oid is not null) as exists_ok,
    case when s.oid is not null
      then md5(lower(regexp_replace(btrim(pg_catalog.pg_get_functiondef(s.oid)), '\s+', ' ', 'g')))
      else null
    end as actual_md5
  from siblings s
),
sec05 as (
  select
    'sibling_functions_unchanged' as section,
    coalesce(jsonb_agg(jsonb_build_object(
      'function_name',                     function_name,
      'definition_normalized_md5',         actual_md5,
      'definition_normalized_md5_expected', want_md5,
      'unchanged',                          (actual_md5 = want_md5)
    ) order by function_name), '[]'::jsonb) as result,
    coalesce(bool_and(exists_ok and actual_md5 = want_md5), false) as matches_expected
  from sibling_checks
)

select section, result, matches_expected from sec01
union all
select section, result, matches_expected from sec02
union all
select section, result, matches_expected from sec03
union all
select section, result, matches_expected from sec04
union all
select section, result, matches_expected from sec05
order by section;

rollback;
