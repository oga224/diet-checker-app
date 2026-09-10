-- ============================================================
-- Phase 5B-2G: public.customer_number_counters / public.next_customer_number
-- 本番読み取り専用事実確認監査
--
-- 目的：
--   顧客番号の採番台帳テーブル（customer_number_counters）と、それを
--   更新する採番関数（next_customer_number）の現在の本番状態を、
--   システムカタログと集計件数だけで確認する。実顧客の行データ・
--   個人情報・秘密情報・実際の店舗コードや顧客番号の値は一切取得しない。
--
-- 本ファイルはレビュー・確認専用であり、それ自体は一切のデータ変更・
-- スキーマ変更・権限変更を行わない（DDL・DML・GRANT/REVOKE・DO・CALL・
-- 動的SQLなし）。apply/rollback用の修復SQLは今回作成しない（事実確認のみ）。
-- 実行は本番のSQL Editor等で行うことを想定するが、本ファイル自体は
-- 今回まだ実行しない（作成・静的検証のみ）。
--
-- ── 前提条件（この監査SQLが暗黙に仮定する事項） ──────────────
-- 1. 本ファイルは pg_catalog / information_schema / pg_policies の
--    読み取りが許可されたロール（例：Supabase SQL Editor の postgres
--    ロール）で実行される前提。
-- 2. セクション01〜07・10はカタログ駆動（対象テーブル・対象関数が
--    本番に存在しない場合でも exists=false / overload_count=0 として
--    結果に現れ、SQL全体は失敗しない）。
-- 3. セクション12（データ整合性集計）・13（stores.codeとの対応関係）は
--    customer_number_counters と stores が実際に存在することを前提として
--    静的SQLで直接SELECT・regclassキャストする（件数・制約確認のみの
--    クエリのため）。これらのテーブルはsupabase_customer_number_unique_fix.sql
--    （8行目・6-11行目）で存在確認済みだが、本番の実列定義・制約は
--    セクション03・04・13で推測せずカタログから直接取得する。動的SQL・
--    DOブロックによる「存在しない場合の回避」は要件で禁止されているため
--    実装していない。したがって customer_number_counters または stores が
--    本番から削除されている場合、セクション12・13を含む本ファイル全体
--    （単一クエリ）が失敗する。
-- 4. next_customer_number は名前（pg_proc.proname）で検索し、overloadを
--    引数シグネチャ文字列の完全一致に依存せず列挙する
--    （supabase_customer_number_unique_fix.sql 27行目時点ではpublicスキーマ・
--    単一overload next_customer_number(text) として定義されているが、
--    本番に複数overloadが存在する可能性を排除しないため、schema=public
--    かつ proname一致の全overloadを対象にする）。
-- ============================================================

begin;
set transaction read only;

with

-- ------------------------------------------------------------
-- 共通カタログ
-- ------------------------------------------------------------
target_table_catalog as (
  select
    c.oid            as table_oid,
    c.relkind,
    c.relowner,
    c.relrowsecurity,
    c.relforcerowsecurity,
    c.relacl,
    (c.oid is not null) as table_exists
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'customer_number_counters'
),
priv_list (priv) as (
  values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
),
role_exists as (
  select
    exists (select 1 from pg_catalog.pg_roles where rolname = 'anon')          as anon_exists,
    exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') as authenticated_exists,
    exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role')  as service_role_exists
),

-- ------------------------------------------------------------
-- 01_table_existence_and_relkind
-- ------------------------------------------------------------
sec01 as (
  select coalesce((
    select jsonb_build_object(
      'schema',     'public',
      'table_name', 'customer_number_counters',
      'exists',     ttc.table_exists,
      'relkind',    case ttc.relkind
        when 'r' then 'ordinary_table'
        when 'p' then 'partitioned_table'
        when 'v' then 'view'
        when 'f' then 'foreign_table'
        when 'm' then 'materialized_view'
        else ttc.relkind::text
      end
    )
    from target_table_catalog ttc
  ), jsonb_build_object(
    'schema', 'public', 'table_name', 'customer_number_counters', 'exists', false, 'relkind', null
  )) as result
),

