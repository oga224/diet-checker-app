-- ============================================================
-- Phase 5B-2B: RLS本対応前・本番メタデータ読み取り専用監査
--
-- 目的：
--   Phase 5B-2A（コード・SQL履歴監査）だけでは判断できない、本番の
--   実際のメタデータ（RLS状態・Policy定義・Function定義・権限・
--   制約・不整合件数）をシステムカタログと集計件数だけで確認する。
--   実顧客の行データ・個人情報・秘密情報は一切取得しない。
--
-- 本ファイルはレビュー・確認専用であり、それ自体は一切のデータ変更・
-- 権限変更を行わない（DDL・DML・GRANT/REVOKEなし）。
-- 実行は本番のSQL Editor等で行うことを想定するが、本ファイル自体は
-- 今回まだ実行しない（作成・静的検証のみ）。
--
-- ── 前提条件（この監査SQLが暗黙に仮定する事項） ──────────────
-- 1. 本ファイルは pg_catalog / information_schema / pg_policies /
--    storage.buckets / storage.objects の読み取りが許可されたロール
--    （例：Supabase SQL Editor の postgres ロール）で実行される前提。
-- 2. セクション 01/02/03 はカタログ駆動（unnest + LEFT JOIN）で
--    構成されており、対象テーブルが本番に存在しない場合でも
--    exists=false として結果に現れ、SQL全体は失敗しない。
-- 3. セクション 05/06/07/08 は、対象テーブル（clients・
--    customer_number_counters・meal_logs・stores・weight_logs・
--    admin_comments・body_photos・profiles）が実際に存在することを
--    前提として、それらのテーブルへ静的SQLで直接 SELECT する
--    （件数・存在確認のクエリのため）。これらのテーブルは
--    Phase 5B-1E緊急封じ込めのprecheckで存在確認済みであり、本ファイルは
--    その事実を前提として採用する。動的SQL・DOブロックによる
--    「存在しない場合の回避」は要件で禁止されているため実装していない。
--    したがって、対象テーブルのいずれかが本番から削除されている場合、
--    本ファイル全体（単一クエリ）が失敗する。
-- 4. セクション 05 は auth.users を参照する（件数確認のみ、個別値は
--    取得しない）。auth.users への読み取り権限が実行ロールに無い場合、
--    本ファイル全体が失敗する。例外を握りつぶすための DO は使用して
--    いないため、これは意図した挙動である（黙って0件を返すよりも、
--    権限不足を明示的に失敗として検知する方を優先した）。
-- 5. next_customer_number および他店舗匿名化RPC4関数は、名前
--    （pg_proc.proname）で検索し、overloadを引数シグネチャ文字列の
--    完全一致に依存せず列挙する。今回参照した既存SQL
--    （supabase_customer_number_unique_fix.sql,
--     supabase_other_store_anonymized_rpc.sql,
--     supabase_other_store_detail_customer_number_rpc_update.sql,
--     supabase_other_store_list_summary_rpc_update.sql）では、
--    いずれも public スキーマ・単一overload（next_customer_number(text)、
--    他4関数は各 (uuid) 単一引数）として定義されているが、本番に
--    複数overloadが存在する可能性を排除しないため、本ファイルは
--    schema=public かつ proname一致の全overloadを対象にする。
-- ============================================================

begin;
set transaction read only;

with

-- ------------------------------------------------------------
-- 対象8テーブルの共通定義（複数セクションで再利用）
-- ------------------------------------------------------------
target_tables (table_name) as (
  values
    ('clients'),
    ('customer_number_counters'),
    ('meal_logs'),
    ('stores'),
    ('weight_logs'),
    ('admin_comments'),
    ('body_photos'),
    ('profiles')
),
target5_tables (table_name) as (
  values
    ('clients'),
    ('customer_number_counters'),
    ('meal_logs'),
    ('stores'),
    ('weight_logs')
),
target_table_catalog as (
  select
    t.table_name,
    c.oid            as table_oid,
    c.relkind,
    c.relowner,
    c.relrowsecurity,
    c.relforcerowsecurity,
    c.relacl,
    (c.oid is not null) as table_exists
  from target_tables t
  left join pg_catalog.pg_class c
    on c.relname = t.table_name
   and c.relnamespace = 'public'::regnamespace
),
priv_list (priv) as (
  values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
),
role_exists as (
  select
    exists (select 1 from pg_catalog.pg_roles where rolname = 'anon')           as anon_exists,
    exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated')  as authenticated_exists,
    exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role')   as service_role_exists
),

-- ------------------------------------------------------------
-- 01_target_table_rls_and_owners
-- ------------------------------------------------------------
sec01_rows as (
  select
    ttc.table_name,
    ttc.table_exists as exists,
    case when ttc.table_exists then pg_catalog.pg_get_userbyid(ttc.relowner) else null end as owner_name,
    ttc.relrowsecurity        as rls_enabled,
    ttc.relforcerowsecurity   as force_rls,
    case ttc.relkind
      when 'r' then 'ordinary_table'
      when 'p' then 'partitioned_table'
      when 'v' then 'view'
      when 'f' then 'foreign_table'
      when 'm' then 'materialized_view'
      else ttc.relkind::text
    end as relkind_label
  from target_table_catalog ttc
),
sec01 as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema',      'public',
    'table_name',  table_name,
    'exists',      exists,
    'owner',       owner_name,
    'rls_enabled', rls_enabled,
    'force_rls',   force_rls,
    'relkind',     relkind_label
  ) order by table_name), '[]'::jsonb) as result
  from sec01_rows
),

