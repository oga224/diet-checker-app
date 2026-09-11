-- ============================================================
-- Phase 5B-2H: 他店舗匿名化RPC 4関数（admin_get_other_store_client /
-- admin_list_other_store_clients / admin_get_other_store_weight_logs /
-- admin_get_other_store_meal_logs）の customer_number 返却状況・
-- 本番読み取り専用事実確認監査
--
-- 目的：
--   4つの他店舗匿名化閲覧RPCについて、現在の本番状態
--   （存在・overload・所有者・security definer・search_path・
--    volatility・戻り値列構成・EXECUTE権限・関数定義本文・
--    依存関係）をシステムカタログだけから確認する。特に
--    admin_get_other_store_client / admin_list_other_store_clients が
--    customer_number を返しているかどうかを重点的に確認する。
--
--   実際の顧客データ（顧客番号・氏名・かな・メール・電話・住所・
--   UUID・store_code等の実値）は一切取得しない。列名・型・
--   真偽値・件数・関数定義（SQL構造のみ）だけを出力する。
--
-- 本ファイルはレビュー・確認専用であり、それ自体は一切のデータ変更・
-- スキーマ変更・権限変更を行わない（DDL・DML・GRANT/REVOKE・DO・CALL・
-- 動的SQL・対象RPCの実行呼び出しなし）。apply/rollback用の修復SQLは
-- 今回作成しない（事実確認のみ）。実行は本番のSQL Editor等で行うことを
-- 想定するが、本ファイル自体は今回まだ実行しない（作成・静的検証のみ）。
--
-- ── 前提条件（この監査SQLが暗黙に仮定する事項） ──────────────
-- 1. 本ファイルは pg_catalog / information_schema の読み取りが許可された
--    ロール（例：Supabase SQL Editor の postgres ロール）で実行される
--    前提。
-- 2. 全セクションはカタログ駆動であり、対象4関数のいずれかが本番に
--    存在しない場合でも exists=false / overload_count=0 として結果に
--    現れ、SQL全体は失敗しない。
-- 3. 対象4関数は public スキーマの同名関数として検索する
--    （schema=public かつ proname一致の全overloadを対象にし、単一
--    overloadを仮定しない）。
-- 4. リポジトリ内の supabase_other_store_anonymized_rpc.sql /
--    supabase_other_store_detail_customer_number_rpc_update.sql /
--    supabase_other_store_list_summary_rpc_update.sql に記載の定義は
--    あくまでリポジトリ上の記録であり、本番に同一内容が適用されている
--    ことを前提にしない。本番の事実はこの監査SQLの実行結果でのみ確定する。
-- 5. pg_get_functiondef() は集約関数等へ適用すると失敗しうるため、
--    対象を prokind in ('f','p')（通常関数・プロシージャ）へ事前に
--    CASE式で絞り込んでから呼び出し、それ以外の prokind では評価
--    自体を行わない。単一WHERE句のAND評価順序には依存しない。
-- ============================================================

begin;
set transaction read only;

with

-- ------------------------------------------------------------
-- 共通カタログ
-- ------------------------------------------------------------
target_names(function_name) as (
  values
    ('admin_get_other_store_client'),
    ('admin_list_other_store_clients'),
    ('admin_get_other_store_weight_logs'),
    ('admin_get_other_store_meal_logs')
),
role_exists as (
  select
    exists (select 1 from pg_catalog.pg_roles where rolname = 'anon')          as anon_exists,
    exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') as authenticated_exists,
    exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role')  as service_role_exists
),
sensitive_column_names(col_name) as (
  values
    ('name'), ('kana'), ('email'), ('phone'), ('phone_number'), ('tel'),
    ('address'), ('birthdate'), ('memo'), ('line_id'), ('emergency_contact')
),
ref_tables(table_name) as (
  values ('clients'), ('stores'), ('weight_logs'), ('meal_logs'), ('profiles')
),
ref_table_catalog as (
  select
    rt.table_name,
    (c.oid is not null)                    as tbl_exists,
    pg_catalog.pg_get_userbyid(c.relowner) as owner_name,
    c.relrowsecurity                       as rls_enabled,
    c.relforcerowsecurity                  as force_rls
  from ref_tables rt
  left join pg_catalog.pg_namespace n on n.nspname = 'public'
  left join pg_catalog.pg_class c
    on c.relname = rt.table_name and c.relnamespace = n.oid
),

