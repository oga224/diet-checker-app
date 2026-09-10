-- ============================================================
-- Phase 5B-2G postcheck（読み取り専用）
-- supabase_phase5b_2g_customer_number_security_apply.sql 適用後、
-- public.customer_number_counters のRLS状態（rls_enabled/force_rls）・
-- Policy件数・authenticated/anon/PUBLIC/service_roleのACL、および
-- public.next_customer_number(text) の属性（owner/language/
-- security_definer/volatility/strict/leakproof/parallel/proconfig/
-- identity_arguments/result_type）・EXECUTE権限・データ整合性件数を
-- 確認する。
--
-- 本ファイルはレビュー・確認専用であり、それ自体は一切のデータ変更・
-- 権限変更を行わない（DDL・DML・GRANT/REVOKE・DO・CALL・動的SQLなし）。
--
-- 【完全なデパース後関数定義について】
-- next_customer_number(text)のpg_get_functiondef()全文は、Phase 5B-2G
-- function preflight実行時に「preflightで作成した安全化後の定義と
-- 完全一致した」ことが確認されているが、その完全なテキスト自体は
-- 本ファイル作成時点で文字列としては受け取っていない。そのため本
-- セクションでは、リテラル全文の厳密一致判定は行わず、代わりに
-- （a）owner/language/security_definer/volatility/strict/leakproof/
-- parallel/proconfig/identity_arguments/result_typeという、実測値が
-- 明確にわかっている属性群の厳密一致と、（b）デパース後定義に安全化
-- ロジックの主要な痕跡（SECURITY DEFINER・search_path・auth.role()・
-- auth.uid()・42501・on conflict (store_code)）が含まれることの2点で
-- 判定する。完全なテキスト自体はinformational（参考情報）として
-- そのまま出力するので、必要であれば目視で別途確認できる。
--
-- 対象はpublic.customer_number_counters / public.next_customer_number(text)
-- のRLS・Policy・ACL・関数属性・データ整合性件数のみ。public.profiles /
-- public.storesは関数内部の判定ロジックで参照されるだけで、本ファイルは
-- それ自体を変更する対象ではない（読み取り専用のためそもそも一切の
-- テーブルを変更しない）。
--
-- 個人情報（氏名・かな・メール・電話・住所・コメント本文・写真URL・
-- 個別UUID）・実際のstore_code・顧客番号は一切出力しない。件数は
-- informationalセクションのみとし、運用中に増減・変化する値
-- （総件数・各店舗のlast_number等）であるため自動判定は行わない。
-- 固定設計値（RLS状態・Policy件数・ACL・関数属性・NULL/孤立参照件数）は
-- matches_expectedで判定する。
--
-- 【scalar subqueryについて】
-- 以前のPhase 5B-2E postcheckの初期実装で、複数のboolean列をSELECT-list
-- 内で相互参照しようとして「scalar subqueryが複数列を返す」構造上の
-- 誤りが発生した経緯がある。本ファイルはそれを再発させないため、
-- すべてのSELECT-listは常に単一列のスカラーサブクエリのみを使用し、
-- 複数boolean列のAND判定は同一CTE内の直接列参照（サブクエリ化しない）
-- で行う。jsonb_aggがNULLになる場合（対象0件）は、必ず外側のcoalesceで
-- '[]'::jsonb に丸め、[null] を返さない。
-- ============================================================

begin;
set transaction read only;

with

-- ------------------------------------------------------------
-- 01_rls_state
-- ------------------------------------------------------------
rls_state as (
  select
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as force_rls
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'customer_number_counters'
),
sec01 as (
  select
    'rls_state' as section,
    coalesce((
      select jsonb_build_object(
        'table_name', 'customer_number_counters',
        'rls_enabled', rls_enabled,
        'force_rls', force_rls
      ) from rls_state
    ), jsonb_build_object('table_name', 'customer_number_counters', 'rls_enabled', null, 'force_rls', null)) as result,
    (
      (select count(*) from rls_state where rls_enabled = true and force_rls = false) = 1
    ) as matches_expected
),

-- ------------------------------------------------------------
-- 02_policies（0件であることを期待する。意図的な「全ロール拒否」設計）
-- ------------------------------------------------------------
policy_rows as (
  select p.policyname
  from pg_catalog.pg_policies p
  where p.schemaname = 'public' and p.tablename = 'customer_number_counters'
),
sec02 as (
  select
    'policies' as section,
    jsonb_build_object(
      'policy_count', (select count(*) from policy_rows),
      'policy_names', coalesce((select jsonb_agg(policyname order by policyname) from policy_rows), '[]'::jsonb)
    ) as result,
    ((select count(*) from policy_rows) = 0) as matches_expected
),

