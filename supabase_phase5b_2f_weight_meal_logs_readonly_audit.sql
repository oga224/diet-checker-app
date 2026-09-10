-- ============================================================
-- Phase 5B-2F: weight_logs / meal_logs 本番読み取り専用事実確認監査
--
-- 目的：
--   public.weight_logs と public.meal_logs の2テーブルについて、
--   RLS状態・Policy定義・ロール権限・PUBLIC ACL・client_id列の
--   定義・外部キー・個人情報を含まない集計件数を、本番の
--   システムカタログと集計件数だけで確認する。
--   実顧客の行データ・個人情報・秘密情報は一切取得しない。
--
-- 本ファイルはレビュー・確認専用であり、それ自体は一切のデータ変更・
-- スキーマ変更・権限変更を行わない（DDL・DML・GRANT/REVOKE・DO・CALL・
-- 動的SQL・一時テーブルなし）。apply/rollback用の修復SQLは今回作成
-- しない（事実確認のみ）。実行は本番のSQL Editor等で行うことを
-- 想定するが、本ファイル自体は今回まだ実行しない（作成・静的検証のみ）。
--
-- ── 前提条件（この監査SQLが暗黙に仮定する事項） ──────────────
-- 1. 本ファイルは pg_catalog / information_schema / pg_policies の
--    読み取りが許可されたロール（例：Supabase SQL Editor の postgres
--    ロール）で実行される前提。
-- 2. セクション01〜05はカタログ駆動（target_tablesをunnest相当のVALUES
--    + LEFT JOIN）で構成されており、対象テーブルが本番に存在しない
--    場合でも exists=false として結果に現れ、SQL全体は失敗しない。
-- 3. セクション08（行数・client_id集計）は、weight_logs・meal_logs・
--    clients が実際に存在することを前提として静的SQLで直接SELECTする
--    （件数確認のみのクエリのため）。これらのテーブルは既存の
--    supabase_schema.sql（weight_logsは17-27行目付近、meal_logsは
--    29行目付近）で client_id uuid not null references clients(id)
--    on delete cascade として定義されていることを確認済みだが、本番の
--    実列定義・NULL許容・FK定義そのものはセクション06・07で推測せず
--    カタログから直接取得する。動的SQL・DOブロックによる
--    「存在しない場合の回避」は要件で禁止されているため実装していない。
--    したがって、対象テーブルのいずれかが本番から削除されている場合、
--    セクション08を含む本ファイル全体（単一クエリ）が失敗する。
-- 4. Policy名・RLS状態・ACLについては、あるべき姿（期待値）を本ファイル
--    側で推測して matches_expected = true/false のような合否判定は行わ
--    ない。目的はあくまで現在の本番状態の取得であるため、該当セクション
--    （02_rls_and_force_rls, 03_current_policies,
--    04_role_table_privileges, 05_public_direct_acl）には
--    'matches_expected': null を明示し、「まだ評価していない」ことを
--    result自体に残す。
-- ============================================================

begin;
set transaction read only;

with

-- ------------------------------------------------------------
-- 対象2テーブルの共通定義（複数セクションで再利用）
-- ------------------------------------------------------------
target_tables (table_name) as (
  values
    ('weight_logs'),
    ('meal_logs')
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
    exists (select 1 from pg_catalog.pg_roles where rolname = 'anon')          as anon_exists,
    exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') as authenticated_exists,
    exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role')  as service_role_exists
),

-- ------------------------------------------------------------
-- 01_table_existence_and_relkind
-- ------------------------------------------------------------
sec01_rows as (
  select
    ttc.table_name,
    ttc.table_exists as exists,
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
    'schema',     'public',
    'table_name', table_name,
    'exists',     exists,
    'relkind',    relkind_label
  ) order by table_name), '[]'::jsonb) as result
  from sec01_rows
),