-- 対象4関数（全overload）の基本カタログ
func_catalog as (
  select
    p.oid,
    p.proname                                              as function_name,
    pg_catalog.pg_get_function_identity_arguments(p.oid)    as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid)                as result_type,
    p.prokind,
    p.provolatile,
    p.proparallel,
    p.proisstrict,
    p.proleakproof,
    p.prosecdef,
    pg_catalog.pg_get_userbyid(p.proowner)                  as owner_name,
    l.lanname                                                as language_name,
    p.proconfig,
    p.proacl,
    p.proowner,
    p.proallargtypes,
    p.proargmodes,
    p.proargnames
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_language l on l.oid = p.prolang
  join target_names tn on tn.function_name = p.proname
  where n.nspname = 'public'
),

-- 出力列（RETURNS TABLE の列、および IN 引数）を位置付きで展開。
-- proargmodes/proargnames が NULL でも array_fill で長さを揃えて
-- unnest の暗黙パディングに依存しないようにする。
func_output_columns as (
  select
    fc.oid,
    fc.function_name,
    fc.identity_arguments,
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

-- ------------------------------------------------------------
-- 01_target_function_existence_and_overloads
-- ------------------------------------------------------------
sec01_per_function as (
  select
    tn.function_name,
    (select count(*) from func_catalog fc where fc.function_name = tn.function_name) as overload_count,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'identity_arguments', fc.identity_arguments,
        'result_type',        fc.result_type,
        'prokind', case fc.prokind
          when 'f' then 'function' when 'p' then 'procedure'
          when 'a' then 'aggregate' when 'w' then 'window' else fc.prokind::text end
      ) order by fc.identity_arguments)
      from func_catalog fc where fc.function_name = tn.function_name
    ), '[]'::jsonb) as overloads
  from target_names tn
),
sec01 as (
  select jsonb_build_object(
    'target_functions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'function_name',   function_name,
        'exists',          overload_count > 0,
        'overload_count',  overload_count,
        'overloads',       overloads
      ) order by function_name)
      from sec01_per_function
    ), '[]'::jsonb)
  ) as result
),

-- ------------------------------------------------------------
-- 02_function_attributes
-- ------------------------------------------------------------
sec02_rows as (
  select
    fc.function_name,
    fc.identity_arguments,
    fc.owner_name,
    fc.language_name,
    fc.prosecdef as security_definer,
    case fc.provolatile when 'i' then 'IMMUTABLE' when 's' then 'STABLE' when 'v' then 'VOLATILE' else null end as volatility,
    fc.proisstrict  as strict,
    fc.proleakproof as leakproof,
    case fc.proparallel when 's' then 'SAFE' when 'r' then 'RESTRICTED' when 'u' then 'UNSAFE' else null end as parallel,
    to_jsonb(coalesce(fc.proconfig, array[]::text[])) as proconfig,
    exists (
      select 1 from unnest(coalesce(fc.proconfig, array[]::text[])) cfg where cfg like 'search_path=%'
    ) as has_explicit_search_path_setting
  from func_catalog fc
),
sec02 as (
  select jsonb_build_object(
    'functions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'function_name',       function_name,
        'identity_arguments',  identity_arguments,
        'owner',                owner_name,
        'language',             language_name,
        'security_definer',     security_definer,
        'volatility',           volatility,
        'strict',               strict,
        'leakproof',            leakproof,
        'parallel',             parallel,
        'proconfig',            proconfig,
        'has_explicit_search_path_setting', has_explicit_search_path_setting
      ) order by function_name, identity_arguments)
      from sec02_rows
    ), '[]'::jsonb)
  ) as result
),