-- ------------------------------------------------------------
-- 02_target_table_acl
-- PUBLIC は relacl の aclexplode(grantee = 0) で直接確認する
-- （has_table_privilege('public', ...) のような疑似ロール名の
--  文字列一致には依存しない）。anon/authenticated/service_role/owner は
-- has_table_privilege() でロール継承込みの実効権限を確認する。
-- ------------------------------------------------------------
sec02_rows as (
  select
    t.table_name,
    ttc.table_exists as exists,
    case when ttc.table_exists then (
      select jsonb_object_agg(pl.priv, exists (
        select 1
        from pg_catalog.aclexplode(coalesce(ttc.relacl, pg_catalog.acldefault('r', ttc.relowner))) a
        where a.grantee = 0 and a.privilege_type = pl.priv
      ))
      from priv_list pl
    ) else null end as public_privileges,
    case when ttc.table_exists and (select anon_exists from role_exists) then (
      select jsonb_object_agg(pl.priv, has_table_privilege('anon', ttc.table_oid, pl.priv))
      from priv_list pl
    ) else null end as anon_privileges,
    case when ttc.table_exists and (select authenticated_exists from role_exists) then (
      select jsonb_object_agg(pl.priv, has_table_privilege('authenticated', ttc.table_oid, pl.priv))
      from priv_list pl
    ) else null end as authenticated_privileges,
    case when ttc.table_exists and (select service_role_exists from role_exists) then (
      select jsonb_object_agg(pl.priv, has_table_privilege('service_role', ttc.table_oid, pl.priv))
      from priv_list pl
    ) else null end as service_role_privileges,
    case when ttc.table_exists then (
      select jsonb_object_agg(pl.priv, has_table_privilege(pg_catalog.pg_get_userbyid(ttc.relowner), ttc.table_oid, pl.priv))
      from priv_list pl
    ) else null end as owner_privileges
  from target_tables t
  left join target_table_catalog ttc on ttc.table_name = t.table_name
),
sec02 as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table_name',              table_name,
    'exists',                  exists,
    'public_privileges',       public_privileges,
    'anon_privileges',         anon_privileges,
    'authenticated_privileges', authenticated_privileges,
    'service_role_privileges', service_role_privileges,
    'owner_privileges',        owner_privileges
  ) order by table_name), '[]'::jsonb) as result
  from sec02_rows
),

-- ------------------------------------------------------------
-- 03_current_policies
-- ------------------------------------------------------------
policy_raw as (
  select
    p.schemaname,
    p.tablename,
    p.policyname,
    p.permissive,
    p.roles,
    p.cmd,
    p.qual,
    p.with_check
  from pg_catalog.pg_policies p
  where p.schemaname = 'public'
    and p.tablename in (select table_name from target_tables)
),
sec03_per_table as (
  select
    t.table_name,
    coalesce(jsonb_agg(jsonb_build_object(
      'policy_name',  pr.policyname,
      'permissive',   pr.permissive,
      'roles',        to_jsonb(pr.roles),
      'cmd',          pr.cmd,
      'qual',         pr.qual,
      'with_check',   pr.with_check
    ) order by pr.cmd, pr.policyname) filter (where pr.policyname is not null), '[]'::jsonb) as policies,
    count(pr.policyname) as policy_count
  from target_tables t
  left join policy_raw pr on pr.tablename = t.table_name
  group by t.table_name
),
sec03 as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table_name',   table_name,
    'policy_count', policy_count,
    'policies',     policies
  ) order by table_name), '[]'::jsonb) as result
  from sec03_per_table
),

-- ------------------------------------------------------------
-- 04_profile_schema_and_constraints
-- ------------------------------------------------------------
profiles_oid as (
  select table_oid, table_exists from target_table_catalog where table_name = 'profiles'
),
profiles_columns as (
  select
    coalesce(jsonb_object_agg(c.column_name, jsonb_build_object(
      'data_type',              c.data_type,
      'udt_name',                c.udt_name,
      'is_nullable',             (c.is_nullable = 'YES'),
      'column_default',          c.column_default
    )), '{}'::jsonb) as columns
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'profiles'
    and c.column_name in ('role', 'store_id', 'client_id', 'is_super_admin')
),
profiles_constraints as (
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'constraint_name', con.conname,
      'constraint_type', case con.contype
        when 'p' then 'PRIMARY KEY'
        when 'f' then 'FOREIGN KEY'
        when 'u' then 'UNIQUE'
        when 'c' then 'CHECK'
        else con.contype::text
      end,
      'definition',      pg_catalog.pg_get_constraintdef(con.oid),
      'references_table', case when con.contype = 'f'
        then (select rc.relname from pg_catalog.pg_class rc where rc.oid = con.confrelid)
        else null end,
      'on_update', case con.confupdtype
        when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
        when 'c' then 'CASCADE'   when 'n' then 'SET NULL'
        when 'd' then 'SET DEFAULT' else null end,
      'on_delete', case con.confdeltype
        when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
        when 'c' then 'CASCADE'   when 'n' then 'SET NULL'
        when 'd' then 'SET DEFAULT' else null end
    ) order by con.conname), '[]'::jsonb) as constraints
  from profiles_oid po
  join pg_catalog.pg_constraint con on con.conrelid = po.table_oid
  where po.table_exists
),
profiles_indexes as (
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'index_name',  i.relname,
      'is_unique',   ix.indisunique,
      'is_primary',  ix.indisprimary,
      'definition',  pg_catalog.pg_get_indexdef(ix.indexrelid),
      'predicate',   pg_catalog.pg_get_expr(ix.indpred, ix.indrelid)
    ) order by i.relname), '[]'::jsonb) as indexes
  from profiles_oid po
  join pg_catalog.pg_index ix on ix.indrelid = po.table_oid
  join pg_catalog.pg_class i on i.oid = ix.indexrelid
  where po.table_exists
),
sec04 as (
  select jsonb_build_object(
    'table_exists',       (select table_exists from profiles_oid),
    'columns',            (select columns from profiles_columns),
    'constraints',        (select constraints from profiles_constraints),
    'indexes',            (select indexes from profiles_indexes)
  ) as result
),