-- ------------------------------------------------------------
-- 02_rls_and_force_rls
-- ------------------------------------------------------------
sec02 as (
  select coalesce((
    select jsonb_build_object(
      'exists',      ttc.table_exists,
      'rls_enabled', ttc.relrowsecurity,
      'force_rls',   ttc.relforcerowsecurity
    )
    from target_table_catalog ttc
  ), jsonb_build_object('exists', false, 'rls_enabled', null, 'force_rls', null)) as result
),

-- ------------------------------------------------------------
-- 03_column_definitions（列名・型・NULL許可・default。値そのものは含まない）
-- ------------------------------------------------------------
sec03_rows as (
  select
    c.column_name,
    c.data_type,
    c.udt_name,
    (c.is_nullable = 'YES') as is_nullable,
    c.column_default,
    c.ordinal_position
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'customer_number_counters'
),
sec03 as (
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'column_name',     column_name,
      'data_type',       data_type,
      'udt_name',        udt_name,
      'is_nullable',     is_nullable,
      'column_default',  column_default
    ) order by ordinal_position)
    from sec03_rows
  ), '[]'::jsonb) as result
),

-- ------------------------------------------------------------
-- 04_constraints（主キー・UNIQUE・CHECK・外部キー）
-- ------------------------------------------------------------
sec04_rows as (
  select
    con.conname,
    case con.contype
      when 'p' then 'PRIMARY KEY'
      when 'f' then 'FOREIGN KEY'
      when 'u' then 'UNIQUE'
      when 'c' then 'CHECK'
      else con.contype::text
    end as constraint_type,
    pg_catalog.pg_get_constraintdef(con.oid) as definition,
    case when con.contype = 'f'
      then (select rc.relname from pg_catalog.pg_class rc where rc.oid = con.confrelid)
      else null end as references_table,
    case con.confupdtype
      when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
      when 'c' then 'CASCADE'   when 'n' then 'SET NULL'
      when 'd' then 'SET DEFAULT' else null end as on_update,
    case con.confdeltype
      when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
      when 'c' then 'CASCADE'   when 'n' then 'SET NULL'
      when 'd' then 'SET DEFAULT' else null end as on_delete
  from target_table_catalog ttc
  join pg_catalog.pg_constraint con on con.conrelid = ttc.table_oid
  where ttc.table_exists
),
sec04 as (
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'constraint_name',   conname,
      'constraint_type',   constraint_type,
      'definition',        definition,
      'references_table',  references_table,
      'on_update',          on_update,
      'on_delete',          on_delete
    ) order by conname)
    from sec04_rows
  ), '[]'::jsonb) as result
),

-- ------------------------------------------------------------
-- 05_current_policies
-- ------------------------------------------------------------
sec05_rows as (
  select
    p.policyname,
    p.permissive,
    p.roles,
    p.cmd,
    p.qual,
    p.with_check
  from pg_catalog.pg_policies p
  where p.schemaname = 'public' and p.tablename = 'customer_number_counters'
),
sec05 as (
  select jsonb_build_object(
    'policy_count', (select count(*) from sec05_rows),
    'policies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'policy_name',  policyname,
        'permissive',   permissive,
        'roles',        to_jsonb(roles),
        'cmd',          cmd,
        'qual',         qual,
        'with_check',   with_check
      ) order by cmd, policyname)
      from sec05_rows
    ), '[]'::jsonb)
  ) as result
),

-- ------------------------------------------------------------
-- 06_role_table_privileges（anon/authenticated/service_role）
-- ------------------------------------------------------------
sec06 as (
  select jsonb_build_object(
    'exists', coalesce((select table_exists from target_table_catalog), false),
    'anon_privileges', case when (select table_exists from target_table_catalog)
                          and (select anon_exists from role_exists) then (
      select jsonb_object_agg(pl.priv, has_table_privilege('anon', 'public.customer_number_counters'::regclass, pl.priv))
      from priv_list pl
    ) else null end,
    'authenticated_privileges', case when (select table_exists from target_table_catalog)
                                   and (select authenticated_exists from role_exists) then (
      select jsonb_object_agg(pl.priv, has_table_privilege('authenticated', 'public.customer_number_counters'::regclass, pl.priv))
      from priv_list pl
    ) else null end,
    'service_role_privileges', case when (select table_exists from target_table_catalog)
                                  and (select service_role_exists from role_exists) then (
      select jsonb_object_agg(pl.priv, has_table_privilege('service_role', 'public.customer_number_counters'::regclass, pl.priv))
      from priv_list pl
    ) else null end
  ) as result
),