-- ------------------------------------------------------------
-- 03_function_output_arguments（RETURNS TABLE 列を位置付きで復元）
-- ------------------------------------------------------------
-- 出力列（OUT/INOUT/TABLE = 'o'/'b'/'t'）のみ。IN専用引数（'i'/'v'）は含まない。
sec03_out_rows as (
  select oid, function_name, identity_arguments, ord, argmode, argname, arg_type
  from func_output_columns
  where argmode in ('o','b','t')
),
-- 全引数（IN含む）を位置順にそのまま復元したもの。proallargtypes等の生配列を
-- 人間が読める形に展開した対応表であり、実引数値は含まない。
sec03_all_rows as (
  select oid, function_name, identity_arguments, ord, argmode, argname, arg_type
  from func_output_columns
),
sec03_per_function as (
  select
    fc.function_name,
    fc.identity_arguments,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'position',       r.ord,
        'argument_mode',  r.argmode,
        'column_name',    r.argname,
        'column_type',    r.arg_type
      ) order by r.ord)
      from sec03_out_rows r where r.oid = fc.oid
    ), '[]'::jsonb) as output_columns,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'position',       r.ord,
        'argument_mode',  r.argmode,
        'argument_name',  r.argname,
        'argument_type',  r.arg_type
      ) order by r.ord)
      from sec03_all_rows r where r.oid = fc.oid
    ), '[]'::jsonb) as all_arguments,
    -- proallargtypesがNULLの関数（OUT/TABLE引数を持たない関数）でも
    -- 空配列[]を返し、エラーにも[null]にもならないようcoalesceする。
    to_jsonb(coalesce(fc.proallargtypes, array[]::oid[]))  as proallargtypes,
    to_jsonb(coalesce(fc.proargmodes, array[]::"char"[]))  as proargmodes,
    to_jsonb(coalesce(fc.proargnames, array[]::text[]))    as proargnames
  from func_catalog fc
),
sec03 as (
  select jsonb_build_object(
    'functions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'function_name',      function_name,
        'identity_arguments', identity_arguments,
        'output_columns',     output_columns,
        'all_arguments',      all_arguments,
        'proallargtypes',     proallargtypes,
        'proargmodes',        proargmodes,
        'proargnames',        proargnames
      ) order by function_name, identity_arguments)
      from sec03_per_function
    ), '[]'::jsonb)
  ) as result
),

-- ------------------------------------------------------------
-- 04_customer_number_exposure（列名・真偽値・件数のみ。実値は含まない）
-- ------------------------------------------------------------
sec04_customer_number_flags as (
  select
    fc.oid,
    exists (
      select 1 from func_output_columns foc
      where foc.oid = fc.oid and foc.argmode in ('o','b','t') and foc.argname = 'customer_number'
    ) as has_customer_number_output,
    (
      select count(*) from func_output_columns foc
      where foc.oid = fc.oid and foc.argmode in ('o','b','t') and foc.argname = 'customer_number'
    ) as customer_number_output_count
  from func_catalog fc
),
sec04_defs as (
  select
    fc.oid,
    case when fc.prokind in ('f','p') then pg_catalog.pg_get_functiondef(fc.oid) else null end as def_text
  from func_catalog fc
),
sec04_sensitive as (
  select
    fc.oid,
    coalesce(
      jsonb_agg(distinct foc.argname) filter (where foc.argname in (select col_name from sensitive_column_names)),
      '[]'::jsonb
    ) as sensitive_output_columns
  from func_catalog fc
  left join func_output_columns foc on foc.oid = fc.oid and foc.argmode in ('o','b','t')
  group by fc.oid
),
sec04_rows as (
  select
    fc.function_name,
    fc.identity_arguments,
    cnf.has_customer_number_output,
    cnf.customer_number_output_count,
    (sd.def_text ilike '%customer_number%') as definition_references_customer_number,
    ss.sensitive_output_columns,
    (jsonb_array_length(ss.sensitive_output_columns) > 0) as has_sensitive_output_column
  from func_catalog fc
  join sec04_customer_number_flags cnf on cnf.oid = fc.oid
  join sec04_defs sd on sd.oid = fc.oid
  join sec04_sensitive ss on ss.oid = fc.oid
),
sec04 as (
  select jsonb_build_object(
    'functions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'function_name',       function_name,
        'identity_arguments',  identity_arguments,
        'has_customer_number_output_column',   has_customer_number_output,
        'customer_number_output_column_count', customer_number_output_count,
        'definition_references_customer_number', definition_references_customer_number,
        'sensitive_output_columns',   sensitive_output_columns,
        'has_sensitive_output_column', has_sensitive_output_column
      ) order by function_name, identity_arguments)
      from sec04_rows
    ), '[]'::jsonb)
  ) as result
),