-- ------------------------------------------------------------
-- 05_profile_integrity_counts
-- 件数のみ。実データ値・UUID・emailは一切返さない。
-- ------------------------------------------------------------
profiles_norm as (
  select
    p.id,
    p.role,
    p.store_id,
    p.client_id,
    coalesce(p.is_super_admin, false) as is_super_admin_norm
  from public.profiles p
),
sec05_counts as (
  select
    (select count(*) from profiles_norm)                                                     as profiles_total,
    (select count(*) from profiles_norm where role = 'admin')                                 as role_admin_count,
    (select count(*) from profiles_norm where role = 'client')                                as role_client_count,
    (select count(*) from profiles_norm where role = 'staff')                                  as role_staff_count,
    (select count(*) from profiles_norm where role is not null and role not in ('admin','client','staff')) as role_unexpected_count,
    (select count(*) from profiles_norm where role is null)                                    as role_null_count,
    (select count(*) from profiles_norm where role = 'client' and client_id is null)            as client_role_client_id_null_count,
    (select count(*)
       from profiles_norm pn
       where pn.role = 'client' and pn.client_id is not null
         and not exists (select 1 from public.clients c where c.id = pn.client_id))            as client_role_client_id_missing_count,
    (select count(*) from profiles_norm where role = 'client' and store_id is null)             as client_role_store_id_null_count,
    (select count(*)
       from profiles_norm pn
       join public.clients c on c.id = pn.client_id
       where pn.role = 'client' and pn.store_id is not null and c.store_id is not null
         and pn.store_id <> c.store_id)                                                        as client_role_store_id_mismatch_count,
    (select count(*) from profiles_norm where role = 'admin' and store_id is null)              as admin_role_store_id_null_count,
    (select count(*) from profiles_norm where role = 'admin' and store_id is null and not is_super_admin_norm) as normal_admin_store_id_null_count,
    (select count(*) from profiles_norm where is_super_admin_norm)                              as super_admin_count,
    (select count(*) from profiles_norm where is_super_admin_norm and store_id is null)         as super_admin_store_id_null_count,
    (select count(*) from (
       select client_id from profiles_norm where client_id is not null
       group by client_id having count(*) > 1
     ) dup)                                                                                    as client_id_multi_profile_group_count,
    (select count(*)
       from profiles_norm pn
       where not exists (select 1 from auth.users u where u.id = pn.id))                        as profile_without_auth_user_count,
    (select count(*)
       from auth.users u
       where not exists (select 1 from profiles_norm pn where pn.id = u.id))                    as auth_user_without_profile_count
),
sec05 as (
  select to_jsonb(sec05_counts.*) as result from sec05_counts
),

-- ------------------------------------------------------------
-- 06_store_and_client_integrity_counts
-- 顧客番号の実書式は supabase_customer_number_unique_fix.sql の
-- next_customer_number() 実装（p_store_code || '-' || lpad(連番,5,'0')）
-- に基づき「<店舗コード>-<5桁の数字>」を正規の形式として検査する
-- （lpad(...,5,'0')によりゼロ埋め5桁で払い出されるため、"5桁以上"では
-- なく"5桁"を検査対象とする。現在の採番Functionはlpad(v_next::text,5,'0')
-- を使用するため、連番が5桁を超えると右側が5文字に切り詰められる
-- （PostgreSQLのlpadは、入力が指定lengthより長い場合に右側を切り詰める
-- 仕様のため）。例えば100000は10000に切り詰められ、過去に発行済みの
-- 顧客番号と衝突する可能性がある。本監査では現在の採番仕様に合わせ、
-- 数字部分を正確に5桁として検査する。採番上限・桁あふれ対策は
-- 後続フェーズの別課題とする）。店舗コード・顧客番号そのものの値は
-- 返さず、件数のみ返す。
-- ------------------------------------------------------------
stores_norm as (
  select id, code, name from public.stores
),
clients_norm as (
  select id, store_id, customer_number from public.clients
),
sec06_counts as (
  select
    (select count(*) from stores_norm)                                                         as stores_total,
    (select count(*) from stores_norm where code is null or btrim(code) = '')                   as store_code_null_or_blank_count,
    (select count(*) from (
       select code from stores_norm where code is not null group by code having count(*) > 1
     ) d)                                                                                       as store_code_duplicate_group_count,
    (select count(*) from stores_norm where name is null or btrim(name) = '')                    as store_name_null_or_blank_count,
    (select count(*) from clients_norm)                                                          as clients_total,
    (select count(*) from clients_norm where store_id is null)                                   as clients_store_id_null_count,
    (select count(*)
       from clients_norm cn
       where cn.store_id is not null
         and not exists (select 1 from stores_norm sn where sn.id = cn.store_id))                as clients_orphan_store_id_count,
    (select count(*) from clients_norm where customer_number is null or btrim(customer_number) = '') as customer_number_null_or_blank_count,
    (select count(*) from (
       select customer_number from clients_norm
       where customer_number is not null and btrim(customer_number) <> ''
       group by customer_number having count(*) > 1
     ) d)                                                                                        as customer_number_duplicate_group_count,
    (select count(*) from (
       select store_id, customer_number from clients_norm
       where customer_number is not null and btrim(customer_number) <> '' and store_id is not null
       group by store_id, customer_number having count(*) > 1
     ) d)                                                                                        as customer_number_duplicate_within_store_group_count,
    (select count(*) from (
       select customer_number from clients_norm
       where customer_number is not null and btrim(customer_number) <> ''
       group by customer_number having count(distinct store_id) > 1
     ) d)                                                                                        as customer_number_shared_across_stores_group_count,
    (select count(*) from clients_norm
       where customer_number is not null and btrim(customer_number) <> ''
         and customer_number !~ '^[^-]+-[0-9]{5}$')                                               as customer_number_unexpected_format_count,
    (select count(*)
       from clients_norm cn
       join stores_norm sn on sn.id = cn.store_id
       where cn.customer_number is not null and btrim(cn.customer_number) <> ''
         and sn.code is not null
         and split_part(cn.customer_number, '-', 1) <> sn.code)                                  as customer_number_store_code_prefix_mismatch_count
),
sec06 as (
  select to_jsonb(sec06_counts.*) as result from sec06_counts
),