-- ------------------------------------------------------------
-- 07_public_direct_acl
-- 付与が0件の場合は jsonb_agg(...) FILTER の結果が NULL になるため、
-- coalesce で必ず '[]'::jsonb に丸め、[null] ではなく [] として返す。
-- ------------------------------------------------------------
sec07 as (
  select jsonb_build_object(
    'exists', coalesce((select table_exists from target_table_catalog), false),
    'public_direct_acl', case when (select table_exists from target_table_catalog) then (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'privilege_type', a.privilege_type,
          'is_grantable',   a.is_grantable
        ) order by a.privilege_type) filter (where a.grantee = 0),
        '[]'::jsonb
      )
      from target_table_catalog ttc
      cross join lateral pg_catalog.aclexplode(coalesce(ttc.relacl, pg_catalog.acldefault('r', ttc.relowner))) a
    ) else null end
  ) as result
),

-- ------------------------------------------------------------
-- Function共通カタログ（08〜11で再利用）
-- ------------------------------------------------------------
func_catalog as (
  select
    p.oid,
    p.proname as function_name,
    n.nspname as schema_name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) as result_type,
    p.prokind,
    p.provolatile,
    p.proparallel,
    p.proisstrict,
    p.proleakproof,
    p.prosecdef,
    pg_catalog.pg_get_userbyid(p.proowner) as owner_name,
    l.lanname as language_name,
    p.proconfig,
    p.proacl,
    p.proowner
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_language l on l.oid = p.prolang
  where n.nspname = 'public' and p.proname = 'next_customer_number'
),

-- ------------------------------------------------------------
-- 08_next_customer_number_function_info
-- ------------------------------------------------------------
sec08_overloads as (
  select jsonb_build_object(
    'identity_arguments',  identity_arguments,
    'result_type',         result_type,
    'prokind',              case prokind
      when 'f' then 'function' when 'p' then 'procedure'
      when 'a' then 'aggregate' when 'w' then 'window' else prokind::text end,
    'owner',                owner_name,
    'language',             language_name,
    'security_definer',     prosecdef,
    'volatility',           case provolatile
      when 'i' then 'IMMUTABLE' when 's' then 'STABLE' when 'v' then 'VOLATILE' else null end,
    'strict',               proisstrict,
    'leakproof',            proleakproof,
    'parallel',             case proparallel
      when 's' then 'SAFE' when 'r' then 'RESTRICTED' when 'u' then 'UNSAFE' else null end,
    'proconfig',            to_jsonb(coalesce(proconfig, array[]::text[])),
    'has_explicit_search_path_setting', exists (
      select 1 from unnest(coalesce(proconfig, array[]::text[])) cfg where cfg like 'search_path=%'
    )
  ) as overload_obj
  from func_catalog
),
sec08 as (
  select jsonb_build_object(
    'function_name',  'next_customer_number',
    'exists',         (select count(*) from func_catalog) > 0,
    'overload_count', (select count(*) from func_catalog),
    'overloads',      coalesce((select jsonb_agg(overload_obj order by overload_obj) from sec08_overloads), '[]'::jsonb)
  ) as result
),

-- ------------------------------------------------------------
-- 09_next_customer_number_definition（関数定義全文。定義中に列名・
-- テーブル名が含まれるのは許容範囲。実行時の実データ値は含まれない）
-- ------------------------------------------------------------
sec09_overloads as (
  select jsonb_build_object(
    'identity_arguments', identity_arguments,
    'definition',         pg_catalog.pg_get_functiondef(oid)
  ) as overload_obj
  from func_catalog
),
sec09 as (
  select jsonb_build_object(
    'function_name',  'next_customer_number',
    'exists',         (select count(*) from func_catalog) > 0,
    'overload_count', (select count(*) from func_catalog),
    'overloads',      coalesce((select jsonb_agg(overload_obj order by overload_obj) from sec09_overloads), '[]'::jsonb)
  ) as result
),