-- ------------------------------------------------------------
-- 05_function_definitions（定義全文。個人データの実値は含まれない）
-- ------------------------------------------------------------
sec05_rows as (
  select
    fc.function_name,
    fc.identity_arguments,
    case when fc.prokind in ('f','p') then pg_catalog.pg_get_functiondef(fc.oid) else null end as definition,
    (fc.prokind not in ('f','p')) as skipped_non_function_prokind
  from func_catalog fc
),
sec05 as (
  select jsonb_build_object(
    'functions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'function_name',       function_name,
        'identity_arguments',  identity_arguments,
        'definition',          definition,
        'skipped_non_function_prokind', skipped_non_function_prokind
      ) order by function_name, identity_arguments)
      from sec05_rows
    ), '[]'::jsonb)
  ) as result
),

-- ------------------------------------------------------------
-- 06_execute_privileges
-- ------------------------------------------------------------
sec06_public_acl as (
  select
    fc.oid,
    coalesce(
      jsonb_agg(jsonb_build_object(
        'privilege_type', a.privilege_type,
        'is_grantable',   a.is_grantable
      ) order by a.privilege_type) filter (where a.grantee = 0),
      '[]'::jsonb
    ) as public_direct_acl
  from func_catalog fc
  cross join lateral pg_catalog.aclexplode(coalesce(fc.proacl, pg_catalog.acldefault('f', fc.proowner))) a
  group by fc.oid
),
sec06 as (
  select jsonb_build_object(
    'functions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'function_name',       fc.function_name,
        'identity_arguments',  fc.identity_arguments,
        'anon_can_execute',          case when (select anon_exists from role_exists)
                                        then has_function_privilege('anon', fc.oid, 'EXECUTE') else null end,
        'authenticated_can_execute', case when (select authenticated_exists from role_exists)
                                        then has_function_privilege('authenticated', fc.oid, 'EXECUTE') else null end,
        'service_role_can_execute',  case when (select service_role_exists from role_exists)
                                        then has_function_privilege('service_role', fc.oid, 'EXECUTE') else null end,
        'public_direct_execute_acl', coalesce(spa.public_direct_acl, '[]'::jsonb)
      ) order by fc.function_name, fc.identity_arguments)
      from func_catalog fc
      left join sec06_public_acl spa on spa.oid = fc.oid
    ), '[]'::jsonb)
  ) as result
),

-- ------------------------------------------------------------
-- 07_owner_and_rls_bypass_basis
-- ------------------------------------------------------------
sec07_per_function as (
  select
    fc.function_name,
    fc.identity_arguments,
    fc.prosecdef as security_definer,
    fc.owner_name,
    (select rolbypassrls from pg_catalog.pg_roles where rolname = fc.owner_name) as owner_bypassrls
  from func_catalog fc
),
sec07 as (
  select jsonb_build_object(
    'functions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'function_name',      function_name,
        'identity_arguments', identity_arguments,
        'security_definer',   security_definer,
        'owner',               owner_name,
        'owner_rolbypassrls',  owner_bypassrls
      ) order by function_name, identity_arguments)
      from sec07_per_function
    ), '[]'::jsonb),
    'referenced_tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table_name', table_name,
        'exists',     tbl_exists,
        'owner',      owner_name,
        'rls_enabled', rls_enabled,
        'force_rls',   force_rls
      ) order by table_name)
      from ref_table_catalog
    ), '[]'::jsonb)
  ) as result
),

