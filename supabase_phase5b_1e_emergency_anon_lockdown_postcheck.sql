-- ============================================================
-- Phase 5B-1E-2A postcheck（読み取り専用）
-- 緊急封じ込め（supabase_phase5b_1e_emergency_anon_lockdown.sql）適用後、
-- anon/PUBLICの権限が意図どおり遮断され、authenticated/service_role・
-- RLS・Policy・Function本体が変更されていないことを確認する。
-- 個人情報（氏名・かな・メール・電話・住所・コメント本文・写真URL・
-- 個別UUID）は一切出力しない。件数・boolean・スキーマメタデータのみ。
-- 単一の結果セット（section text, result jsonb）にUNION ALLで統合する。
-- ============================================================

begin;
set transaction read only;

with target_tables as (
  select unnest(array[
    'clients','weight_logs','meal_logs','admin_comments',
    'body_photos','stores','customer_number_counters','profiles'
  ]::text[]) as table_name
),
existing_tables as (
  select t.table_name
  from information_schema.tables t
  where t.table_schema = 'public'
    and t.table_name in (select table_name from target_tables)
),

-- 01. anon のテーブル権限（すべて false であることを期待）
anon_priv as (
  select
    e.table_name,
    pr.priv,
    has_table_privilege('anon', ('public.' || e.table_name)::regclass, pr.priv) as has_priv
  from existing_tables e
  cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) as pr(priv)
),
anon_priv_agg as (
  select table_name, jsonb_object_agg(priv, has_priv) as privs
  from anon_priv
  group by table_name
),
sec01 as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table_name', a.table_name,
    'privileges', a.privs,
    'all_false', not (a.privs @> '{"SELECT":true}'::jsonb
                    or a.privs @> '{"INSERT":true}'::jsonb
                    or a.privs @> '{"UPDATE":true}'::jsonb
                    or a.privs @> '{"DELETE":true}'::jsonb
                    or a.privs @> '{"TRUNCATE":true}'::jsonb
                    or a.privs @> '{"REFERENCES":true}'::jsonb
                    or a.privs @> '{"TRIGGER":true}'::jsonb)
  ) order by a.table_name), '[]'::jsonb) as result
  from anon_priv_agg a
),

-- 02. PUBLIC の直接ACL（空であることを期待）
public_acl as (
  select
    c.relname as table_name,
    jsonb_agg(distinct a.privilege_type) as public_privileges
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  where n.nspname = 'public'
    and c.relname in (select table_name from existing_tables)
    and a.grantee = 0
  group by c.relname
),
sec02 as (
  select jsonb_build_object(
    'tables_with_public_acl', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table_name', pa.table_name, 'public_privileges', pa.public_privileges
      ) order by pa.table_name), '[]'::jsonb)
      from public_acl pa
    ),
    'public_acl_is_empty', not exists (select 1 from public_acl)
  ) as result
),

-- 03. authenticated のテーブル権限（緊急対応前と同じ値であることを目視比較する用途）
authenticated_priv as (
  select
    e.table_name,
    pr.priv,
    has_table_privilege('authenticated', ('public.' || e.table_name)::regclass, pr.priv) as has_priv
  from existing_tables e
  cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) as pr(priv)
),
sec03 as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table_name', table_name, 'privileges', privs
  ) order by table_name), '[]'::jsonb) as result
  from (
    select table_name, jsonb_object_agg(priv, has_priv) as privs
    from authenticated_priv
    group by table_name
  ) x
),

-- 04. service_role のテーブル権限（緊急対応前と同じ値であることを目視比較する用途）
service_role_priv as (
  select
    e.table_name,
    pr.priv,
    has_table_privilege('service_role', ('public.' || e.table_name)::regclass, pr.priv) as has_priv
  from existing_tables e
  cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) as pr(priv)
),
sec04 as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table_name', table_name, 'privileges', privs
  ) order by table_name), '[]'::jsonb) as result
  from (
    select table_name, jsonb_object_agg(priv, has_priv) as privs
    from service_role_priv
    group by table_name
  ) x
),