-- ------------------------------------------------------------
-- 10_next_customer_number_execute_privileges
-- anon/authenticated/service_roleはhas_function_privilege()（ロール
-- 継承込みの実効権限）、PUBLICはproaclのaclexplode(grantee=0)で
-- 直接確認する。
-- ------------------------------------------------------------
sec10_overloads as (
  select jsonb_build_object(
    'identity_arguments',        fc.identity_arguments,
    'public_direct_execute',     exists (
      select 1 from pg_catalog.aclexplode(coalesce(fc.proacl, pg_catalog.acldefault('f', fc.proowner))) a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ),
    'anon_can_execute',          case when (select anon_exists from role_exists)
                                    then has_function_privilege('anon', fc.oid, 'EXECUTE') else null end,
    'authenticated_can_execute', case when (select authenticated_exists from role_exists)
                                    then has_function_privilege('authenticated', fc.oid, 'EXECUTE') else null end,
    'service_role_can_execute',  case when (select service_role_exists from role_exists)
                                    then has_function_privilege('service_role', fc.oid, 'EXECUTE') else null end
  ) as overload_obj
  from func_catalog fc
),
sec10 as (
  select jsonb_build_object(
    'function_name',  'next_customer_number',
    'exists',         (select count(*) from func_catalog) > 0,
    'overload_count', (select count(*) from func_catalog),
    'overloads',      coalesce((select jsonb_agg(overload_obj order by overload_obj) from sec10_overloads), '[]'::jsonb)
  ) as result
),

-- ------------------------------------------------------------
-- 11_other_functions_referencing_counters_table
-- customer_number_counters を関数定義本文中で参照する、
-- next_customer_number以外のpublicスキーマ関数を列挙する
-- （定義本文の文字列一致による検出。実データ値は含まない）。
-- ------------------------------------------------------------
-- pg_get_functiondef()はaggregate/window関数等では失敗しうるため、対象を
-- 通常関数・procedure（prokind in ('f','p')）へ先にCTEで絞り込んだうえで、
-- さらにCASE式でprokindがそれ以外の場合はpg_get_functiondef()自体を一切
-- 評価しないことを保証する（単一WHERE句内でANDにより評価順序へ暗黙に
-- 依存する書き方はしない）。
sec11_candidates as (
  select
    p.oid,
    p.proname as function_name,
    p.prokind,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname <> 'next_customer_number'
    and p.prokind in ('f', 'p')
),
sec11_rows as (
  select
    sc.function_name,
    sc.identity_arguments
  from sec11_candidates sc
  where (
    case when sc.prokind in ('f', 'p')
      then pg_catalog.pg_get_functiondef(sc.oid)
      else null
    end
  ) ilike '%customer_number_counters%'
),
sec11 as (
  select jsonb_build_object(
    'referencing_function_count', (select count(*) from sec11_rows),
    'referencing_functions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'function_name',       function_name,
        'identity_arguments',  identity_arguments
      ) order by function_name, identity_arguments)
      from sec11_rows
    ), '[]'::jsonb)
  ) as result
),

-- ------------------------------------------------------------
-- 12_data_integrity_counts
-- 実際の store_code・顧客番号の値は一切返さない（件数のみ）。
-- ------------------------------------------------------------
counters_norm as (
  select store_code, last_number from public.customer_number_counters
),
stores_norm as (
  select code from public.stores
),
sec12_counts as (
  select
    (select count(*) from counters_norm)                                        as counters_total,
    (select count(*) from counters_norm where store_code is null)                as store_code_null_count,
    (select count(*) from counters_norm where last_number is null)               as last_number_null_count,
    (select count(*) from counters_norm where last_number is not null and last_number <= 0) as last_number_non_positive_count,
    (select count(*) from (
       select store_code from counters_norm
       where store_code is not null
       group by store_code having count(*) > 1
     ) d)                                                                        as store_code_duplicate_group_count,
    (select count(*)
       from counters_norm cn
       where cn.store_code is not null
         and not exists (select 1 from stores_norm sn where sn.code = cn.store_code)) as counters_without_matching_store_count,
    (select count(*)
       from stores_norm sn
       where sn.code is not null
         and not exists (select 1 from counters_norm cn where cn.store_code = sn.code)) as stores_without_counter_row_count
),
sec12 as (
  select to_jsonb(sec12_counts.*) as result from sec12_counts
),