-- ------------------------------------------------------------
-- 07_log_integrity_counts
-- 氏名・日付・体重・食事内容・comment・写真URLは一切返さない（件数のみ）。
-- ------------------------------------------------------------
weight_logs_norm as (
  select id, client_id, date from public.weight_logs
),
meal_logs_norm as (
  select id, client_id, date from public.meal_logs
),
sec07_counts as (
  select
    (select count(*) from weight_logs_norm)                                                     as weight_logs_total,
    (select count(*) from meal_logs_norm)                                                        as meal_logs_total,
    (select count(*) from weight_logs_norm where client_id is null)                              as weight_logs_client_id_null_count,
    (select count(*) from meal_logs_norm where client_id is null)                                 as meal_logs_client_id_null_count,
    (select count(*)
       from weight_logs_norm w
       where w.client_id is not null
         and not exists (select 1 from public.clients c where c.id = w.client_id))                as weight_logs_orphan_client_id_count,
    (select count(*)
       from meal_logs_norm m
       where m.client_id is not null
         and not exists (select 1 from public.clients c where c.id = m.client_id))                 as meal_logs_orphan_client_id_count,
    (select count(*)
       from weight_logs_norm w
       left join public.clients c on c.id = w.client_id
       where w.client_id is null or c.id is null or c.store_id is null)                            as weight_logs_store_boundary_unresolvable_count,
    (select count(*)
       from meal_logs_norm m
       left join public.clients c on c.id = m.client_id
       where m.client_id is null or c.id is null or c.store_id is null)                            as meal_logs_store_boundary_unresolvable_count,
    (select count(*) from (
       select client_id, date from weight_logs_norm
       where client_id is not null and date is not null
       group by client_id, date having count(*) > 1
     ) d)                                                                                          as weight_logs_client_date_duplicate_count,
    (select count(*) from (
       select client_id, date from meal_logs_norm
       where client_id is not null and date is not null
       group by client_id, date having count(*) > 1
     ) d)                                                                                          as meal_logs_client_date_duplicate_count
),
sec07 as (
  select to_jsonb(sec07_counts.*) as result from sec07_counts
),

-- ------------------------------------------------------------
-- 08_constraints_and_indexes（対象5テーブル）
-- ------------------------------------------------------------
t5_catalog as (
  select ttc.*
  from target_table_catalog ttc
  where ttc.table_name in (select table_name from target5_tables)
),
t5_constraints as (
  select
    t5.table_name,
    con.oid,
    con.conname,
    con.contype,
    con.confrelid,
    con.confupdtype,
    con.confdeltype
  from t5_catalog t5
  join pg_catalog.pg_constraint con on con.conrelid = t5.table_oid
  where t5.table_exists
),
t5_constraints_json as (
  select
    tc.table_name,
    coalesce(jsonb_agg(jsonb_build_object(
      'constraint_name',   tc.conname,
      'constraint_type',   case tc.contype
        when 'p' then 'PRIMARY KEY' when 'f' then 'FOREIGN KEY'
        when 'u' then 'UNIQUE'      when 'c' then 'CHECK'
        else tc.contype::text end,
      'definition',        pg_catalog.pg_get_constraintdef(tc.oid),
      'references_table',  case when tc.contype = 'f'
        then (select rc.relname from pg_catalog.pg_class rc where rc.oid = tc.confrelid) else null end,
      'on_update', case tc.confupdtype
        when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
        when 'c' then 'CASCADE'   when 'n' then 'SET NULL'
        when 'd' then 'SET DEFAULT' else null end,
      'on_delete', case tc.confdeltype
        when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
        when 'c' then 'CASCADE'   when 'n' then 'SET NULL'
        when 'd' then 'SET DEFAULT' else null end
    ) order by tc.conname), '[]'::jsonb) as constraints
  from t5_constraints tc
  group by tc.table_name
),
t5_indexes as (
  select
    t5.table_name,
    i.relname as index_name,
    ix.indisunique,
    ix.indisprimary,
    pg_catalog.pg_get_indexdef(ix.indexrelid) as definition,
    pg_catalog.pg_get_expr(ix.indpred, ix.indrelid) as predicate
  from t5_catalog t5
  join pg_catalog.pg_index ix on ix.indrelid = t5.table_oid
  join pg_catalog.pg_class i on i.oid = ix.indexrelid
  where t5.table_exists
),
t5_indexes_json as (
  select
    ti.table_name,
    coalesce(jsonb_agg(jsonb_build_object(
      'index_name', ti.index_name,
      'is_unique',  ti.indisunique,
      'is_primary', ti.indisprimary,
      'definition', ti.definition,
      'predicate',  ti.predicate
    ) order by ti.index_name), '[]'::jsonb) as indexes
  from t5_indexes ti
  group by ti.table_name
),
sec08_rows as (
  select
    t.table_name,
    tc.table_exists as exists,
    coalesce(cj.constraints, '[]'::jsonb) as constraints,
    coalesce(ij.indexes, '[]'::jsonb)     as indexes
  from target5_tables t
  left join target_table_catalog tc on tc.table_name = t.table_name
  left join t5_constraints_json cj on cj.table_name = t.table_name
  left join t5_indexes_json ij on ij.table_name = t.table_name
),
sec08 as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table_name',  table_name,
    'exists',      exists,
    'constraints', constraints,
    'indexes',     indexes
  ) order by table_name), '[]'::jsonb) as result
  from sec08_rows
),