-- 05. next_customer_number(text) の実効EXECUTE権限
-- Function特定は引数名に依存しない完全修飾OID解決（to_regprocedure）を使用する。
-- pg_get_function_identity_arguments()の返り値は引数名付き表記
-- （例: "p_store_code text"）になる場合があり、'text'との文字列完全一致では
-- 実在するFunctionを誤って検出できないことが本番実行で確認されたため変更した。
func_info as (
  select p.oid as func_oid, p.proacl, p.proowner
  from pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.next_customer_number(text)')
),
-- anon_can_execute/public_can_execute等はJSON出力キー名であり、同一SELECT階層の
-- 出力エイリアスを他の式から再参照することはできないため、期待値判定(matches_expected)
-- で使い回せるよう、まず実列として補助CTEに切り出す。
func_priv as (
  select
    fi.func_oid,
    has_function_privilege('anon', fi.func_oid, 'EXECUTE') as anon_can_execute,
    has_function_privilege('authenticated', fi.func_oid, 'EXECUTE') as authenticated_can_execute,
    has_function_privilege('service_role', fi.func_oid, 'EXECUTE') as service_role_can_execute,
    exists (
      select 1 from aclexplode(coalesce(fi.proacl, acldefault('f', fi.proowner))) a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) as public_can_execute
  from func_info fi
),
sec05 as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'anon_can_execute', fp.anon_can_execute,
    'authenticated_can_execute', fp.authenticated_can_execute,
    'service_role_can_execute', fp.service_role_can_execute,
    'public_can_execute', fp.public_can_execute,
    -- 期待状態(anon=false, public=false, authenticated=true, service_role=true)に
    -- 4項目すべて一致する場合だけtrue。IS NOT DISTINCT FROMを使うことで、
    -- 万一いずれかの値がNULLになってもtrueへ丸め込まれず必ずfalse側になる。
    'matches_expected', (
      fp.anon_can_execute          is not distinct from false
      and fp.public_can_execute    is not distinct from false
      and fp.authenticated_can_execute is not distinct from true
      and fp.service_role_can_execute  is not distinct from true
    )
  )), '[]'::jsonb) as result
  from func_priv fp
),

-- 06. 対象8テーブルのRLS状態（緊急対応で変更していないはずの値）
sec06 as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table_name', c.relname,
    'rls_enabled', c.relrowsecurity,
    'force_rls', c.relforcerowsecurity
  ) order by c.relname), '[]'::jsonb) as result
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (select table_name from existing_tables)
),

-- 07. Policy一覧（緊急対応で変更していないはずの一覧）
sec07 as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table_name', p.tablename,
    'policy_name', p.policyname,
    'permissive', p.permissive,
    'roles', p.roles,
    'cmd', p.cmd,
    'qual', p.qual,
    'with_check', p.with_check
  ) order by p.tablename, p.cmd, p.policyname), '[]'::jsonb) as result
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in (select table_name from existing_tables)
),

-- 08. next_customer_number(text) の定義本体（Function本体を変更していないことの確認）
-- Function特定は引数名に依存しない完全修飾OID解決（to_regprocedure）を使用する。
-- pg_get_function_identity_arguments()の返り値は引数名付き表記
-- （例: "p_store_code text"）になる場合があり、'text'との文字列完全一致では
-- 実在するFunctionを誤って検出できないことが本番実行で確認されたため変更した。
sec08 as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'security_definer', p.prosecdef,
    'volatility', case p.provolatile when 'i' then 'IMMUTABLE' when 's' then 'STABLE' when 'v' then 'VOLATILE' end,
    'search_path_setting', (select array_agg(cfg) from unnest(coalesce(p.proconfig, array[]::text[])) cfg where cfg like 'search_path=%'),
    'definition', pg_get_functiondef(p.oid)
  )), '[]'::jsonb) as result
  from pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.next_customer_number(text)')
)

select '01_anon_table_privileges' as section, result from sec01
union all
select '02_public_table_acl', result from sec02
union all
select '03_authenticated_table_privileges', result from sec03
union all
select '04_service_role_table_privileges', result from sec04
union all
select '05_next_customer_number_execute_privileges', result from sec05
union all
select '06_table_rls_state', result from sec06
union all
select '07_table_policies', result from sec07
union all
select '08_next_customer_number_definition', result from sec08
order by section;

rollback;