-- ------------------------------------------------------------
-- 08_security_logic_markers（文字列一致による有無確認。最終評価は
-- 05のdefinitionを人間が読んで行うこと）
-- ------------------------------------------------------------
sec08_defs as (
  select
    fc.oid,
    fc.function_name,
    fc.identity_arguments,
    fc.prosecdef,
    fc.proconfig,
    case when fc.prokind in ('f','p') then pg_catalog.pg_get_functiondef(fc.oid) else null end as def_text
  from func_catalog fc
),
sec08_markers as (
  select
    function_name,
    identity_arguments,
    (def_text ilike '%auth.uid()%') as has_auth_uid_check,
    (def_text ilike '%role%' and def_text ilike '%''admin''%') as has_admin_role_check,
    (def_text ilike '%caller_store_id%') as has_caller_store_id_check,
    (def_text ilike '%target_store_id%') as has_target_store_id_check,
    (def_text ilike '%= v_caller_store_id%') as has_same_store_denial_pattern,
    (def_text ilike '%is_super%') as has_super_admin_branch,
    prosecdef as security_definer,
    exists (
      select 1 from unnest(coalesce(proconfig, array[]::text[])) cfg where cfg like 'search_path=%'
    ) as search_path_fixed,
    (
      def_text ilike '%public.clients%' or def_text ilike '%public.stores%' or
      def_text ilike '%public.weight_logs%' or def_text ilike '%public.meal_logs%' or
      def_text ilike '%public.profiles%'
    ) as schema_qualified_table_refs,
    (def_text ilike '%raise exception%' and def_text ilike '%permission denied%') as has_permission_denied_raise
  from sec08_defs
),
sec08 as (
  select jsonb_build_object(
    'functions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'function_name',       function_name,
        'identity_arguments',  identity_arguments,
        'has_auth_uid_check',           has_auth_uid_check,
        'has_admin_role_check',         has_admin_role_check,
        'has_caller_store_id_check',    has_caller_store_id_check,
        'has_target_store_id_check',    has_target_store_id_check,
        'has_same_store_denial_pattern', has_same_store_denial_pattern,
        'has_super_admin_branch',       has_super_admin_branch,
        'security_definer',             security_definer,
        'search_path_fixed',            search_path_fixed,
        'schema_qualified_table_refs',  schema_qualified_table_refs,
        'has_permission_denied_raise',  has_permission_denied_raise
      ) order by function_name, identity_arguments)
      from sec08_markers
    ), '[]'::jsonb)
  ) as result
),

-- ------------------------------------------------------------
-- 09_other_public_functions_exposing_customer_number
-- 対象4関数以外の public スキーマ関数のうち、customer_number を
-- 出力列に持つ、または定義本文で参照している関数を列挙する。
-- ------------------------------------------------------------
sec09_candidates as (
  select
    p.oid,
    p.proname as function_name,
    p.prokind,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid)             as result_type,
    p.proallargtypes,
    p.proargmodes,
    p.proargnames
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname not in (select function_name from target_names)
),
sec09_output_flag as (
  select
    sc.oid,
    exists (
      select 1
      from unnest(
        coalesce(sc.proallargtypes, array[]::oid[]),
        coalesce(sc.proargmodes, array_fill(null::"char", array[coalesce(array_length(sc.proallargtypes, 1), 0)])),
        coalesce(sc.proargnames, array_fill(null::text,    array[coalesce(array_length(sc.proallargtypes, 1), 0)]))
      ) as u(argtype, argmode, argname)
      where argmode in ('o','b','t') and argname = 'customer_number'
    ) as has_customer_number_output
  from sec09_candidates sc
),
sec09_def_flag as (
  select
    sc.oid,
    (case when sc.prokind in ('f','p') then pg_catalog.pg_get_functiondef(sc.oid) else null end ilike '%customer_number%') as references_customer_number
  from sec09_candidates sc
),
sec09_rows as (
  select
    sc.function_name,
    sc.identity_arguments,
    sc.result_type,
    coalesce(of_.has_customer_number_output, false) as has_customer_number_output,
    coalesce(df.references_customer_number, false)  as references_customer_number
  from sec09_candidates sc
  left join sec09_output_flag of_ on of_.oid = sc.oid
  left join sec09_def_flag df on df.oid = sc.oid
  where coalesce(of_.has_customer_number_output, false) or coalesce(df.references_customer_number, false)
),
sec09 as (
  select jsonb_build_object(
    'matching_function_count', (select count(*) from sec09_rows),
    'functions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'function_name',      function_name,
        'identity_arguments', identity_arguments,
        'result_type',        result_type,
        'has_customer_number_output_column',    has_customer_number_output,
        'definition_references_customer_number', references_customer_number
      ) order by function_name, identity_arguments)
      from sec09_rows
    ), '[]'::jsonb)
  ) as result
),