-- ------------------------------------------------------------
-- Function共通カタログ（09〜12・16で再利用）
-- 対象Functionは名前（proname）で検索し、overloadを取りこぼさない。
-- ------------------------------------------------------------
target_function_names (function_name) as (
  values
    ('next_customer_number'),
    ('admin_list_other_store_clients'),
    ('admin_get_other_store_client'),
    ('admin_get_other_store_weight_logs'),
    ('admin_get_other_store_meal_logs')
),
func_catalog as (
  select
    p.oid,
    p.proname as function_name,
    n.nspname as schema_name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    (
      select array_agg(pg_catalog.format_type(a.type_oid, null) order by a.ord)
      from unnest(string_to_array(p.proargtypes::text, ' ')::oid[]) with ordinality as a(type_oid, ord)
    ) as input_argument_types,
    pg_catalog.pg_get_function_result(p.oid) as result_type,
    p.prokind,
    p.provolatile,
    p.proparallel,
    p.proisstrict,
    p.proleakproof,
    p.prosecdef,
    pg_catalog.pg_get_userbyid(p.proowner) as owner_name,
    p.proconfig,
    p.proargnames,
    p.proargmodes,
    -- proallargtypes: OUT/INOUT/TABLE列を含む全引数の型（位置順）。
    -- proargtypes（入力引数型の確認専用、上の input_argument_types）とは
    -- 役割を混同しない。全引数にIN以外が無い場合はNULL（catalog仕様）。
    p.proallargtypes
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (select function_name from target_function_names)
),
-- func_out_columns: OUT('o')・INOUT('b')・RETURNS TABLE列('t')を、
-- generate_subscripts(proallargtypes, 1) で得た位置(position)を共通の
-- 添字として proargnames・proargmodes・proallargtypes へ同じ添字で
-- アクセスすることで、名前・モード・型・位置を正確に対応させる。
-- OUT列の型は proargtypes（入力引数専用）からは一切推測しない。
-- proallargtypes が NULL（全引数がIN）の場合、generate_subscripts は
-- 0行を返すため、集計結果は自動的に空配列・空JSONB配列になる
-- （SQL全体は落ちない）。
func_out_columns as (
  select
    fc.oid,
    coalesce(oc.out_arg_names,       array[]::text[]) as out_arg_names,
    coalesce(oc.out_arg_names_lower, array[]::text[]) as out_arg_names_lower,
    coalesce(oc.out_arguments,       '[]'::jsonb)      as out_arguments
  from func_catalog fc
  left join lateral (
    select
      array_agg(coalesce(fc.proargnames[pos.i], '') order by pos.i)        as out_arg_names,
      array_agg(lower(coalesce(fc.proargnames[pos.i], '')) order by pos.i) as out_arg_names_lower,
      jsonb_agg(jsonb_build_object(
        'position', pos.i,
        'name',     fc.proargnames[pos.i],
        'mode',     fc.proargmodes[pos.i],
        'type',     pg_catalog.format_type(fc.proallargtypes[pos.i], null)
      ) order by pos.i) as out_arguments
    from generate_subscripts(fc.proallargtypes, 1) as pos(i)
    where fc.proargmodes is not null
      and fc.proargmodes[pos.i] in ('o', 'b', 't')
  ) oc on true
),
-- func_search_path: proconfig中の search_path 設定を、
-- 「明示設定の有無（has_explicit_search_path_setting）」と
-- 「安全な空設定か（has_safe_empty_search_path）」に分けて判定する。
-- has_safe_empty_search_path=true になるのは、'=' より後の値が
-- 完全に空文字列（search_path=）または空文字列を表す二重引用符
-- （search_path=""）の場合だけ。空白1文字などの「見た目だけ空」の値は
-- 安全側に丸めず false のままにする（実際のschema名指定と区別する）。
func_search_path as (
  select
    fc.oid,
    (
      select array_agg(cfg) from unnest(coalesce(fc.proconfig, array[]::text[])) cfg
      where cfg like 'search_path=%'
    ) as search_path_settings,
    exists (
      select 1 from unnest(coalesce(fc.proconfig, array[]::text[])) cfg
      where cfg like 'search_path=%'
    ) as has_explicit_search_path_setting,
    exists (
      select 1 from unnest(coalesce(fc.proconfig, array[]::text[])) cfg
      where cfg like 'search_path=%'
        and substring(cfg from position('=' in cfg) + 1) in ('', '""')
    ) as has_safe_empty_search_path
  from func_catalog fc
),
func_priv_raw as (
  select
    fc.oid,
    exists (
      select 1 from pg_catalog.pg_proc pp
      cross join lateral pg_catalog.aclexplode(coalesce(pp.proacl, pg_catalog.acldefault('f', pp.proowner))) a
      where pp.oid = fc.oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) as public_direct_execute,
    case when (select anon_exists from role_exists)
      then has_function_privilege('anon', fc.oid, 'EXECUTE') else null end as anon_can_execute,
    case when (select authenticated_exists from role_exists)
      then has_function_privilege('authenticated', fc.oid, 'EXECUTE') else null end as authenticated_can_execute,
    case when (select service_role_exists from role_exists)
      then has_function_privilege('service_role', fc.oid, 'EXECUTE') else null end as service_role_can_execute,
    has_function_privilege(fc.owner_name, fc.oid, 'EXECUTE') as owner_can_execute
  from func_catalog fc
),
-- 禁止列リスト：clients.name/kana/phone/address/memo/customer_number/
-- contract_type（supabase_schema.sql, supabase_alter_clients.sql）、
-- body_photos.front_photo_url/back_photo_url/right_photo_url/
-- left_photo_url（supabase_photo_setup.sql）、admin_comments.body
-- （supabase_schema.sql）と、リポジトリ内で実際に使われている列名の
-- みを完全一致対象とする。「name_kana」は実在する列名ではない
-- （実在するのは clients.kana）ため含めない。
forbidden_columns (col_name) as (
  values
    ('name'), ('kana'), ('phone'), ('address'), ('memo'),
    ('customer_number'), ('contract_type'),
    ('front_photo_url'), ('back_photo_url'), ('right_photo_url'), ('left_photo_url'),
    ('body')
),

-- ------------------------------------------------------------
-- 09_target_function_inventory
-- ------------------------------------------------------------
sec09_overloads as (
  select
    fc.function_name,
    jsonb_build_object(
      'schema',                fc.schema_name,
      'identity_arguments',    fc.identity_arguments,
      'input_argument_types',  to_jsonb(fc.input_argument_types),
      'result_type',           fc.result_type,
      'prokind',                case fc.prokind
        when 'f' then 'function' when 'p' then 'procedure'
        when 'a' then 'aggregate' when 'w' then 'window' else fc.prokind::text end,
      'volatility',            case fc.provolatile
        when 'i' then 'IMMUTABLE' when 's' then 'STABLE' when 'v' then 'VOLATILE' else null end,
      'parallel',              case fc.proparallel
        when 's' then 'SAFE' when 'r' then 'RESTRICTED' when 'u' then 'UNSAFE' else null end,
      'strict',                fc.proisstrict,
      'leakproof',             fc.proleakproof,
      'security_definer',      fc.prosecdef,
      'owner',                 fc.owner_name,
      'proconfig',             to_jsonb(coalesce(fc.proconfig, array[]::text[]))
    ) as overload_obj
  from func_catalog fc
),
sec09_per_function as (
  select
    tfn.function_name,
    count(so.overload_obj)                                                   as overload_count,
    coalesce(jsonb_agg(so.overload_obj order by so.overload_obj), '[]'::jsonb) as overloads
  from target_function_names tfn
  left join sec09_overloads so on so.function_name = tfn.function_name
  group by tfn.function_name
),
sec09 as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'function_name',  function_name,
    'exists',         (overload_count > 0),
    'overload_count', overload_count,
    'overloads',      overloads
  ) order by function_name), '[]'::jsonb) as result
  from sec09_per_function
),