-- ------------------------------------------------------------
-- 02_rls_and_force_rls
-- ------------------------------------------------------------
sec02_rows as (
  select
    ttc.table_name,
    ttc.table_exists        as exists,
    ttc.relrowsecurity      as rls_enabled,
    ttc.relforcerowsecurity as force_rls
  from target_table_catalog ttc
),
sec02 as (
  select jsonb_build_object(
    'matches_expected', null,
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table_name',  table_name,
        'exists',      exists,
        'rls_enabled', rls_enabled,
        'force_rls',   force_rls
      ) order by table_name)
      from sec02_rows
    ), '[]'::jsonb)
  ) as result
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
      'tablename',    pr.tablename,
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
  select jsonb_build_object(
    'matches_expected', null,
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table_name',   table_name,
        'policy_count', policy_count,
        'policies',     policies
      ) order by table_name)
      from sec03_per_table
    ), '[]'::jsonb)
  ) as result
),

-- ------------------------------------------------------------
-- 04_role_table_privileges
-- anon/authenticated/service_role の実効権限を has_table_privilege()
-- （ロール継承込み）で確認する。ロールが本番に存在しない場合は
-- そのロールの privileges を null にする（false に丸めない）。
-- ------------------------------------------------------------
sec04_rows as (
  select
    t.table_name,
    ttc.table_exists as exists,
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
    ) else null end as service_role_privileges
  from target_tables t
  left join target_table_catalog ttc on ttc.table_name = t.table_name
),
sec04 as (
  select jsonb_build_object(
    'matches_expected', null,
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table_name',               table_name,
        'exists',                   exists,
        'anon_privileges',          anon_privileges,
        'authenticated_privileges', authenticated_privileges,
        'service_role_privileges',  service_role_privileges
      ) order by table_name)
      from sec04_rows
    ), '[]'::jsonb)
  ) as result
),

-- ------------------------------------------------------------
-- 05_public_direct_acl
-- PUBLIC への直接付与は relacl の aclexplode(grantee = 0) で確認する
-- （has_table_privilege('public', ...) のような疑似ロール名の文字列
--  一致には依存しない）。付与が0件の場合は jsonb_agg(...) FILTER の
-- 結果が NULL になるため、coalesce で必ず '[]'::jsonb に丸め、
-- [null] ではなく [] として返す。
-- ------------------------------------------------------------
sec05_rows as (
  select
    t.table_name,
    ttc.table_exists as exists,
    case when ttc.table_exists then (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'privilege_type', a.privilege_type,
          'is_grantable',   a.is_grantable
        ) order by a.privilege_type) filter (where a.grantee = 0),
        '[]'::jsonb
      )
      from pg_catalog.aclexplode(coalesce(ttc.relacl, pg_catalog.acldefault('r', ttc.relowner))) a
    ) else null end as public_direct_acl
  from target_tables t
  left join target_table_catalog ttc on ttc.table_name = t.table_name
),
sec05 as (
  select jsonb_build_object(
    'matches_expected', null,
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table_name',        table_name,
        'exists',            exists,
        'public_direct_acl', public_direct_acl
      ) order by table_name)
      from sec05_rows
    ), '[]'::jsonb)
  ) as result
),

-- ------------------------------------------------------------
-- 06_client_id_column_definition
-- ------------------------------------------------------------
sec06_rows as (
  select
    t.table_name,
    ttc.table_exists as table_exists,
    (c.column_name is not null) as client_id_column_exists,
    c.data_type,
    c.udt_name,
    case when c.column_name is not null then (c.is_nullable = 'YES') else null end as client_id_is_nullable
  from target_tables t
  left join target_table_catalog ttc on ttc.table_name = t.table_name
  left join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = t.table_name
   and c.column_name = 'client_id'
),
sec06 as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table_name',               table_name,
    'table_exists',             table_exists,
    'client_id_column_exists',  client_id_column_exists,
    'data_type',                data_type,
    'udt_name',                 udt_name,
    'client_id_is_nullable',    client_id_is_nullable
  ) order by table_name), '[]'::jsonb) as result
  from sec06_rows
),

