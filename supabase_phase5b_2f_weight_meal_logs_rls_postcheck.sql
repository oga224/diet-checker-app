-- ============================================================
-- Phase 5B-2F postcheck（読み取り専用）
-- supabase_phase5b_2f_weight_meal_logs_rls_apply.sql 適用後、
-- public.weight_logs / public.meal_logs のRLS状態（rls_enabled/
-- force_rls）・Policy定義全体（policyname/permissive/cmd/roles/USING/
-- WITH CHECK）・authenticated/anon/PUBLIC/service_roleのACL・
-- DELETE/TRUNCATE/REFERENCES/TRIGGERの除去状況・client_id整合性件数を
-- 確認する。
--
-- 本ファイルはレビュー・確認専用であり、それ自体は一切のデータ変更・
-- 権限変更を行わない（DDL・DML・GRANT/REVOKE・DO・CALL・動的SQLなし）。
--
-- USING/WITH CHECK式は、pg_policies.qual / pg_policies.with_check の
-- テキストを、空白（改行・タブ・連続スペースを単一スペースへ圧縮）と
-- 大文字小文字だけを正規化したうえで期待値と比較する
-- （lower(regexp_replace(btrim(coalesce(expr,'')), '\s+', ' ', 'g'))）。
-- 条件式の構造そのものを変える正規化（括弧の除去・語順の入れ替え等）は
-- 行わない。
--
-- 【注意：期待値の性質について】
-- 12件（weight_logs 6件・meal_logs 6件）のUSING/WITH CHECK期待値は、
-- 推測値ではない。Phase 5B-2F policy deparse preflight
-- （supabase_phase5b_2f_weight_meal_logs_policy_deparse_preflight.sql、
-- 本番で実行し必ずROLLBACKする検証専用トランザクション）で、同一の
-- CREATE POLICY文を実際に本番へ一時作成し、pg_policiesから直接取得した
-- 正規化後テキストをそのまま使用している。
--
-- 【scalar subqueryの列数について】
-- 以前のPhase 5B-2E postcheckの初期実装で、複数のboolean列をSELECT-list
-- 内で相互参照しようとして「scalar subqueryが複数列を返す」構造上の
-- 誤りが発生した経緯がある。本ファイルはそれを再発させないため、
-- 02セクションを (a) actual_policies（実測の正規化済み列）→
-- (b) compared（期待値との項目別boolean比較。列同士の相互参照はしない）
-- → (c) compared_full（compared の複数boolean列をANDする専用CTEとして
-- 分離）の3段階に分け、いずれのSELECT-listも常に単一列のスカラー
-- サブクエリのみを使用する。jsonb_aggがNULLになる場合（対象0件）は、
-- 必ず外側のcoalesceで '[]'::jsonb に丸め、[null] を返さない。
--
-- 対象はpublic.weight_logs / public.meal_logsのPolicy・RLS・ACL・
-- client_id整合性のみ。public.profiles / public.clientsはPolicy判定の
-- サブクエリで参照するが、本ファイルはそれ自体を変更する対象ではない
-- （読み取り専用のためそもそも一切のテーブルを変更しない）。
--
-- 個人情報（氏名・かな・メール・電話・住所・コメント本文・写真URL・
-- 個別UUID・ログ内容）は一切出力しない。総行数は情報提供のみの
-- セクションとし、運用中に増減する値であるためmatches_expectedはNULLに
-- する。固定設計値（RLS状態・Policy定義・ACL・NULL client_id件数・
-- 孤立参照件数）はmatches_expectedをtrue/falseで判定する。
-- ============================================================

begin;
set transaction read only;

with