-- ------------------------------------------------------------
-- 10_target_function_execute_privileges
-- ------------------------------------------------------------
sec10_overloads as (
  select
    fc.function_name,
    jsonb_build_object(
      'identity_arguments',  fc.identity_arguments,
      'public_direct_execute',      fpr.public_direct_execute,
      'anon_can_execute',           fpr.anon_can_execute,
      'authenticated_can_execute',  fpr.authenticated_can_execute,
      'service_role_can_execute',   fpr.service_role_can_execute,
      'owner_can_execute',          fpr.owner_can_execute
    ) as overload_obj
  from func_catalog fc
  join func_priv_raw fpr on fpr.oid = fc.oid
),
sec10_per_function as (
  select
    tfn.function_name,
    count(so.overload_obj)                                                    as overload_count,
    coalesce(jsonb_agg(so.overload_obj order by so.overload_obj), '[]'::jsonb)  as overloads
  from target_function_names tfn
  left join sec10_overloads so on so.function_name = tfn.function_name
  group by tfn.function_name
),
sec10 as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'function_name',  function_name,
    'exists',         (overload_count > 0),
    'overload_count', overload_count,
    'overloads',      overloads
  ) order by function_name), '[]'::jsonb) as result
  from sec10_per_function
),

-- ------------------------------------------------------------
-- 11_target_function_result_definitions
-- 禁止列は OUT引数名の完全一致（大文字小文字を無視）でのみ判定し、
-- 部分一致（例: store_name が name に誤反応する等）は行わない。
-- ------------------------------------------------------------
sec11_overloads as (
  select
    fc.function_name,
    jsonb_build_object(
      'identity_arguments',       fc.identity_arguments,
      'result_type',              fc.result_type,
      'out_argument_names',       to_jsonb(foc.out_arg_names),
      'out_arguments',            foc.out_arguments,
      'contains_customer_number', (pg_catalog.array_position(foc.out_arg_names_lower, 'customer_number') is not null),
      'contains_other_forbidden_column', exists (
        select 1 from forbidden_columns fcol
        where fcol.col_name <> 'customer_number'
          and pg_catalog.array_position(foc.out_arg_names_lower, fcol.col_name) is not null
      ),
      'matched_forbidden_columns', to_jsonb((
        select coalesce(array_agg(fcol.col_name order by fcol.col_name), array[]::text[])
        from forbidden_columns fcol
        where pg_catalog.array_position(foc.out_arg_names_lower, fcol.col_name) is not null
      ))
    ) as overload_obj
  from func_catalog fc
  join func_out_columns foc on foc.oid = fc.oid
),
sec11_per_function as (
  select
    tfn.function_name,
    count(so.overload_obj)                                                   as overload_count,
    coalesce(jsonb_agg(so.overload_obj order by so.overload_obj), '[]'::jsonb) as overloads
  from target_function_names tfn
  left join sec11_overloads so on so.function_name = tfn.function_name
  group by tfn.function_name
),
sec11 as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'function_name',  function_name,
    'exists',         (overload_count > 0),
    'overload_count', overload_count,
    'overloads',      overloads
  ) order by function_name), '[]'::jsonb) as result
  from sec11_per_function
),

-- ------------------------------------------------------------
-- 12_target_function_definitions
-- Function定義本文（pg_get_functiondef）を取得する。定義中に列名・
-- テーブル名が含まれるのは許容範囲（要件どおり）。ここで返す4項目の
-- boolean は簡易な文字列一致による補助情報であり、正確な判断は
-- 同時に返す定義全文（definition）でも確認できるようにする。
-- ------------------------------------------------------------
sec12_overloads as (
  select
    fc.function_name,
    jsonb_build_object(
      'schema',               fc.schema_name,
      'identity_arguments',   fc.identity_arguments,
      'definition',           pg_catalog.pg_get_functiondef(fc.oid),
      'references_public_clients',                  (pg_catalog.pg_get_functiondef(fc.oid) ilike '%public.clients%'),
      'references_public_weight_logs',               (pg_catalog.pg_get_functiondef(fc.oid) ilike '%public.weight_logs%'),
      'references_public_meal_logs',                 (pg_catalog.pg_get_functiondef(fc.oid) ilike '%public.meal_logs%'),
      'references_public_stores',                    (pg_catalog.pg_get_functiondef(fc.oid) ilike '%public.stores%'),
      'references_public_profiles',                  (pg_catalog.pg_get_functiondef(fc.oid) ilike '%public.profiles%'),
      'references_public_customer_number_counters',  (pg_catalog.pg_get_functiondef(fc.oid) ilike '%public.customer_number_counters%'),
      'uses_auth_uid',            (pg_catalog.pg_get_functiondef(fc.oid) ilike '%auth.uid()%'),
      'checks_role',              (pg_catalog.pg_get_functiondef(fc.oid) ilike '%role%'),
      'checks_store_id',          (pg_catalog.pg_get_functiondef(fc.oid) ilike '%store_id%'),
      'returns_customer_number_text', (pg_catalog.pg_get_functiondef(fc.oid) ilike '%customer_number%')
    ) as overload_obj
  from func_catalog fc
),
sec12_per_function as (
  select
    tfn.function_name,
    count(so.overload_obj)                                                    as overload_count,
    coalesce(jsonb_agg(so.overload_obj order by so.overload_obj), '[]'::jsonb)  as overloads
  from target_function_names tfn
  left join sec12_overloads so on so.function_name = tfn.function_name
  group by tfn.function_name
),
sec12 as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'function_name',  function_name,
    'exists',         (overload_count > 0),
    'overload_count', overload_count,
    'overloads',      overloads
  ) order by function_name), '[]'::jsonb) as result
  from sec12_per_function
),