-- ------------------------------------------------------------
-- 07_client_id_foreign_keys
-- client_id列を含む外部キー制約のみを対象にする（con.conkey に
-- client_id列のattnumが含まれる制約に限定し、他列だけのFKは含めない）。
-- ------------------------------------------------------------
client_id_attnum as (
  select
    ttc.table_name,
    ttc.table_oid,
    a.attnum
  from target_table_catalog ttc
  join pg_catalog.pg_attribute a
    on a.attrelid = ttc.table_oid
   and a.attname = 'client_id'
   and not a.attisdropped
  where ttc.table_exists
),
sec07_rows as (
  select
    cia.table_name,
    con.conname                                                                 as constraint_name,
    pg_catalog.pg_get_constraintdef(con.oid)                                    as definition,
    (select rc.relname from pg_catalog.pg_class rc where rc.oid = con.confrelid) as references_table,
    case con.confupdtype
      when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
      when 'c' then 'CASCADE'   when 'n' then 'SET NULL'
      when 'd' then 'SET DEFAULT' else null end                                 as on_update,
    case con.confdeltype
      when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
      when 'c' then 'CASCADE'   when 'n' then 'SET NULL'
      when 'd' then 'SET DEFAULT' else null end                                 as on_delete
  from client_id_attnum cia
  join pg_catalog.pg_constraint con
    on con.conrelid = cia.table_oid
   and con.contype = 'f'
   and con.conkey @> array[cia.attnum]
),
sec07_per_table as (
  select
    t.table_name,
    coalesce(jsonb_agg(jsonb_build_object(
      'constraint_name',   sr.constraint_name,
      'definition',        sr.definition,
      'references_table',  sr.references_table,
      'on_update',          sr.on_update,
      'on_delete',          sr.on_delete
    ) order by sr.constraint_name) filter (where sr.constraint_name is not null), '[]'::jsonb) as foreign_keys
  from target_tables t
  left join sec07_rows sr on sr.table_name = t.table_name
  group by t.table_name
),
sec07 as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table_name',    table_name,
    'foreign_keys',  foreign_keys
  ) order by table_name), '[]'::jsonb) as result
  from sec07_per_table
),

-- ------------------------------------------------------------
-- 08_row_count_and_client_id_integrity_summary
-- 氏名・日付・体重・食事内容・comment等は一切返さない（件数のみ）。
-- ------------------------------------------------------------
weight_logs_norm as (
  select id, client_id from public.weight_logs
),
meal_logs_norm as (
  select id, client_id from public.meal_logs
),
sec08_counts as (
  select
    (select count(*) from weight_logs_norm)                                    as weight_logs_total,
    (select count(*) from weight_logs_norm where client_id is null)            as weight_logs_client_id_null_count,
    (select count(*)
       from weight_logs_norm w
       where w.client_id is not null
         and not exists (select 1 from public.clients c where c.id = w.client_id)) as weight_logs_orphan_client_id_count,
    (select count(*) from meal_logs_norm)                                      as meal_logs_total,
    (select count(*) from meal_logs_norm where client_id is null)              as meal_logs_client_id_null_count,
    (select count(*)
       from meal_logs_norm m
       where m.client_id is not null
         and not exists (select 1 from public.clients c where c.id = m.client_id)) as meal_logs_orphan_client_id_count
),
sec08 as (
  select to_jsonb(sec08_counts.*) as result from sec08_counts
)

select '01_table_existence_and_relkind' as section, result from sec01
union all
select '02_rls_and_force_rls', result from sec02
union all
select '03_current_policies', result from sec03
union all
select '04_role_table_privileges', result from sec04
union all
select '05_public_direct_acl', result from sec05
union all
select '06_client_id_column_definition', result from sec06
union all
select '07_client_id_foreign_keys', result from sec07
union all
select '08_row_count_and_client_id_integrity_summary', result from sec08
order by section;

rollback;
