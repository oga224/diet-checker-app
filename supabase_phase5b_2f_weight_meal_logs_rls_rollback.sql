-- ============================================================
-- ★★★ 危険：Phase 5B-2F適用前（Phase 5B-2F本番監査時点）の、より弱い
-- セキュリティ状態へ public.weight_logs / public.meal_logs を戻す
-- 緊急用ファイル。通常は実行しないこと。 ★★★
--
-- このSQLを実行すると、supabase_phase5b_2f_weight_meal_logs_rls_apply.sql
-- 適用前の状態、すなわち「weight_logs / meal_logs のRLSが無効であり、
-- authenticatedロール（ログイン済みの患者・管理者を問わず全員）が
-- 両テーブルへSELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER
-- を無条件に持つ」という、Phase 5B-2Fの本番監査で確認された状態へ
-- 戻ります。この状態では、ログイン済みの患者アカウント1つでも、
-- アプリのUIを経由せずSupabaseのREST APIを直接呼べば、他の患者・
-- 他店舗の体重記録・食事記録全行を読み書き・削除できてしまいます。
--
-- Phase 5B-2F適用が既存の管理者画面・患者画面を壊した場合の復旧専用
-- ファイルであり、通常運用では実行しないでください。
--
-- ── 復元の範囲に関する制限事項 ──────────────────────────────
-- 本ファイルが復元するのは、Phase 5B-2F適用SQLが変更した範囲
-- （weight_logs/meal_logsのPolicy・RLS有効フラグ・authenticated/anon/
-- PUBLICのGRANT）だけである。anonについては、Phase 5B-2F監査時点で
-- 既に無権限だったため、本ファイルもanonへは一切の権限を復元しない。
--
-- RLS・Policy・GRANT以外（データ行、clients、stores、profiles、
-- customer_number_counters、next_customer_number、body_photos、
-- admin_comments、Storage、他店舗匿名化RPC4関数）はこのファイルでは
-- 一切変更しない。新しいテーブル・関数も作成しない。
--
-- 本ファイルは、Phase 5B-2F適用SQLが実際に完了した状態
-- （weight_logs/meal_logsのRLSが有効かつ、意図した12件のPolicyが
-- policyname/permissive/cmd/roles/USING/WITH CHECKまで完全に一致して
-- 存在する状態）であることを事前確認したうえでのみ処理を進める。
-- この状態でなければ（＝Phase 5B-2F適用が完了していなければ）、誤って
-- 実行しても何も変更せずエラー終了する。
--
-- 復元後のweight_logs/meal_logs Policyは、Phase 5B-2F本番監査で実際に
-- 取得された定義（"<table>: client all own"、cmd=ALL、
-- roles={public}、with_check NULLの1件だけ）と一致する。この比較に
-- 使うqual期待値は、Phase 5B-2F本番監査で実際に取得された正規化後
-- テキストをそのまま用いている（推測値ではない）。
--
-- precondition・postconditionが参照するPhase 5B-2F適用SQL側の12Policy
-- （weight_logs 6件・meal_logs 6件）のUSING/WITH CHECK期待値も、
-- Phase 5B-2F policy deparse preflight（本番実測、必ずROLLBACKする
-- 検証専用トランザクション）でpg_policiesから直接取得した正規化後
-- テキストをそのまま使用している。
--
-- 変更対象はpublic.weight_logs / public.meal_logsのPolicy・RLS・GRANT
-- のみ。public.profiles / public.clientsはPolicy判定のためのサブクエリ
-- で参照するが、本ファイルはそれ自体を変更しない。
-- ============================================================

begin;
set local lock_timeout = '5s';

-- ロック順序は適用SQLと同一（weight_logs→meal_logs）。
lock table public.weight_logs in access exclusive mode;
lock table public.meal_logs   in access exclusive mode;