-- ------------------------------------------------------------
-- 13_role_attributes
-- ------------------------------------------------------------
target_role_names (role_name) as (
  values ('anon'), ('authenticated'), ('service_role'), ('postgres')
),
sec13_rows as (
  select
    trn.role_name,
    (r.rolname is not null) as exists,
    r.rolsuper,
    r.rolinherit,
    r.rolcreaterole,
    r.rolcreatedb,
    r.rolcanlogin,
    r.rolreplication,
    r.rolbypassrls
  from target_role_names trn
  left join pg_catalog.pg_roles r on r.rolname = trn.role_name
),
sec13 as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'rolname',        role_name,
    'exists',         exists,
    'rolsuper',       rolsuper,
    'rolinherit',     rolinherit,
    'rolcreaterole',  rolcreaterole,
    'rolcreatedb',    rolcreatedb,
    'rolcanlogin',    rolcanlogin,
    'rolreplication', rolreplication,
    'rolbypassrls',   rolbypassrls
  ) order by role_name), '[]'::jsonb) as result
  from sec13_rows
),

-- ------------------------------------------------------------
-- 14_storage_bucket_metadata
-- ------------------------------------------------------------
target_bucket_names (bucket_id) as (
  values ('meal-photos'), ('body-photos')
),
sec14_rows as (
  select
    tbn.bucket_id,
    (b.id is not null) as exists,
    b.public,
    b.file_size_limit,
    to_jsonb(b.allowed_mime_types) as allowed_mime_types
  from target_bucket_names tbn
  left join storage.buckets b on b.id = tbn.bucket_id
),
sec14 as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'bucket_id',         bucket_id,
    'exists',            exists,
    'public',            public,
    'file_size_limit',   file_size_limit,
    'allowed_mime_types', allowed_mime_types
  ) order by bucket_id), '[]'::jsonb) as result
  from sec14_rows
),

-- ------------------------------------------------------------
-- 15_storage_policies
-- 対象バケット名をPolicy式から確実に自動判定できないため、
-- storage.objects に定義された全Policyを返す（Storage objectの
-- 個別行は一切取得しない）。
-- ------------------------------------------------------------
sec15_rows as (
  select
    p.policyname,
    to_jsonb(p.roles) as roles,
    p.cmd,
    p.permissive,
    p.qual,
    p.with_check
  from pg_catalog.pg_policies p
  where p.schemaname = 'storage' and p.tablename = 'objects'
),
sec15 as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'policy_name', policyname,
    'roles',       roles,
    'cmd',         cmd,
    'permissive',  permissive,
    'qual',        qual,
    'with_check',  with_check
  ) order by policyname), '[]'::jsonb) as result
  from sec15_rows
),