-- 期待値は、Phase 5B-2F policy deparse preflight（本番実測、必ずROLLBACK
-- する検証専用トランザクション）でpg_policiesから実際に取得した
-- 正規化後USING/WITH CHECKをそのまま使用する（推測値ではない）。
expected_policies (tablename, policyname, permissive, roles, cmd, using_expected, with_check_expected) as (
  values
    ('weight_logs', 'weight_logs: client select own', 'PERMISSIVE', array['authenticated']::name[], 'SELECT',
     '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''client''::text) and (p.client_id = weight_logs.client_id))))',
     null),
    ('weight_logs', 'weight_logs: client insert own', 'PERMISSIVE', array['authenticated']::name[], 'INSERT',
     null,
     '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''client''::text) and (p.client_id = weight_logs.client_id))))'),
    ('weight_logs', 'weight_logs: client update own', 'PERMISSIVE', array['authenticated']::name[], 'UPDATE',
     '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''client''::text) and (p.client_id = weight_logs.client_id))))',
     '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''client''::text) and (p.client_id = weight_logs.client_id))))'),
    ('weight_logs', 'weight_logs: admin select own store', 'PERMISSIVE', array['authenticated']::name[], 'SELECT',
     '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (exists ( select 1 from clients c where ((c.id = weight_logs.client_id) and (c.store_id = p.store_id)))))))))',
     null),
    ('weight_logs', 'weight_logs: admin insert own store', 'PERMISSIVE', array['authenticated']::name[], 'INSERT',
     null,
     '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (exists ( select 1 from clients c where ((c.id = weight_logs.client_id) and (c.store_id = p.store_id)))))))))'),
    ('weight_logs', 'weight_logs: admin update own store', 'PERMISSIVE', array['authenticated']::name[], 'UPDATE',
     '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (exists ( select 1 from clients c where ((c.id = weight_logs.client_id) and (c.store_id = p.store_id)))))))))',
     '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (exists ( select 1 from clients c where ((c.id = weight_logs.client_id) and (c.store_id = p.store_id)))))))))'),
    ('meal_logs', 'meal_logs: client select own', 'PERMISSIVE', array['authenticated']::name[], 'SELECT',
     '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''client''::text) and (p.client_id = meal_logs.client_id))))',
     null),
    ('meal_logs', 'meal_logs: client insert own', 'PERMISSIVE', array['authenticated']::name[], 'INSERT',
     null,
     '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''client''::text) and (p.client_id = meal_logs.client_id))))'),
    ('meal_logs', 'meal_logs: client update own', 'PERMISSIVE', array['authenticated']::name[], 'UPDATE',
     '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''client''::text) and (p.client_id = meal_logs.client_id))))',
     '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''client''::text) and (p.client_id = meal_logs.client_id))))'),
    ('meal_logs', 'meal_logs: admin select own store', 'PERMISSIVE', array['authenticated']::name[], 'SELECT',
     '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (exists ( select 1 from clients c where ((c.id = meal_logs.client_id) and (c.store_id = p.store_id)))))))))',
     null),
    ('meal_logs', 'meal_logs: admin insert own store', 'PERMISSIVE', array['authenticated']::name[], 'INSERT',
     null,
     '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (exists ( select 1 from clients c where ((c.id = meal_logs.client_id) and (c.store_id = p.store_id)))))))))'),
    ('meal_logs', 'meal_logs: admin update own store', 'PERMISSIVE', array['authenticated']::name[], 'UPDATE',
     '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (exists ( select 1 from clients c where ((c.id = meal_logs.client_id) and (c.store_id = p.store_id)))))))))',
     '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (exists ( select 1 from clients c where ((c.id = meal_logs.client_id) and (c.store_id = p.store_id)))))))))')
),

-- 01. RLS状態
rls_state as (
  select
    c.relname as table_name,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as force_rls
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('weight_logs','meal_logs')
),
sec01 as (
  select
    'rls_state' as section,
    coalesce(jsonb_agg(jsonb_build_object(
      'table_name', table_name,
      'rls_enabled', rls_enabled,
      'force_rls', force_rls
    ) order by table_name), '[]'::jsonb) as result,
    (
      (select count(*) from rls_state where table_name = 'weight_logs' and rls_enabled = true and force_rls = false) = 1
      and (select count(*) from rls_state where table_name = 'meal_logs' and rls_enabled = true and force_rls = false) = 1
    ) as matches_expected
  from rls_state
),