do $$
declare
  v_bad_auth_priv             text[];
  v_bad_anon_priv              text[];
  v_bad_public_acl             text[];
  v_before_weight_logs_count   bigint;
  v_before_meal_logs_count     bigint;
  v_after_weight_logs_count    bigint;
  v_after_meal_logs_count      bigint;
  v_bad_final_auth_priv        text[];
  v_bad_final_anon_priv        text[];
  v_bad_final_public_acl       text[];
  v_before_svc_weight_logs_priv jsonb;
  v_before_svc_meal_logs_priv   jsonb;
  v_after_svc_weight_logs_priv  jsonb;
  v_after_svc_meal_logs_priv    jsonb;
  v_bad_policy_fields           text[];
  v_extra_policies              text[];
  v_weight_logs_policy_count    int;
  v_meal_logs_policy_count      int;
  v_weight_logs_baseline_ok     boolean;
  v_meal_logs_baseline_ok       boolean;
  v_actual_permissive           text;
  v_actual_roles                name[];
  v_actual_cmd                  text;
  v_actual_using                text;
  v_actual_with_check           text;
  v_expected_qual_norm          text;
  v_weight_logs_null_client_id  bigint;
  v_meal_logs_null_client_id    bigint;
  v_weight_logs_orphan_client_id bigint;
  v_meal_logs_orphan_client_id   bigint;