-- ------------------------------------------------------------
-- 13_stores_code_relationship（列定義・制約のみ。実際のcode値は含まない）
-- ------------------------------------------------------------
stores_code_column as (
  select
    c.data_type, c.udt_name, (c.is_nullable = 'YES') as is_nullable
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'stores' and c.column_name = 'code'
),
stores_code_constraints as (
  select
    con.conname,
    case con.contype when 'u' then 'UNIQUE' when 'p' then 'PRIMARY KEY' when 'c' then 'CHECK' else con.contype::text end as constraint_type,
    pg_catalog.pg_get_constraintdef(con.oid) as definition
  from pg_catalog.pg_constraint con
  where con.conrelid = 'public.stores'::regclass
    and pg_catalog.pg_get_constraintdef(con.oid) ilike '%code%'
),
-- customer_number_counters(store_code) -> stores(code) を厳密に指す外部
-- キーのみを対象にする。conrelid/confrelidだけでなく、conkey/confkeyを
-- pg_attributeで実列名へ解決し、位置（ordinality）を揃えて比較すること
-- で、複合外部キーであっても列位置の対応を誤判定しない
-- （例：(store_code, x) -> (y, code) のような順序違いの複合キーを
--  誤ってstore_code→codeの対応と判定しない）。
fk_counters_to_stores_candidates as (
  select
    con.oid,
    con.conname,
    pg_catalog.pg_get_constraintdef(con.oid) as definition,
    con.conkey,
    con.confkey
  from pg_catalog.pg_constraint con
  where con.conrelid  = 'public.customer_number_counters'::regclass
    and con.confrelid = 'public.stores'::regclass
    and con.contype = 'f'
),
fk_counters_to_stores_columns as (
  select
    fcc.oid,
    pos.ord,
    la.attname as local_column,
    fa.attname as foreign_column
  from fk_counters_to_stores_candidates fcc
  cross join lateral unnest(fcc.conkey, fcc.confkey)
    with ordinality as pos(local_attnum, foreign_attnum, ord)
  join pg_catalog.pg_attribute la
    on la.attrelid = 'public.customer_number_counters'::regclass and la.attnum = pos.local_attnum
  join pg_catalog.pg_attribute fa
    on fa.attrelid = 'public.stores'::regclass and fa.attnum = pos.foreign_attnum
),
fk_counters_to_stores as (
  select fcc.conname, fcc.definition
  from fk_counters_to_stores_candidates fcc
  where (
    select array_agg(fcc2.local_column order by fcc2.ord)
    from fk_counters_to_stores_columns fcc2
    where fcc2.oid = fcc.oid
  ) = array['store_code']::name[]
    and (
    select array_agg(fcc2.foreign_column order by fcc2.ord)
    from fk_counters_to_stores_columns fcc2
    where fcc2.oid = fcc.oid
  ) = array['code']::name[]
),
sec13 as (
  select jsonb_build_object(
    'stores_code_column_exists',   (select count(*) from stores_code_column) = 1,
    'stores_code_data_type',       (select data_type from stores_code_column),
    'stores_code_udt_name',        (select udt_name from stores_code_column),
    'stores_code_is_nullable',     (select is_nullable from stores_code_column),
    'stores_code_related_constraints', coalesce((
      select jsonb_agg(jsonb_build_object(
        'constraint_name', conname, 'constraint_type', constraint_type, 'definition', definition
      ) order by conname)
      from stores_code_constraints
    ), '[]'::jsonb),
    'counters_has_foreign_key_to_stores', (select count(*) from fk_counters_to_stores) > 0,
    'counters_to_stores_foreign_keys', coalesce((
      select jsonb_agg(jsonb_build_object('constraint_name', conname, 'definition', definition) order by conname)
      from fk_counters_to_stores
    ), '[]'::jsonb)
  ) as result
)

select '01_table_existence_and_relkind' as section, result from sec01
union all
select '02_rls_and_force_rls', result from sec02
union all
select '03_column_definitions', result from sec03
union all
select '04_constraints', result from sec04
union all
select '05_current_policies', result from sec05
union all
select '06_role_table_privileges', result from sec06
union all
select '07_public_direct_acl', result from sec07
union all
select '08_next_customer_number_function_info', result from sec08
union all
select '09_next_customer_number_definition', result from sec09
union all
select '10_next_customer_number_execute_privileges', result from sec10
union all
select '11_other_functions_referencing_counters_table', result from sec11
union all
select '12_data_integrity_counts', result from sec12
union all
select '13_stores_code_relationship', result from sec13
order by section;

rollback;