-- 02. Policy定義全体（policyname/permissive/cmd/roles/USING/WITH CHECK）の期待値比較
actual_policies as (
  select
    p.tablename,
    p.policyname,
    p.permissive,
    p.roles,
    p.cmd,
    p.qual as using_raw,
    p.with_check as with_check_raw,
    lower(regexp_replace(btrim(coalesce(p.qual, '')), '\s+', ' ', 'g')) as using_normalized,
    lower(regexp_replace(btrim(coalesce(p.with_check, '')), '\s+', ' ', 'g')) as with_check_normalized
  from pg_catalog.pg_policies p
  where p.schemaname = 'public' and p.tablename in ('weight_logs','meal_logs')
),
-- compared: expected_policies（意図した12件）と実際のpg_policiesを左外部
-- 結合し、項目ごとの一致可否を個別列として持たせる。各列は必ずboolean
-- 1個であり、複数列を返すscalar subqueryにはしない。
compared as (
  select
    ep.tablename,
    ep.policyname,
    (ap.policyname is not null) as actual_exists,
    (ap.permissive is not distinct from ep.permissive) as permissive_matches,
    (ap.roles is not distinct from ep.roles) as roles_match,
    (ap.cmd is not distinct from ep.cmd) as cmd_matches,
    (
      nullif(ap.using_normalized, '') is not distinct from
      nullif(lower(regexp_replace(btrim(coalesce(ep.using_expected, '')), '\s+', ' ', 'g')), '')
    ) as using_matches,
    (
      nullif(ap.with_check_normalized, '') is not distinct from
      nullif(lower(regexp_replace(btrim(coalesce(ep.with_check_expected, '')), '\s+', ' ', 'g')), '')
    ) as with_check_matches
  from expected_policies ep
  left join actual_policies ap
    on ap.tablename = ep.tablename and ap.policyname = ep.policyname
),
-- comparedの列同士はSELECT-list内で相互参照できないため、6項目すべてが
-- 揃っているかどうかの総合判定は別CTEとして重ねる。
compared_full as (
  select
    c.*,
    (
      c.actual_exists
      and c.permissive_matches
      and c.roles_match
      and c.cmd_matches
      and c.using_matches
      and c.with_check_matches
    ) as fully_matches_expected
  from compared c
),
-- 意図した12件以外のPolicyが存在しないことも確認する
unexpected_policies as (
  select ap.tablename, ap.policyname
  from actual_policies ap
  left join expected_policies ep
    on ep.tablename = ap.tablename and ep.policyname = ap.policyname
  where ep.policyname is null
),
sec02 as (
  select
    'policies' as section,
    jsonb_build_object(
      'expected_vs_actual', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'table_name', c.tablename,
            'policy_name', c.policyname,
            'actual_exists', c.actual_exists,
            'permissive_matches', c.permissive_matches,
            'roles_match', c.roles_match,
            'cmd_matches', c.cmd_matches,
            'using_matches', c.using_matches,
            'with_check_matches', c.with_check_matches
          )
          order by c.tablename, c.policyname
        )
        from compared_full c
      ), '[]'::jsonb),
      'unexpected_policies', coalesce((
        select jsonb_agg(jsonb_build_object('table_name', u.tablename, 'policy_name', u.policyname) order by u.tablename, u.policyname)
        from unexpected_policies u
      ), '[]'::jsonb)
    ) as result,
    (
      not exists (select 1 from compared_full where not fully_matches_expected)
      and not exists (select 1 from unexpected_policies)
    ) as matches_expected
),

-- 03. authenticated/anon/service_roleのテーブル権限、PUBLICの直接ACL
priv_list (priv) as (
  values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')
),
target as (
  select unnest(array['weight_logs','meal_logs']::text[]) as table_name
),
role_priv as (
  select
    t.table_name,
    jsonb_object_agg(pl.priv, has_table_privilege('anon', ('public.' || t.table_name)::regclass, pl.priv)) as anon_privileges,
    jsonb_object_agg(pl.priv, has_table_privilege('authenticated', ('public.' || t.table_name)::regclass, pl.priv)) as authenticated_privileges,
    jsonb_object_agg(pl.priv, has_table_privilege('service_role', ('public.' || t.table_name)::regclass, pl.priv)) as service_role_privileges
  from target t
  cross join priv_list pl
  group by t.table_name
),
-- PUBLIC ACL：該当ACLが1件も無い場合、LEFT JOIN LATERALによりa.privilege_typeが
-- NULLの行だけが残る。jsonb_agg(distinct a.privilege_type)をそのまま使うと
-- [null]という配列になってしまうため、filter (where a.privilege_type is not null)
-- でNULLをdistinct集計の対象から除外し、0件の場合は必ず coalesce により
-- '[]'::jsonb（空配列）になるようにする。
public_acl as (
  select
    c.relname as table_name,
    coalesce(
      jsonb_agg(distinct a.privilege_type) filter (where a.privilege_type is not null),
      '[]'::jsonb
    ) as public_privileges
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  left join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    on a.grantee = 0
  where n.nspname = 'public' and c.relname in ('weight_logs','meal_logs')
  group by c.relname
),
acl_combined as (
  select
    rp.table_name,
    rp.anon_privileges,
    rp.authenticated_privileges,
    rp.service_role_privileges,
    coalesce(pa.public_privileges, '[]'::jsonb) as public_privileges
  from role_priv rp
  left join public_acl pa on pa.table_name = rp.table_name
),
sec03 as (
  select
    'acl' as section,
    coalesce(jsonb_agg(jsonb_build_object(
      'table_name', table_name,
      'anon_privileges', anon_privileges,
      'authenticated_privileges', authenticated_privileges,
      'service_role_privileges', service_role_privileges,
      'public_direct_acl', public_privileges
    ) order by table_name), '[]'::jsonb) as result,
    (
      -- anonは両テーブルとも全項目false
      not exists (
        select 1 from acl_combined, jsonb_each(anon_privileges) e
        where (e.value)::boolean = true
      )
      -- PUBLICの直接ACLは両テーブルとも空（0件ならこの条件は必ずtrueになる）
      and not exists (
        select 1 from acl_combined where jsonb_array_length(public_privileges) > 0
      )
      -- authenticated: 両テーブルともSELECT/INSERT/UPDATEのみtrue、
      -- DELETE/TRUNCATE/REFERENCES/TRIGGERはfalse
      and (select authenticated_privileges from acl_combined where table_name = 'weight_logs')
          @> '{"SELECT":true,"INSERT":true,"UPDATE":true,"DELETE":false,"TRUNCATE":false,"REFERENCES":false,"TRIGGER":false}'::jsonb
      and (select authenticated_privileges from acl_combined where table_name = 'meal_logs')
          @> '{"SELECT":true,"INSERT":true,"UPDATE":true,"DELETE":false,"TRUNCATE":false,"REFERENCES":false,"TRIGGER":false}'::jsonb
      -- service_role: 両テーブルとも、Phase 5B-2Fで確認済みのとおり
      -- SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGERの7権限が
      -- すべてtrueであること（本ファイル・適用SQLとも変更していない権限）
      and (select service_role_privileges from acl_combined where table_name = 'weight_logs')
          @> '{"SELECT":true,"INSERT":true,"UPDATE":true,"DELETE":true,"TRUNCATE":true,"REFERENCES":true,"TRIGGER":true}'::jsonb
      and (select service_role_privileges from acl_combined where table_name = 'meal_logs')
          @> '{"SELECT":true,"INSERT":true,"UPDATE":true,"DELETE":true,"TRUNCATE":true,"REFERENCES":true,"TRIGGER":true}'::jsonb
    ) as matches_expected
  from acl_combined
),