begin
  -- ══════════════════════════════════════════════════════════
  -- 1. precondition（Phase 5B-2F適用が完了した状態であることの確認。
  --    未完了の場合は「誤実行」とみなし、ここで中断する）
  -- ══════════════════════════════════════════════════════════

  -- 1a. weight_logs/meal_logsのRLSが現在「有効」であり、FORCE RLSは
  --     設定されていないこと（Phase 5B-2F適用後の想定状態）
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('weight_logs','meal_logs')
      and (c.relrowsecurity = false or c.relforcerowsecurity = true)
  ) then
    raise exception 'precondition failed: weight_logs or meal_logs does not have the expected post-apply RLS state (rls_enabled=true, force_rls=false); Phase 5B-2F apply does not appear to have completed. Refusing to run this rollback';
  end if;

  -- 1b. weight_logs 6件・meal_logs 6件のPolicyが、policyname/permissive/
  --     cmd/roles/USING/WITH CHECKのすべてについて、Phase 5B-2F適用SQL
  --     の意図した定義と完全に一致すること（正規化比較）。意図した12件
  --     以外のPolicyが存在しないことも確認する。期待値は、Phase 5B-2F
  --     policy deparse preflight（本番実測、必ずROLLBACKする検証専用
  --     トランザクション）でpg_policiesから実際に取得した正規化後
  --     USING/WITH CHECKをそのまま使用する（推測値ではない）。
  with expected_policies (tablename, policyname, permissive, roles, cmd, using_expected, with_check_expected) as (
    values
      ('weight_logs', 'weight_logs: client select own', 'PERMISSIVE', array['authenticated']::name[], 'SELECT',
       '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''client''::text) and (p.client_id = weight_logs.client_id))))', null::text),
      ('weight_logs', 'weight_logs: client insert own', 'PERMISSIVE', array['authenticated']::name[], 'INSERT',
       null::text, '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''client''::text) and (p.client_id = weight_logs.client_id))))'),
      ('weight_logs', 'weight_logs: client update own', 'PERMISSIVE', array['authenticated']::name[], 'UPDATE',
       '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''client''::text) and (p.client_id = weight_logs.client_id))))',
       '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''client''::text) and (p.client_id = weight_logs.client_id))))'),
      ('weight_logs', 'weight_logs: admin select own store', 'PERMISSIVE', array['authenticated']::name[], 'SELECT',
       '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (exists ( select 1 from clients c where ((c.id = weight_logs.client_id) and (c.store_id = p.store_id)))))))))', null::text),
      ('weight_logs', 'weight_logs: admin insert own store', 'PERMISSIVE', array['authenticated']::name[], 'INSERT',
       null::text, '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (exists ( select 1 from clients c where ((c.id = weight_logs.client_id) and (c.store_id = p.store_id)))))))))'),
      ('weight_logs', 'weight_logs: admin update own store', 'PERMISSIVE', array['authenticated']::name[], 'UPDATE',
       '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (exists ( select 1 from clients c where ((c.id = weight_logs.client_id) and (c.store_id = p.store_id)))))))))',
       '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (exists ( select 1 from clients c where ((c.id = weight_logs.client_id) and (c.store_id = p.store_id)))))))))'),
      ('meal_logs', 'meal_logs: client select own', 'PERMISSIVE', array['authenticated']::name[], 'SELECT',
       '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''client''::text) and (p.client_id = meal_logs.client_id))))', null::text),
      ('meal_logs', 'meal_logs: client insert own', 'PERMISSIVE', array['authenticated']::name[], 'INSERT',
       null::text, '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''client''::text) and (p.client_id = meal_logs.client_id))))'),
      ('meal_logs', 'meal_logs: client update own', 'PERMISSIVE', array['authenticated']::name[], 'UPDATE',
       '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''client''::text) and (p.client_id = meal_logs.client_id))))',
       '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''client''::text) and (p.client_id = meal_logs.client_id))))'),
      ('meal_logs', 'meal_logs: admin select own store', 'PERMISSIVE', array['authenticated']::name[], 'SELECT',
       '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (exists ( select 1 from clients c where ((c.id = meal_logs.client_id) and (c.store_id = p.store_id)))))))))', null::text),
      ('meal_logs', 'meal_logs: admin insert own store', 'PERMISSIVE', array['authenticated']::name[], 'INSERT',
       null::text, '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (exists ( select 1 from clients c where ((c.id = meal_logs.client_id) and (c.store_id = p.store_id)))))))))'),
      ('meal_logs', 'meal_logs: admin update own store', 'PERMISSIVE', array['authenticated']::name[], 'UPDATE',
       '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (exists ( select 1 from clients c where ((c.id = meal_logs.client_id) and (c.store_id = p.store_id)))))))))',
       '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (exists ( select 1 from clients c where ((c.id = meal_logs.client_id) and (c.store_id = p.store_id)))))))))')
  ),
  actual as (
    select
      p.tablename, p.policyname, p.permissive, p.roles, p.cmd,
      lower(regexp_replace(btrim(coalesce(p.qual, '')), '\s+', ' ', 'g')) as using_norm,
      lower(regexp_replace(btrim(coalesce(p.with_check, '')), '\s+', ' ', 'g')) as with_check_norm
    from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename in ('weight_logs','meal_logs')
  ),
  mismatches as (
    select
      ep.tablename || ':' || ep.policyname as key,
      (a.tablename is null) as missing,
      a.permissive is distinct from ep.permissive as permissive_bad,
      a.roles is distinct from ep.roles as roles_bad,
      a.cmd is distinct from ep.cmd as cmd_bad,
      nullif(a.using_norm, '') is distinct from nullif(lower(regexp_replace(btrim(coalesce(ep.using_expected, '')), '\s+', ' ', 'g')), '') as using_bad,
      nullif(a.with_check_norm, '') is distinct from nullif(lower(regexp_replace(btrim(coalesce(ep.with_check_expected, '')), '\s+', ' ', 'g')), '') as with_check_bad
    from expected_policies ep
    left join actual a on a.tablename = ep.tablename and a.policyname = ep.policyname
  ),
  extra as (
    select a.tablename || ':' || a.policyname as key
    from actual a
    left join expected_policies ep on ep.tablename = a.tablename and ep.policyname = a.policyname
    where ep.policyname is null
  )
  select
    (select array_agg(key) from mismatches where missing or permissive_bad or roles_bad or cmd_bad or using_bad or with_check_bad),
    (select array_agg(key) from extra)
  into v_bad_policy_fields, v_extra_policies;

  if v_bad_policy_fields is not null or v_extra_policies is not null then
    raise exception 'precondition failed: the current weight_logs/meal_logs policies do not exactly match the expected post-apply 12-policy set; Phase 5B-2F apply does not appear to have completed as intended. Refusing to run this rollback. mismatched=%, extra=%', v_bad_policy_fields, v_extra_policies;
  end if;

  -- 1c. authenticatedが2F適用後の想定（両テーブルともSELECT/INSERT/UPDATE
  --     のみ、DELETE/TRUNCATE/REFERENCES/TRIGGERなし）と一致すること
  select array_agg(chk) into v_bad_auth_priv
  from (
    select 'weight_logs:SELECT'     as chk where not has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'SELECT')
    union all select 'weight_logs:INSERT'     where not has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'INSERT')
    union all select 'weight_logs:UPDATE'     where not has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'UPDATE')
    union all select 'weight_logs:DELETE'     where has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'DELETE')
    union all select 'weight_logs:TRUNCATE'   where has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'TRUNCATE')
    union all select 'weight_logs:REFERENCES' where has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'REFERENCES')
    union all select 'weight_logs:TRIGGER'    where has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'TRIGGER')
    union all select 'meal_logs:SELECT'       where not has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'SELECT')
    union all select 'meal_logs:INSERT'       where not has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'INSERT')
    union all select 'meal_logs:UPDATE'       where not has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'UPDATE')
    union all select 'meal_logs:DELETE'       where has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'DELETE')
    union all select 'meal_logs:TRUNCATE'     where has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'TRUNCATE')
    union all select 'meal_logs:REFERENCES'   where has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'REFERENCES')
    union all select 'meal_logs:TRIGGER'      where has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'TRIGGER')
  ) x;
  if v_bad_auth_priv is not null then
    raise exception 'precondition failed: authenticated privileges do not match the expected post-apply state (refusing to run this rollback): %', v_bad_auth_priv;
  end if;

  -- 1d. anonが依然として無権限であること
  select array_agg(t || ':' || pr) into v_bad_anon_priv
  from unnest(array['weight_logs','meal_logs']::text[]) as t
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr
  where has_table_privilege('anon', ('public.' || t)::regclass, pr);
  if v_bad_anon_priv is not null then
    raise exception 'precondition failed: anon unexpectedly has privileges: %', v_bad_anon_priv;
  end if;

  -- 1e. PUBLICが対象2テーブルへ直接ACLを持たないこと
  select array_agg(t) into v_bad_public_acl
  from (
    select c.relname as t
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    where n.nspname = 'public' and c.relname in ('weight_logs','meal_logs')
      and a.grantee = 0
  ) x;
  if v_bad_public_acl is not null then
    raise exception 'precondition failed: PUBLIC unexpectedly has a direct ACL entry on: %', v_bad_public_acl;
  end if;

  -- 1f. 変更前のservice_role権限・行数・client_id整合性件数を記録する
  --     （本トランザクション内でのbefore/after比較にのみ使用し、
  --     固定値としてハードコードしない）
  select jsonb_object_agg(pr, has_table_privilege('service_role', 'public.weight_logs'::regclass, pr))
    into v_before_svc_weight_logs_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr;

  select jsonb_object_agg(pr, has_table_privilege('service_role', 'public.meal_logs'::regclass, pr))
    into v_before_svc_meal_logs_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr;

  select count(*) into v_before_weight_logs_count from public.weight_logs;
  select count(*) into v_before_meal_logs_count   from public.meal_logs;

  select count(*) into v_weight_logs_null_client_id from public.weight_logs where client_id is null;
  select count(*) into v_meal_logs_null_client_id   from public.meal_logs where client_id is null;
  select count(*) into v_weight_logs_orphan_client_id
  from public.weight_logs w
  where w.client_id is not null and not exists (select 1 from public.clients c where c.id = w.client_id);
  select count(*) into v_meal_logs_orphan_client_id
  from public.meal_logs m
  where m.client_id is not null and not exists (select 1 from public.clients c where c.id = m.client_id);

  if v_weight_logs_null_client_id <> 0 or v_meal_logs_null_client_id <> 0
     or v_weight_logs_orphan_client_id <> 0 or v_meal_logs_orphan_client_id <> 0 then
    raise exception 'precondition failed: client_id integrity counts are not zero before rollback (weight_logs_null=%, meal_logs_null=%, weight_logs_orphan=%, meal_logs_orphan=%)',
      v_weight_logs_null_client_id, v_meal_logs_null_client_id, v_weight_logs_orphan_client_id, v_meal_logs_orphan_client_id;
  end if;

  -- ══════════════════════════════════════════════════════════
  -- 2. Policyを2F監査時点の状態へ戻す
  -- ══════════════════════════════════════════════════════════
  drop policy if exists "weight_logs: client select own"       on public.weight_logs;
  drop policy if exists "weight_logs: client insert own"       on public.weight_logs;
  drop policy if exists "weight_logs: client update own"       on public.weight_logs;
  drop policy if exists "weight_logs: admin select own store"  on public.weight_logs;
  drop policy if exists "weight_logs: admin insert own store"  on public.weight_logs;
  drop policy if exists "weight_logs: admin update own store"  on public.weight_logs;

  drop policy if exists "meal_logs: client select own"         on public.meal_logs;
  drop policy if exists "meal_logs: client insert own"         on public.meal_logs;
  drop policy if exists "meal_logs: client update own"         on public.meal_logs;
  drop policy if exists "meal_logs: admin select own store"    on public.meal_logs;
  drop policy if exists "meal_logs: admin insert own store"    on public.meal_logs;
  drop policy if exists "meal_logs: admin update own store"    on public.meal_logs;

  -- Phase 5B-2F本番監査で実際に確認された定義に一致させる（Supabase上で
  -- 取得した監査結果を正とし、リポジトリ内SQLファイルの履歴からの推測は
  -- 使用しない）。本番監査時点、weight_logs/meal_logsのPolicyはそれぞれ
  -- "<table>: client all own"（ALL、roles={public}、with_check NULL）の
  -- 1件だけであった。
  create policy "weight_logs: client all own" on public.weight_logs
    for all using (
      client_id = (select profiles.client_id from public.profiles where profiles.id = auth.uid())
    );

  create policy "meal_logs: client all own" on public.meal_logs
    for all using (
      client_id = (select profiles.client_id from public.profiles where profiles.id = auth.uid())
    );

  -- ══════════════════════════════════════════════════════════
  -- 3. GRANTを2F監査時点の状態へ戻す（authenticatedにALL PRIVILEGESを復元）
  -- ══════════════════════════════════════════════════════════
  grant select, insert, update, delete, truncate, references, trigger
    on table public.weight_logs to authenticated;
  grant select, insert, update, delete, truncate, references, trigger
    on table public.meal_logs to authenticated;

  -- anon/PUBLICへは何も付与しない。

  -- ══════════════════════════════════════════════════════════
  -- 4. RLSを2F監査時点の状態（無効）へ戻す
  -- ══════════════════════════════════════════════════════════
  alter table public.weight_logs disable row level security;
  alter table public.meal_logs   disable row level security;

  -- ══════════════════════════════════════════════════════════
  -- 5. postcondition
  -- ══════════════════════════════════════════════════════════

  -- 5a. RLSが無効化されており、FORCE RLSも設定されていないこと
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('weight_logs','meal_logs')
      and (c.relrowsecurity = true or c.relforcerowsecurity = true)
  ) then
    raise exception 'postcondition failed: weight_logs or meal_logs does not have the intended RLS state (expected rls_enabled=false, force_rls=false) after rollback';
  end if;

  -- 5b. weight_logs/meal_logsのPolicyが各テーブル正確に1件、Phase 5B-2F
  --     本番監査結果とpolicyname/permissive/cmd/roles/USING/WITH CHECK
  --     のすべてで一致すること
  v_expected_qual_norm := lower(regexp_replace(btrim(
    '(client_id = ( select profiles.client_id from profiles where (profiles.id = auth.uid())))'
  ), '\s+', ' ', 'g'));

  select count(*) into v_weight_logs_policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'weight_logs';

  select exists (
    select 1
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'weight_logs'
      and p.policyname = 'weight_logs: client all own'
      and p.permissive = 'PERMISSIVE'
      and p.roles = array['public']::name[]
      and p.cmd = 'ALL'
      and lower(regexp_replace(btrim(coalesce(p.qual, '')), '\s+', ' ', 'g')) = v_expected_qual_norm
      and p.with_check is null
  ) into v_weight_logs_baseline_ok;

  if v_weight_logs_policy_count <> 1 or not v_weight_logs_baseline_ok then
    select p.permissive, p.roles, p.cmd,
           lower(regexp_replace(btrim(coalesce(p.qual, '')), '\s+', ' ', 'g')),
           lower(regexp_replace(btrim(coalesce(p.with_check, '')), '\s+', ' ', 'g'))
      into v_actual_permissive, v_actual_roles, v_actual_cmd, v_actual_using, v_actual_with_check
    from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'weight_logs' and p.policyname = 'weight_logs: client all own';

    raise exception 'postcondition failed: restored weight_logs policy does not match the Phase 5B-2F production audit baseline exactly. policy_count=%, permissive=%, roles=%, cmd=%, using_normalized=%, with_check_normalized=%',
      v_weight_logs_policy_count, v_actual_permissive, v_actual_roles, v_actual_cmd, v_actual_using, v_actual_with_check;
  end if;

  select count(*) into v_meal_logs_policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'meal_logs';

  select exists (
    select 1
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'meal_logs'
      and p.policyname = 'meal_logs: client all own'
      and p.permissive = 'PERMISSIVE'
      and p.roles = array['public']::name[]
      and p.cmd = 'ALL'
      and lower(regexp_replace(btrim(coalesce(p.qual, '')), '\s+', ' ', 'g')) = v_expected_qual_norm
      and p.with_check is null
  ) into v_meal_logs_baseline_ok;

  if v_meal_logs_policy_count <> 1 or not v_meal_logs_baseline_ok then
    select p.permissive, p.roles, p.cmd,
           lower(regexp_replace(btrim(coalesce(p.qual, '')), '\s+', ' ', 'g')),
           lower(regexp_replace(btrim(coalesce(p.with_check, '')), '\s+', ' ', 'g'))
      into v_actual_permissive, v_actual_roles, v_actual_cmd, v_actual_using, v_actual_with_check
    from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'meal_logs' and p.policyname = 'meal_logs: client all own';

    raise exception 'postcondition failed: restored meal_logs policy does not match the Phase 5B-2F production audit baseline exactly. policy_count=%, permissive=%, roles=%, cmd=%, using_normalized=%, with_check_normalized=%',
      v_meal_logs_policy_count, v_actual_permissive, v_actual_roles, v_actual_cmd, v_actual_using, v_actual_with_check;
  end if;

  -- 5c. authenticatedが両テーブルともALL PRIVILEGES相当（7権限すべてtrue）を持つこと
  select array_agg(chk) into v_bad_final_auth_priv
  from (
    select 'weight_logs:SELECT'    as chk where not has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'SELECT')
    union all select 'weight_logs:INSERT'    where not has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'INSERT')
    union all select 'weight_logs:UPDATE'    where not has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'UPDATE')
    union all select 'weight_logs:DELETE'    where not has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'DELETE')
    union all select 'weight_logs:TRUNCATE'  where not has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'TRUNCATE')
    union all select 'weight_logs:REFERENCES' where not has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'REFERENCES')
    union all select 'weight_logs:TRIGGER'   where not has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'TRIGGER')
    union all select 'meal_logs:SELECT'      where not has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'SELECT')
    union all select 'meal_logs:INSERT'      where not has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'INSERT')
    union all select 'meal_logs:UPDATE'      where not has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'UPDATE')
    union all select 'meal_logs:DELETE'      where not has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'DELETE')
    union all select 'meal_logs:TRUNCATE'    where not has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'TRUNCATE')
    union all select 'meal_logs:REFERENCES'  where not has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'REFERENCES')
    union all select 'meal_logs:TRIGGER'     where not has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'TRIGGER')
  ) x;
  if v_bad_final_auth_priv is not null then
    raise exception 'postcondition failed: authenticated privileges do not match the Phase 5B-2F baseline (ALL PRIVILEGES expected): %', v_bad_final_auth_priv;
  end if;

  -- 5d. anonが依然として無権限であること
  select array_agg(t || ':' || pr) into v_bad_final_anon_priv
  from unnest(array['weight_logs','meal_logs']::text[]) as t
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr
  where has_table_privilege('anon', ('public.' || t)::regclass, pr);
  if v_bad_final_anon_priv is not null then
    raise exception 'postcondition failed: anon unexpectedly has privileges after rollback: %', v_bad_final_anon_priv;
  end if;

  -- 5e. PUBLICが依然として直接ACLを持たないこと
  select array_agg(t) into v_bad_final_public_acl
  from (
    select c.relname as t
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    where n.nspname = 'public' and c.relname in ('weight_logs','meal_logs')
      and a.grantee = 0
  ) x;
  if v_bad_final_public_acl is not null then
    raise exception 'postcondition failed: PUBLIC unexpectedly has a direct ACL entry on weight_logs or meal_logs after rollback: %', v_bad_final_public_acl;
  end if;

  -- 5f. service_roleの権限がrollback前と完全に一致すること（本ファイルでは一切変更していないはず）
  select jsonb_object_agg(pr, has_table_privilege('service_role', 'public.weight_logs'::regclass, pr))
    into v_after_svc_weight_logs_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr;

  select jsonb_object_agg(pr, has_table_privilege('service_role', 'public.meal_logs'::regclass, pr))
    into v_after_svc_meal_logs_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr;

  if v_after_svc_weight_logs_priv is distinct from v_before_svc_weight_logs_priv then
    raise exception 'postcondition failed: service_role privileges on weight_logs changed unexpectedly during rollback';
  end if;
  if v_after_svc_meal_logs_priv is distinct from v_before_svc_meal_logs_priv then
    raise exception 'postcondition failed: service_role privileges on meal_logs changed unexpectedly during rollback';
  end if;

  -- 5g. データ行数が変更されていないこと
  select count(*) into v_after_weight_logs_count from public.weight_logs;
  select count(*) into v_after_meal_logs_count   from public.meal_logs;
  if v_after_weight_logs_count <> v_before_weight_logs_count then
    raise exception 'postcondition failed: weight_logs row count changed during rollback (% -> %)', v_before_weight_logs_count, v_after_weight_logs_count;
  end if;
  if v_after_meal_logs_count <> v_before_meal_logs_count then
    raise exception 'postcondition failed: meal_logs row count changed during rollback (% -> %)', v_before_meal_logs_count, v_after_meal_logs_count;
  end if;

  -- 5h. NULL client_id件数・孤立参照件数が両テーブルとも依然として0であること
  if (select count(*) from public.weight_logs where client_id is null) <> 0 then
    raise exception 'postcondition failed: public.weight_logs has row(s) with client_id IS NULL after rollback';
  end if;
  if (select count(*) from public.meal_logs where client_id is null) <> 0 then
    raise exception 'postcondition failed: public.meal_logs has row(s) with client_id IS NULL after rollback';
  end if;
  if exists (
    select 1 from public.weight_logs w
    where w.client_id is not null and not exists (select 1 from public.clients c where c.id = w.client_id)
  ) then
    raise exception 'postcondition failed: public.weight_logs has row(s) referencing a nonexistent clients.id after rollback';
  end if;
  if exists (
    select 1 from public.meal_logs m
    where m.client_id is not null and not exists (select 1 from public.clients c where c.id = m.client_id)
  ) then
    raise exception 'postcondition failed: public.meal_logs has row(s) referencing a nonexistent clients.id after rollback';
  end if;
end $$;

commit;