-- ------------------------------------------------------------
-- 03_acl（authenticated/anon/PUBLICは直接権限なし、service_roleは7権限すべてtrue）
-- ------------------------------------------------------------
priv_list (priv) as (
  values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')
),
role_priv as (
  select
    jsonb_object_agg(pl.priv, has_table_privilege('anon', 'public.customer_number_counters'::regclass, pl.priv)) as anon_privileges,
    jsonb_object_agg(pl.priv, has_table_privilege('authenticated', 'public.customer_number_counters'::regclass, pl.priv)) as authenticated_privileges,
    jsonb_object_agg(pl.priv, has_table_privilege('service_role', 'public.customer_number_counters'::regclass, pl.priv)) as service_role_privileges
  from priv_list pl
),
public_acl as (
  select
    coalesce(
      jsonb_agg(distinct a.privilege_type) filter (where a.privilege_type is not null),
      '[]'::jsonb
    ) as public_privileges
  from pg_catalog.pg_class c
  left join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    on a.grantee = 0
  where c.oid = 'public.customer_number_counters'::regclass
),
acl_combined as (
  select
    rp.anon_privileges,
    rp.authenticated_privileges,
    rp.service_role_privileges,
    pa.public_privileges
  from role_priv rp
  cross join public_acl pa
),
sec03 as (
  select
    'acl' as section,
    jsonb_build_object(
      'table_name', 'customer_number_counters',
      'anon_privileges', anon_privileges,
      'authenticated_privileges', authenticated_privileges,
      'service_role_privileges', service_role_privileges,
      'public_direct_acl', public_privileges
    ) as result,
    (
      -- anon/authenticatedは全項目false
      not exists (select 1 from jsonb_each(anon_privileges) e where (e.value)::boolean = true)
      and not exists (select 1 from jsonb_each(authenticated_privileges) e where (e.value)::boolean = true)
      -- PUBLICの直接ACLは空
      and jsonb_array_length(public_privileges) = 0
      -- service_role: 7権限すべてtrue（本ファイル・適用SQLとも変更していない権限）
      and service_role_privileges @> '{"SELECT":true,"INSERT":true,"UPDATE":true,"DELETE":true,"TRUNCATE":true,"REFERENCES":true,"TRIGGER":true}'::jsonb
    ) as matches_expected
  from acl_combined
),

-- ------------------------------------------------------------
-- Function共通カタログ（04〜05で再利用）
-- ------------------------------------------------------------
-- func_name_count: 'next_customer_number' という名前を持つ全overload数
-- （シグネチャを問わない）。これは informational な overload_count として
-- そのまま表示する。
func_name_count as (
  select count(*) as n
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'next_customer_number'
),
-- func_catalog: 属性検証の対象は next_customer_number(text) という
-- 特定のシグネチャ1件だけに、to_regprocedureで厳密に絞り込む。
-- 万が一異なるシグネチャのoverloadが別途存在しても、fc.*を用いる下流の
-- scalar subqueryが「1行のはずが複数行」でエラー終了しないようにする
-- ためのガードであり、apply/rollbackファイルのto_regprocedureによる
-- 関数解決と同じ方式に揃えている。
func_catalog as (
  select
    p.oid,
    pg_catalog.pg_get_userbyid(p.proowner) as owner_name,
    l.lanname as language_name,
    p.prosecdef,
    p.provolatile,
    p.proisstrict,
    p.proleakproof,
    p.proparallel,
    coalesce(p.proconfig, array[]::text[]) as proconfig,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) as result_type,
    pg_catalog.pg_get_functiondef(p.oid) as function_definition,
    p.proacl,
    p.proowner
  from pg_catalog.pg_proc p
  join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid = pg_catalog.to_regprocedure('public.next_customer_number(text)')::oid
),
func_count as (
  select n from func_name_count
),