-- 04. DELETE/TRUNCATE/REFERENCES/TRIGGERがauthenticatedから除去されていることの単独確認
sec04 as (
  select
    'authenticated_dangerous_privileges_removed' as section,
    jsonb_build_object(
      'weight_logs', jsonb_build_object(
        'delete',     has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'DELETE'),
        'trigger',    has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'TRIGGER'),
        'truncate',   has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'TRUNCATE'),
        'references', has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'REFERENCES')
      ),
      'meal_logs', jsonb_build_object(
        'delete',     has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'DELETE'),
        'trigger',    has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'TRIGGER'),
        'truncate',   has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'TRUNCATE'),
        'references', has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'REFERENCES')
      )
    ) as result,
    not (
      has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'DELETE')
      or has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'TRIGGER')
      or has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'TRUNCATE')
      or has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'REFERENCES')
      or has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'DELETE')
      or has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'TRIGGER')
      or has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'TRUNCATE')
      or has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'REFERENCES')
    ) as matches_expected
),

-- 05. client_id整合性件数（NULL件数・孤立参照件数は0を期待値として判定する。
--     個人情報・行内容は一切出力せず、件数のみ）
integrity_counts as (
  select
    (select count(*) from public.weight_logs where client_id is null) as weight_logs_null_client_id_count,
    (select count(*)
       from public.weight_logs w
       where w.client_id is not null
         and not exists (select 1 from public.clients c where c.id = w.client_id)) as weight_logs_orphan_client_id_count,
    (select count(*) from public.meal_logs where client_id is null) as meal_logs_null_client_id_count,
    (select count(*)
       from public.meal_logs m
       where m.client_id is not null
         and not exists (select 1 from public.clients c where c.id = m.client_id)) as meal_logs_orphan_client_id_count
),
sec05 as (
  select
    'client_id_integrity' as section,
    to_jsonb(ic.*) as result,
    (
      ic.weight_logs_null_client_id_count = 0
      and ic.weight_logs_orphan_client_id_count = 0
      and ic.meal_logs_null_client_id_count = 0
      and ic.meal_logs_orphan_client_id_count = 0
    ) as matches_expected
  from integrity_counts ic
),

-- 06. 総行数（情報提供のみ。運用中に増減する値のため自動判定は行わない）
counts as (
  select
    'row_counts_informational_only' as section,
    jsonb_build_object(
      'weight_logs_total', (select count(*) from public.weight_logs),
      'meal_logs_total', (select count(*) from public.meal_logs),
      'note', 'これらは運用中に増減する値であり、この postcheck 単独では正誤判定しない。適用直前に別途確認した値と目視で比較すること。'
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
select section, result, matches_expected from counts
order by section;

rollback;