-- ------------------------------------------------------------
-- 16_rpc_and_rls_risk_summary
-- 他セクションの生データを再集計し、このセクション単独でも
-- 本番対応を進めてよいか判断できる要約にする。
-- ------------------------------------------------------------
sum_target5_rls_disabled as (
  select count(*) as n
  from target_table_catalog
  where table_name in (select table_name from target5_tables)
    and table_exists and coalesce(relrowsecurity, false) = false
),
sum_force_rls as (
  select count(*) as n
  from target_table_catalog
  where table_exists and coalesce(relforcerowsecurity, false) = true
),
sum_no_policy_tables as (
  select count(*) as n
  from sec03_per_table
  where policy_count = 0
),
sum_all8_exist as (
  select (count(*) filter (where table_exists) = 8) as v
  from target_table_catalog
),
next_customer_number_summary as (
  select
    (count(*) > 0)                                                    as exists_flag,
    count(*)                                                            as overload_count,
    case when count(*) = 1 then bool_and(prosecdef) else null end       as security_definer,
    case when count(*) = 1 then bool_and(
      coalesce((select has_explicit_search_path_setting from func_search_path fsp where fsp.oid = fc.oid), false)
    ) else null end                                                     as has_explicit_search_path_setting,
    case when count(*) = 1 then bool_and(
      coalesce((select has_safe_empty_search_path from func_search_path fsp where fsp.oid = fc.oid), false)
    ) else null end                                                     as has_safe_empty_search_path,
    case when count(*) = 1 then bool_and(fpr.anon_can_execute) else null end as anon_can_execute,
    case when count(*) = 1 then bool_and(fpr.authenticated_can_execute) else null end as authenticated_can_execute
  from func_catalog fc
  join func_priv_raw fpr on fpr.oid = fc.oid
  where fc.function_name = 'next_customer_number'
),
other_store_rpc_names (function_name) as (
  values
    ('admin_list_other_store_clients'),
    ('admin_get_other_store_client'),
    ('admin_get_other_store_weight_logs'),
    ('admin_get_other_store_meal_logs')
),
other_store_rpc_per_function as (
  select
    osn.function_name,
    count(fc.oid) as overload_count,
    case when count(fc.oid) = 1 then bool_and(fc.prosecdef) else null end as security_definer,
    case when count(fc.oid) = 1 then bool_and(
      coalesce((select has_explicit_search_path_setting from func_search_path fsp where fsp.oid = fc.oid), false)
    ) else null end as has_explicit_search_path_setting,
    case when count(fc.oid) = 1 then bool_and(
      coalesce((select has_safe_empty_search_path from func_search_path fsp where fsp.oid = fc.oid), false)
    ) else null end as has_safe_empty_search_path,
    -- ANY(subquery) はPostgreSQLが「= ANY(サブクエリの各行)」の比較として
    -- 解釈しうるため使わない。array_position(配列, 値) は常に単一の配列値を
    -- 期待する明確な関数呼び出しであり、この曖昧さを避けられる。
    case when count(fc.oid) = 1 then bool_and(
      pg_catalog.array_position(
        (
          select foc.out_arg_names_lower
          from func_out_columns foc
          where foc.oid = fc.oid
        ),
        'customer_number'
      ) is not null
    ) else null end as returns_customer_number,
    case when count(fc.oid) = 1 then bool_and(exists (
      select 1 from forbidden_columns fcol
      where fcol.col_name <> 'customer_number'
        and pg_catalog.array_position(
          (
            select foc.out_arg_names_lower
            from func_out_columns foc
            where foc.oid = fc.oid
          ),
          fcol.col_name
        ) is not null
    )) else null end as returns_other_forbidden_column
  from other_store_rpc_names osn
  left join func_catalog fc on fc.function_name = osn.function_name
  group by osn.function_name
),
other_store_rpc_summary as (
  select
    bool_and(overload_count = 1) as all_single_overload,
    (bool_and(overload_count >= 1)) as all_exist,
    bool_and(coalesce(security_definer, false))       as all_security_definer,
    bool_and(coalesce(has_explicit_search_path_setting, false)) as all_have_explicit_search_path_setting,
    bool_and(coalesce(has_safe_empty_search_path, false))       as all_have_safe_empty_search_path,
    count(*) filter (where coalesce(returns_customer_number, false))        as functions_returning_customer_number,
    count(*) filter (where coalesce(returns_other_forbidden_column, false)) as functions_returning_other_forbidden_column,
    jsonb_agg(jsonb_build_object(
      'function_name', function_name,
      'overload_count', overload_count,
      'security_definer', security_definer,
      'has_explicit_search_path_setting', has_explicit_search_path_setting,
      'has_safe_empty_search_path', has_safe_empty_search_path,
      'returns_customer_number', returns_customer_number,
      'returns_other_forbidden_column', returns_other_forbidden_column
    ) order by function_name) as per_function_detail
  from other_store_rpc_per_function
),
service_role_bypassrls as (
  select rolbypassrls from pg_catalog.pg_roles where rolname = 'service_role'
),
pre_rls_integrity_total as (
  select
    (select client_role_client_id_null_count from sec05_counts)
    + (select client_role_client_id_missing_count from sec05_counts)
    + (select client_id_multi_profile_group_count from sec05_counts)
    + (select customer_number_duplicate_group_count from sec06_counts)
    + (select customer_number_shared_across_stores_group_count from sec06_counts)
    + (select clients_orphan_store_id_count from sec06_counts)
    + (select weight_logs_orphan_client_id_count from sec07_counts)
    + (select meal_logs_orphan_client_id_count from sec07_counts)
    + (select weight_logs_client_id_null_count from sec07_counts)
    + (select meal_logs_client_id_null_count from sec07_counts)
    + (select weight_logs_client_date_duplicate_count from sec07_counts)
    + (select meal_logs_client_date_duplicate_count from sec07_counts)
      as total
),
sec16 as (
  select jsonb_build_object(
    'all_8_target_tables_exist',                         (select v from sum_all8_exist),
    'target5_rls_disabled_count',                        (select n from sum_target5_rls_disabled),
    'force_rls_enabled_table_count',                      (select n from sum_force_rls),
    'tables_without_any_policy_count',                     (select n from sum_no_policy_tables),
    'next_customer_number_exists',                        (select exists_flag from next_customer_number_summary),
    'next_customer_number_overload_count',                (select overload_count from next_customer_number_summary),
    'next_customer_number_security_definer',              (select security_definer from next_customer_number_summary),
    'next_customer_number_has_explicit_search_path_setting', (select has_explicit_search_path_setting from next_customer_number_summary),
    'next_customer_number_has_safe_empty_search_path',    (select has_safe_empty_search_path from next_customer_number_summary),
    'next_customer_number_anon_can_execute',               (select anon_can_execute from next_customer_number_summary),
    'next_customer_number_authenticated_can_execute',      (select authenticated_can_execute from next_customer_number_summary),
    'other_store_rpc_all_exist',                          (select all_exist from other_store_rpc_summary),
    'other_store_rpc_all_single_overload',                (select all_single_overload from other_store_rpc_summary),
    'other_store_rpc_all_security_definer',                (select all_security_definer from other_store_rpc_summary),
    'other_store_rpc_all_have_explicit_search_path_setting', (select all_have_explicit_search_path_setting from other_store_rpc_summary),
    'other_store_rpc_all_have_safe_empty_search_path',     (select all_have_safe_empty_search_path from other_store_rpc_summary),
    'other_store_rpc_functions_returning_customer_number', (select functions_returning_customer_number from other_store_rpc_summary),
    'other_store_rpc_functions_returning_other_forbidden_column', (select functions_returning_other_forbidden_column from other_store_rpc_summary),
    'other_store_rpc_per_function_detail',                 (select per_function_detail from other_store_rpc_summary),
    'service_role_bypassrls',                             (select rolbypassrls from service_role_bypassrls),
    'client_role_client_id_null_count',                   (select client_role_client_id_null_count from sec05_counts),
    'normal_admin_store_id_null_count',                    (select normal_admin_store_id_null_count from sec05_counts),
    'pre_rls_integrity_issue_total',                       (select total from pre_rls_integrity_total)
  ) as result
)

select '01_target_table_rls_and_owners' as section, result from sec01
union all
select '02_target_table_acl', result from sec02
union all
select '03_current_policies', result from sec03
union all
select '04_profile_schema_and_constraints', result from sec04
union all
select '05_profile_integrity_counts', result from sec05
union all
select '06_store_and_client_integrity_counts', result from sec06
union all
select '07_log_integrity_counts', result from sec07
union all
select '08_constraints_and_indexes', result from sec08
union all
select '09_target_function_inventory', result from sec09
union all
select '10_target_function_execute_privileges', result from sec10
union all
select '11_target_function_result_definitions', result from sec11
union all
select '12_target_function_definitions', result from sec12
union all
select '13_role_attributes', result from sec13
union all
select '14_storage_bucket_metadata', result from sec14
union all
select '15_storage_policies', result from sec15
union all
select '16_rpc_and_rls_risk_summary', result from sec16
order by section;

rollback;