-- ------------------------------------------------------------
-- 04_function_attributes
-- ------------------------------------------------------------
func_attr_checks as (
  select
    fc.*,
    (fc.owner_name = 'postgres') as owner_ok,
    (fc.language_name = 'plpgsql') as language_ok,
    (fc.prosecdef = true) as security_definer_ok,
    (fc.provolatile = 'v') as volatility_ok,
    (fc.proisstrict = false) as strict_ok,
    (fc.proleakproof = false) as leakproof_ok,
    (fc.proparallel = 'u') as parallel_ok,
    (fc.identity_arguments = 'p_store_code text') as identity_arguments_ok,
    (fc.result_type = 'text') as result_type_ok,
    (fc.proconfig = array['search_path=""']::text[]) as proconfig_ok,
    (
      fc.function_definition ilike '%security definer%'
      and fc.function_definition ilike '%search_path%'
      and fc.function_definition ilike '%auth.role()%'
      and fc.function_definition ilike '%auth.uid()%'
      and fc.function_definition ilike '%42501%'
      and fc.function_definition ilike '%on conflict (store_code)%'
    ) as definition_markers_ok
  from func_catalog fc
),
sec04 as (
  select
    'function_attributes' as section,
    jsonb_build_object(
      'function_name', 'next_customer_number',
      'exists', (select n from func_count) > 0,
      'overload_count', (select n from func_count),
      'owner', (select owner_name from func_attr_checks),
      'language', (select language_name from func_attr_checks),
      'security_definer', (select prosecdef from func_attr_checks),
      'volatility', (select case provolatile when 'i' then 'IMMUTABLE' when 's' then 'STABLE' when 'v' then 'VOLATILE' else null end from func_attr_checks),
      'strict', (select proisstrict from func_attr_checks),
      'leakproof', (select proleakproof from func_attr_checks),
      'parallel', (select case proparallel when 's' then 'SAFE' when 'r' then 'RESTRICTED' when 'u' then 'UNSAFE' else null end from func_attr_checks),
      'identity_arguments', (select identity_arguments from func_attr_checks),
      'result_type', (select result_type from func_attr_checks),
      'proconfig', (select to_jsonb(proconfig) from func_attr_checks),
      'has_explicit_search_path_setting', (select exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%') from func_attr_checks),
      'function_definition_full_informational', (select function_definition from func_attr_checks)
    ) as result,
    (
      (select n from func_count) = 1
      and coalesce((select owner_ok and language_ok and security_definer_ok and volatility_ok
                      and strict_ok and leakproof_ok and parallel_ok and identity_arguments_ok
                      and result_type_ok and proconfig_ok and definition_markers_ok
                    from func_attr_checks), false)
    ) as matches_expected
),

-- ------------------------------------------------------------
-- 05_function_execute_privileges
-- ------------------------------------------------------------
func_exec as (
  select
    fc.oid,
    has_function_privilege('anon', fc.oid, 'EXECUTE') as anon_can_execute,
    has_function_privilege('authenticated', fc.oid, 'EXECUTE') as authenticated_can_execute,
    has_function_privilege('service_role', fc.oid, 'EXECUTE') as service_role_can_execute,
    exists (
      select 1 from pg_catalog.aclexplode(coalesce(fc.proacl, pg_catalog.acldefault('f', fc.proowner))) a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) as public_direct_execute
  from func_catalog fc
),
sec05 as (
  select
    'function_execute_privileges' as section,
    jsonb_build_object(
      'function_name', 'next_customer_number',
      'anon_can_execute', (select anon_can_execute from func_exec),
      'authenticated_can_execute', (select authenticated_can_execute from func_exec),
      'service_role_can_execute', (select service_role_can_execute from func_exec),
      'public_direct_execute', (select public_direct_execute from func_exec)
    ) as result,
    coalesce((
      select (not anon_can_execute) and authenticated_can_execute and service_role_can_execute and (not public_direct_execute)
      from func_exec
    ), false) as matches_expected
),

-- ------------------------------------------------------------
-- 06_data_integrity_counts（NULL件数・孤立参照件数は0を期待値として判定する。
-- 実際のstore_code・顧客番号は一切出力しない）
-- ------------------------------------------------------------
integrity_counts as (
  select
    (select count(*) from public.customer_number_counters where store_code is null) as store_code_null_count,
    (select count(*) from public.customer_number_counters where last_number is null) as last_number_null_count,
    (select count(*) from public.customer_number_counters where last_number < 0) as last_number_negative_count,
    (select count(*) from (
       select store_code from public.customer_number_counters
       where store_code is not null
       group by store_code having count(*) > 1
     ) d) as store_code_duplicate_group_count,
    (select count(*)
       from public.customer_number_counters cn
       where cn.store_code is not null
         and not exists (select 1 from public.stores s where s.code = cn.store_code)) as counters_without_matching_store_count,
    (select count(*) from public.stores where code is null) as stores_code_null_count
),
sec06 as (
  select
    'data_integrity_counts' as section,
    to_jsonb(ic.*) as result,
    (
      ic.store_code_null_count = 0
      and ic.last_number_null_count = 0
      and ic.last_number_negative_count = 0
      and ic.store_code_duplicate_group_count = 0
      and ic.counters_without_matching_store_count = 0
      and ic.stores_code_null_count = 0
    ) as matches_expected
  from integrity_counts ic
),

-- ------------------------------------------------------------
-- 07_row_counts_informational（総件数・last_number分布は運用中に増減する
-- 値のため、informationalとして表示のみ。自動判定は行わない）
-- ------------------------------------------------------------
informational_counts as (
  select
    (select count(*) from public.customer_number_counters) as counters_total,
    (select count(*) from public.customer_number_counters where last_number = 0) as last_number_zero_count,
    (select count(*) from public.customer_number_counters where last_number > 0) as last_number_positive_count
),
sec07 as (
  select
    'row_counts_informational_only' as section,
    jsonb_build_object(
      'counters_total', (select counters_total from informational_counts),
      'last_number_zero_count', (select last_number_zero_count from informational_counts),
      'last_number_positive_count', (select last_number_positive_count from informational_counts),
      'note', 'これらは運用中に増減・変化する値であり、この postcheck 単独では正誤判定しない。適用直前に別途確認した値と目視で比較すること。'
    ) as result,
    null::boolean as matches_expected
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
union all
select section, result, matches_expected from sec06
union all
select section, result, matches_expected from sec07
order by section;

rollback;