-- ------------------------------------------------------------
-- 10_dependency_and_recreation_risk
-- ------------------------------------------------------------
sec10_per_function as (
  select
    fc.oid,
    fc.function_name,
    fc.identity_arguments,
    fc.result_type,
    fc.owner_name,
    (
      select count(*) from func_output_columns foc
      where foc.oid = fc.oid and foc.argmode in ('o','b','t')
    ) as output_column_count,
    (
      select min(ord) from func_output_columns foc
      where foc.oid = fc.oid and foc.argmode in ('o','b','t') and foc.argname = 'customer_number'
    ) as customer_number_output_position,
    (
      select max(ord) from func_output_columns foc
      where foc.oid = fc.oid and foc.argmode in ('o','b','t')
    ) as max_output_position
  from func_catalog fc
),
sec10_acl as (
  select
    fc.oid,
    coalesce(
      jsonb_agg(jsonb_build_object(
        'grantee',        case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
        'privilege_type', a.privilege_type,
        'is_grantable',   a.is_grantable
      ) order by a.privilege_type),
      '[]'::jsonb
    ) as acl_list
  from func_catalog fc
  cross join lateral pg_catalog.aclexplode(coalesce(fc.proacl, pg_catalog.acldefault('f', fc.proowner))) a
  group by fc.oid
),
sec10_deps as (
  select
    fc.oid,
    d.deptype,
    pio.obj_type,
    pio.obj_identity
  from func_catalog fc
  join pg_catalog.pg_depend d
    on d.refobjid = fc.oid and d.refclassid = 'pg_catalog.pg_proc'::regclass
  cross join lateral pg_catalog.pg_identify_object(d.classid, d.objid, d.objsubid)
    as pio(obj_type, obj_schema, obj_name, obj_identity)
),
sec10_deps_agg as (
  select
    oid,
    count(*) as dependency_count,
    coalesce(
      jsonb_agg(jsonb_build_object(
        'dependency_type', case deptype
          when 'n' then 'normal' when 'a' then 'auto' when 'i' then 'internal'
          when 'e' then 'extension' when 'p' then 'pinned' else deptype::text end,
        'object_type',     obj_type,
        'object_identity', obj_identity
      ) order by obj_type, obj_identity),
      '[]'::jsonb
    ) as dependencies
  from sec10_deps
  group by oid
),
sec10_rows as (
  select
    spf.function_name,
    spf.identity_arguments,
    spf.result_type,
    spf.owner_name,
    spf.output_column_count,
    spf.customer_number_output_position,
    spf.max_output_position,
    (spf.customer_number_output_position is not null
      and spf.customer_number_output_position = spf.max_output_position) as customer_number_is_last_output_column,
    coalesce(sa.acl_list, '[]'::jsonb) as acl,
    coalesce(sda.dependency_count, 0)  as dependency_count,
    coalesce(sda.dependencies, '[]'::jsonb) as dependencies
  from sec10_per_function spf
  left join sec10_acl sa on sa.oid = spf.oid
  left join sec10_deps_agg sda on sda.oid = spf.oid
),
sec10 as (
  select jsonb_build_object(
    'functions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'function_name',       function_name,
        'identity_arguments',  identity_arguments,
        'result_type',         result_type,
        'owner',                owner_name,
        'output_column_count',  output_column_count,
        'customer_number_output_position',       customer_number_output_position,
        'customer_number_is_last_output_column', customer_number_is_last_output_column,
        'acl',              acl,
        'dependency_count', dependency_count,
        'dependencies',     dependencies
      ) order by function_name, identity_arguments)
      from sec10_rows
    ), '[]'::jsonb)
  ) as result
)

select '01_target_function_existence_and_overloads' as section, result from sec01
union all
select '02_function_attributes', result from sec02
union all
select '03_function_output_arguments', result from sec03
union all
select '04_customer_number_exposure', result from sec04
union all
select '05_function_definitions', result from sec05
union all
select '06_execute_privileges', result from sec06
union all
select '07_owner_and_rls_bypass_basis', result from sec07
union all
select '08_security_logic_markers', result from sec08
union all
select '09_other_public_functions_exposing_customer_number', result from sec09
union all
select '10_dependency_and_recreation_risk', result from sec10
order by section;

rollback;
