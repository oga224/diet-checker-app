-- ============================================================
-- Phase 5B-2F: public.weight_logs / public.meal_logs の恒久的な
-- アクセス制御（RLS有効化＋Policy作成＋GRANT整理）を、同一トランザクション
-- 内で一括して適用する本番SQL。
--
-- 背景：
-- Phase 5B-2F本番読み取り専用監査
-- （supabase_phase5b_2f_weight_meal_logs_readonly_audit.sql、実行済み）
-- により、weight_logs / meal_logs は現在RLSが無効であり、各テーブルに
-- 単一のPolicy「<table>: client all own」（PERMISSIVE, roles={public},
-- cmd=ALL, with_check=NULL, qual=client_id一致のみ）だけが存在し、
-- authenticatedロールが両テーブルへSELECT/INSERT/UPDATE/DELETEに加え
-- TRIGGER/TRUNCATE/REFERENCESまで保持していることが確認された
-- （anonは既にPhase 5B-1Eで遮断済み、両テーブルでfalseを確認済み）。
--
-- 続けて実施したPhase 5B-2F policy deparse preflight
-- （supabase_phase5b_2f_weight_meal_logs_policy_deparse_preflight.sql、
-- 本番で実行し必ずROLLBACKする検証専用トランザクション）で、新設する
-- 12Policy（weight_logs 6件・meal_logs 6件）と同一のCREATE POLICY文を
-- 実際に本番へ一時作成し、pg_policiesから直接、正規化後のUSING/
-- WITH CHECKテキストを取得済みである。本ファイルのpostconditionで使う
-- 期待値は、その実測値をそのまま使用する（推測値ではない）。
--
-- 本ファイルが変更するのは、public.weight_logs / public.meal_logsの
-- Policy・RLS有効フラグ・GRANT/REVOKEのみ。public.profiles /
-- public.clientsはPolicy判定のサブクエリで参照するだけで一切変更しない。
-- 他店舗匿名化RPC4関数（admin_get_other_store_weight_logs /
-- admin_get_other_store_meal_logs 等）・Storage・その他のテーブルも
-- 一切変更しない。データ行のINSERT/UPDATE/DELETEは一切行わない。
-- 新しいテーブル・関数は作成しない。
--
-- 【Policy設計（weight_logs / meal_logsとも同一の6パターン）】
--   - "<table>: client select own"（SELECT, USING）：
--       呼び出し元profileがrole='client'であり、かつそのprofile.client_id
--       が対象行のclient_idと一致すること。
--   - "<table>: client insert own"（INSERT, WITH CHECKのみ）：SELECTと同一条件。
--   - "<table>: client update own"（UPDATE, USING/WITH CHECK両方）：
--       USINGは更新対象の既存行、WITH CHECKは更新後の新しい行を
--       同じ条件で判定するため、患者は自分以外のclient_idへの
--       付け替えができない。
--   - "<table>: admin select own store"（SELECT, USING）：
--       呼び出し元がrole='admin'かつ（is_super_admin=true　または
--       store_idが非NULLかつ対象行のclientが所属するclients.store_idと
--       一致）。
--   - "<table>: admin insert own store"（INSERT, WITH CHECKのみ）：SELECTと同一条件。
--   - "<table>: admin update own store"（UPDATE, USING/WITH CHECK両方）：
--       非super_adminの管理者は他店舗のclientの行を作成・更新できない。
-- DELETE PolicyとFOR ALL Policyは作成しない（client/adminともDELETEを
-- 許可しない。既存フロントエンドにもweight_logs/meal_logsへのDELETE
-- 呼び出しは存在しない）。他店舗のclientの閲覧は既存のSECURITY DEFINER
-- 匿名化RPC（admin_get_other_store_weight_logs /
-- admin_get_other_store_meal_logs）経由のみとし、本Policyでは意図的に
-- 扱わない（他店舗adminによる直接アクセスは許可しない）。
--
-- USING/WITH CHECKの一致判定は、pg_policies.qual / pg_policies.with_check
-- のテキストを、空白（改行・タブ・連続スペースを単一スペースへ圧縮）と
-- 大文字小文字だけを正規化したうえで比較する
-- （lower(regexp_replace(btrim(coalesce(expr,'')), '\s+', ' ', 'g'))）。
-- 条件式の構造そのものを変える正規化（括弧の除去・語順の入れ替え等）は
-- 行わない。
--
-- 【GRANT設計】
-- weight_logs / meal_logsとも、authenticatedからALL PRIVILEGESを一旦
-- REVOKEし、SELECT/INSERT/UPDATEのみを再GRANT（DELETE/TRUNCATE/
-- REFERENCES/TRIGGERは復元しない。実際の行アクセス制御はRLS Policyが行う）。
-- anon/PUBLICへは両テーブルとも一切GRANTしない（既に無権限のはずだが、
-- 念のため明示的にREVOKE ALLを再実行する）。
-- service_role・postgresの権限は一切変更しない（REVOKE/GRANT文の
-- from/to句に含めない）。
--
-- 影響の見積り：
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY はACCESS EXCLUSIVEロックを
-- 要求するため、本トランザクション実行中は weight_logs / meal_logs への
-- 全ての読み書き（管理者画面・患者画面のSELECT含む）が一時的に
-- キューイングされる。lock_timeout超過時は変更を行わず自動的に
-- エラー終了する。
-- ============================================================

begin;
set local lock_timeout = '5s';

-- ロック順序はweight_logs→meal_logsで固定する（preflightと同一順序）。
lock table public.weight_logs in access exclusive mode;
lock table public.meal_logs   in access exclusive mode;

do $$
declare
  v_missing_tables                       text[];
  v_missing_columns                      text[];
  v_missing_roles                        text[];
  v_weight_logs_policy_count             int;
  v_meal_logs_policy_count               int;
  v_weight_logs_baseline_ok              boolean;
  v_meal_logs_baseline_ok                boolean;
  v_actual_permissive                    text;
  v_actual_roles                         name[];
  v_actual_cmd                           text;
  v_actual_qual_norm                     text;
  v_actual_with_check_norm               text;
  v_expected_qual_norm                   text;
  v_expected_clients_admin_select_qual   text;
  v_bad_anon_priv                        text[];
  v_bad_auth_priv                        text[];
  v_bad_public_acl                       text[];
  v_weight_logs_null_client_id           bigint;
  v_meal_logs_null_client_id             bigint;
  v_weight_logs_orphan_client_id         bigint;
  v_meal_logs_orphan_client_id           bigint;
  v_before_weight_logs_count             bigint;
  v_before_meal_logs_count               bigint;
  v_after_weight_logs_count              bigint;
  v_after_meal_logs_count                bigint;
  v_before_svc_weight_logs_priv          jsonb;
  v_before_svc_meal_logs_priv            jsonb;
  v_after_svc_weight_logs_priv           jsonb;
  v_after_svc_meal_logs_priv             jsonb;
  v_bad_final_anon_priv                  text[];
  v_bad_final_public_acl                 text[];
  v_bad_policy_fields                    text[];
  v_extra_policies                       text[];
begin
  -- ══════════════════════════════════════════════════════════
  -- 1. precondition（Phase 5B-2F本番監査結果・preflight実測に基づく
  --    事前状態確認。1つでも一致しなければ、以降のDROP/CREATEには
  --    一切進まずここで中断する）
  -- ══════════════════════════════════════════════════════════

  -- 1a. 対象テーブルの存在確認
  select array_agg(t) into v_missing_tables
  from unnest(array['weight_logs','meal_logs','clients','profiles']::text[]) as t
  where not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = t
  );
  if v_missing_tables is not null then
    raise exception 'precondition failed: missing tables: %', v_missing_tables;
  end if;

  -- 1b. Policy式が参照する列の存在確認
  select array_agg(tc) into v_missing_columns
  from (values
    ('profiles','id'), ('profiles','role'), ('profiles','store_id'),
    ('profiles','is_super_admin'), ('profiles','client_id'),
    ('clients','id'), ('clients','store_id'),
    ('weight_logs','id'), ('weight_logs','client_id'),
    ('meal_logs','id'), ('meal_logs','client_id')
  ) as expected(tbl, col)
  cross join lateral (select tbl || '.' || col as tc) x
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = expected.tbl and column_name = expected.col
  );
  if v_missing_columns is not null then
    raise exception 'precondition failed: missing columns: %', v_missing_columns;
  end if;

  -- 1c. roleの存在確認
  select array_agg(r) into v_missing_roles
  from unnest(array['anon','authenticated','service_role']::text[]) as r
  where not exists (select 1 from pg_roles where rolname = r);
  if v_missing_roles is not null then
    raise exception 'precondition failed: missing roles: %', v_missing_roles;
  end if;

  -- 1d. weight_logs/meal_logsのRLSが現在「無効」であり、FORCE RLSも
  --     設定されていないこと（Phase 5B-2F本番監査結果と一致：
  --     rls_enabled=false, force_rls=false）
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('weight_logs','meal_logs')
      and (c.relrowsecurity = true or c.relforcerowsecurity = true)
  ) then
    raise exception 'precondition failed: weight_logs or meal_logs already has RLS enabled or FORCE RLS set (state has drifted since the Phase 5B-2F audit; re-audit before proceeding)';
  end if;

  -- 1e. public.clientsのRLSが現在「有効」であり、FORCE RLSは設定されて
  --     いないこと（Phase 5B-2E適用済みの前提。admin判定サブクエリが
  --     clientsをEXISTSで参照するため、clientsのRLSが無効化されている
  --     状態で本Policyを適用しない）
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'clients'
      and c.relrowsecurity = true and c.relforcerowsecurity = false
  ) then
    raise exception 'precondition failed: public.clients does not currently have RLS enabled without FORCE RLS (expected state after Phase 5B-2E apply)';
  end if;

  -- 1f. public.profilesのRLSが現在「有効」であること（Policyのサブクエリが
  --     依存する前提の確認。各Policyのサブクエリは where p.id = auth.uid()
  --     で明示的に絞り込んでおり、この前提が崩れても行レベルの漏洩には
  --     直結しない）
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'profiles'
      and c.relrowsecurity = true
  ) then
    raise exception 'precondition failed: profiles does not currently have RLS enabled';
  end if;

  -- 1g. 必要なclients Policyが存在すること："clients: admin select"が
  --     Phase 5B-2E本番適用・postcheckで確認済みの定義と完全一致すること
  --     （weight_logs/meal_logsのadmin Policyは、このclients Policy経由で
  --     admin自身がclients.store_idを読み取れることに依存する）。
  v_expected_clients_admin_select_qual := lower(regexp_replace(btrim(
    '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (p.store_id = clients.store_id))))))'
  ), '\s+', ' ', 'g'));

  if not exists (
    select 1
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'clients'
      and p.policyname = 'clients: admin select'
      and p.permissive = 'PERMISSIVE'
      and p.roles = array['authenticated']::name[]
      and p.cmd = 'SELECT'
      and lower(regexp_replace(btrim(coalesce(p.qual, '')), '\s+', ' ', 'g')) = v_expected_clients_admin_select_qual
  ) then
    raise exception 'precondition failed: public.clients is missing the "clients: admin select" policy in the exact form established by the Phase 5B-2E production apply (state may have drifted)';
  end if;

  -- 1h. 必要なprofiles Policyが存在すること：authenticatedが自分自身の
  --     profile行をSELECTできるPolicyが最低1件存在すること（本ファイルの
  --     全Policyが依存する「p.id = auth.uid()」の行可視性の前提）。
  --     このPolicyの具体的なUSING式はPhase 5B-2Fの監査対象外であり、
  --     推測で期待値を固定しないため、cmd/roles/permissiveの存在確認に
  --     留める。
  if not exists (
    select 1
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'profiles'
      and p.permissive = 'PERMISSIVE'
      and p.cmd in ('SELECT', 'ALL')
      and (
        p.roles = array['public']::name[]
        or p.roles = array['authenticated']::name[]
        or 'authenticated' = any(p.roles)
      )
  ) then
    raise exception 'precondition failed: public.profiles has no PERMISSIVE SELECT/ALL policy applicable to authenticated (required for the self-lookup subquery used by the new weight_logs/meal_logs policies)';
  end if;

  -- 1i. 他店舗閲覧用のSECURITY DEFINER RPC2件が存在し、SECURITY DEFINERで、
  --     RLSを安全に迂回できる所有者条件（rolbypassrls、または対象テーブルの
  --     所有者と一致）を満たすこと。条件を推測せず、実際の関数定義
  --     （pg_proc）とテーブル所有者（pg_class.relowner）をpg_catalogで
  --     直接突き合わせて検証する。
  if (
    select count(*) from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_get_other_store_weight_logs'
  ) <> 1 then
    raise exception 'precondition failed: public.admin_get_other_store_weight_logs does not have exactly one overload';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_get_other_store_weight_logs'
      and p.prosecdef = true
      and (
        exists (select 1 from pg_catalog.pg_roles r where r.oid = p.proowner and r.rolbypassrls = true)
        or p.proowner = (select c.relowner from pg_catalog.pg_class c where c.oid = 'public.weight_logs'::regclass)
      )
  ) then
    raise exception 'precondition failed: public.admin_get_other_store_weight_logs is not SECURITY DEFINER with an owner that can safely bypass RLS on public.weight_logs (neither rolbypassrls nor table-owner match)';
  end if;

  if (
    select count(*) from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_get_other_store_meal_logs'
  ) <> 1 then
    raise exception 'precondition failed: public.admin_get_other_store_meal_logs does not have exactly one overload';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_get_other_store_meal_logs'
      and p.prosecdef = true
      and (
        exists (select 1 from pg_catalog.pg_roles r where r.oid = p.proowner and r.rolbypassrls = true)
        or p.proowner = (select c.relowner from pg_catalog.pg_class c where c.oid = 'public.meal_logs'::regclass)
      )
  ) then
    raise exception 'precondition failed: public.admin_get_other_store_meal_logs is not SECURITY DEFINER with an owner that can safely bypass RLS on public.meal_logs (neither rolbypassrls nor table-owner match)';
  end if;

  -- 1j. anonが対象2テーブルへ一切の実効権限を持たないこと（Phase 5B-2F監査で確認済み）
  select array_agg(t || ':' || pr) into v_bad_anon_priv
  from unnest(array['weight_logs','meal_logs']::text[]) as t
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr
  where has_table_privilege('anon', ('public.' || t)::regclass, pr);
  if v_bad_anon_priv is not null then
    raise exception 'precondition failed: anon unexpectedly has privileges: %', v_bad_anon_priv;
  end if;

  -- 1k. authenticatedが対象2テーブルへALL PRIVILEGES相当を持つこと（Phase 5B-2F監査結果）
  select array_agg(t || ':' || pr) into v_bad_auth_priv
  from unnest(array['weight_logs','meal_logs']::text[]) as t
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr
  where not has_table_privilege('authenticated', ('public.' || t)::regclass, pr);
  if v_bad_auth_priv is not null then
    raise exception 'precondition failed: authenticated is missing expected privileges: %', v_bad_auth_priv;
  end if;

  -- 1l. PUBLICが対象2テーブルへ直接ACLを持たないこと（Phase 5B-2F監査結果）
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

  -- 1m. weight_logs/meal_logsのPolicyが、Phase 5B-2F本番監査結果と
  --     policyname/permissive/cmd/roles/USING/WITH CHECKのすべてについて
  --     完全に一致すること。ここではPolicyを一切DROPせず、参照のみで判定する。
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
      into v_actual_permissive, v_actual_roles, v_actual_cmd, v_actual_qual_norm, v_actual_with_check_norm
    from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'weight_logs' and p.policyname = 'weight_logs: client all own';

    raise exception 'precondition failed: weight_logs policy does not match the Phase 5B-2F production audit baseline exactly. policy_count=%, permissive=%, roles=%, cmd=%, qual_normalized=%, with_check_normalized=%',
      v_weight_logs_policy_count, v_actual_permissive, v_actual_roles, v_actual_cmd, v_actual_qual_norm, v_actual_with_check_norm;
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
      into v_actual_permissive, v_actual_roles, v_actual_cmd, v_actual_qual_norm, v_actual_with_check_norm
    from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'meal_logs' and p.policyname = 'meal_logs: client all own';

    raise exception 'precondition failed: meal_logs policy does not match the Phase 5B-2F production audit baseline exactly. policy_count=%, permissive=%, roles=%, cmd=%, qual_normalized=%, with_check_normalized=%',
      v_meal_logs_policy_count, v_actual_permissive, v_actual_roles, v_actual_cmd, v_actual_qual_norm, v_actual_with_check_norm;
  end if;

  -- 1n. NULL client_id件数・孤立参照件数が両テーブルとも0であること
  select count(*) into v_weight_logs_null_client_id from public.weight_logs where client_id is null;
  if v_weight_logs_null_client_id <> 0 then
    raise exception 'precondition failed: public.weight_logs has % row(s) with client_id IS NULL (expected 0)', v_weight_logs_null_client_id;
  end if;

  select count(*) into v_meal_logs_null_client_id from public.meal_logs where client_id is null;
  if v_meal_logs_null_client_id <> 0 then
    raise exception 'precondition failed: public.meal_logs has % row(s) with client_id IS NULL (expected 0)', v_meal_logs_null_client_id;
  end if;

  select count(*) into v_weight_logs_orphan_client_id
  from public.weight_logs w
  where w.client_id is not null and not exists (select 1 from public.clients c where c.id = w.client_id);
  if v_weight_logs_orphan_client_id <> 0 then
    raise exception 'precondition failed: public.weight_logs has % row(s) referencing a nonexistent clients.id (expected 0)', v_weight_logs_orphan_client_id;
  end if;

  select count(*) into v_meal_logs_orphan_client_id
  from public.meal_logs m
  where m.client_id is not null and not exists (select 1 from public.clients c where c.id = m.client_id);
  if v_meal_logs_orphan_client_id <> 0 then
    raise exception 'precondition failed: public.meal_logs has % row(s) referencing a nonexistent clients.id (expected 0)', v_meal_logs_orphan_client_id;
  end if;

  -- 1o. 変更前の行数・service_role権限を記録する（固定値としてハードコードせず、
  --     本トランザクション内でのbefore/after比較にのみ使用する）
  select count(*) into v_before_weight_logs_count from public.weight_logs;
  select count(*) into v_before_meal_logs_count   from public.meal_logs;

  select jsonb_object_agg(pr, has_table_privilege('service_role', 'public.weight_logs'::regclass, pr))
    into v_before_svc_weight_logs_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr;

  select jsonb_object_agg(pr, has_table_privilege('service_role', 'public.meal_logs'::regclass, pr))
    into v_before_svc_meal_logs_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr;

  -- ══════════════════════════════════════════════════════════
  -- 2. 既存Policyの整理（直前のprecondition 1mで、weight_logs/meal_logsとも
  --    "<table>: client all own"の1件だけであることを確認済み）
  -- ══════════════════════════════════════════════════════════
  drop policy if exists "weight_logs: client all own" on public.weight_logs;
  drop policy if exists "meal_logs: client all own"   on public.meal_logs;

  -- ══════════════════════════════════════════════════════════
  -- 3. 新しい12Policyを作成する（Phase 5B-2F policy deparse preflightで
  --    本番実測済みのCREATE POLICY文と同一）
  -- ══════════════════════════════════════════════════════════
  create policy "weight_logs: client select own" on public.weight_logs
    for select
    to authenticated
    using (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'client'
          and p.client_id = weight_logs.client_id
      )
    );

  create policy "weight_logs: client insert own" on public.weight_logs
    for insert
    to authenticated
    with check (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'client'
          and p.client_id = weight_logs.client_id
      )
    );

  create policy "weight_logs: client update own" on public.weight_logs
    for update
    to authenticated
    using (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'client'
          and p.client_id = weight_logs.client_id
      )
    )
    with check (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'client'
          and p.client_id = weight_logs.client_id
      )
    );

  create policy "weight_logs: admin select own store" on public.weight_logs
    for select
    to authenticated
    using (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'admin'
          and (
            coalesce(p.is_super_admin, false) = true
            or (
              p.store_id is not null
              and exists (
                select 1
                from public.clients c
                where c.id = weight_logs.client_id
                  and c.store_id = p.store_id
              )
            )
          )
      )
    );

  create policy "weight_logs: admin insert own store" on public.weight_logs
    for insert
    to authenticated
    with check (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'admin'
          and (
            coalesce(p.is_super_admin, false) = true
            or (
              p.store_id is not null
              and exists (
                select 1
                from public.clients c
                where c.id = weight_logs.client_id
                  and c.store_id = p.store_id
              )
            )
          )
      )
    );

  create policy "weight_logs: admin update own store" on public.weight_logs
    for update
    to authenticated
    using (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'admin'
          and (
            coalesce(p.is_super_admin, false) = true
            or (
              p.store_id is not null
              and exists (
                select 1
                from public.clients c
                where c.id = weight_logs.client_id
                  and c.store_id = p.store_id
              )
            )
          )
      )
    )
    with check (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'admin'
          and (
            coalesce(p.is_super_admin, false) = true
            or (
              p.store_id is not null
              and exists (
                select 1
                from public.clients c
                where c.id = weight_logs.client_id
                  and c.store_id = p.store_id
              )
            )
          )
      )
    );

  create policy "meal_logs: client select own" on public.meal_logs
    for select
    to authenticated
    using (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'client'
          and p.client_id = meal_logs.client_id
      )
    );

  create policy "meal_logs: client insert own" on public.meal_logs
    for insert
    to authenticated
    with check (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'client'
          and p.client_id = meal_logs.client_id
      )
    );

  create policy "meal_logs: client update own" on public.meal_logs
    for update
    to authenticated
    using (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'client'
          and p.client_id = meal_logs.client_id
      )
    )
    with check (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'client'
          and p.client_id = meal_logs.client_id
      )
    );

  create policy "meal_logs: admin select own store" on public.meal_logs
    for select
    to authenticated
    using (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'admin'
          and (
            coalesce(p.is_super_admin, false) = true
            or (
              p.store_id is not null
              and exists (
                select 1
                from public.clients c
                where c.id = meal_logs.client_id
                  and c.store_id = p.store_id
              )
            )
          )
      )
    );

  create policy "meal_logs: admin insert own store" on public.meal_logs
    for insert
    to authenticated
    with check (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'admin'
          and (
            coalesce(p.is_super_admin, false) = true
            or (
              p.store_id is not null
              and exists (
                select 1
                from public.clients c
                where c.id = meal_logs.client_id
                  and c.store_id = p.store_id
              )
            )
          )
      )
    );

  create policy "meal_logs: admin update own store" on public.meal_logs
    for update
    to authenticated
    using (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'admin'
          and (
            coalesce(p.is_super_admin, false) = true
            or (
              p.store_id is not null
              and exists (
                select 1
                from public.clients c
                where c.id = meal_logs.client_id
                  and c.store_id = p.store_id
              )
            )
          )
      )
    )
    with check (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'admin'
          and (
            coalesce(p.is_super_admin, false) = true
            or (
              p.store_id is not null
              and exists (
                select 1
                from public.clients c
                where c.id = meal_logs.client_id
                  and c.store_id = p.store_id
              )
            )
          )
      )
    );

  -- ══════════════════════════════════════════════════════════
  -- 4. GRANT/REVOKE整理（service_role・postgresは一切変更しない）
  -- ══════════════════════════════════════════════════════════
  revoke all privileges on table public.weight_logs from authenticated, anon, public;
  grant select, insert, update on table public.weight_logs to authenticated;

  revoke all privileges on table public.meal_logs from authenticated, anon, public;
  grant select, insert, update on table public.meal_logs to authenticated;

  -- ══════════════════════════════════════════════════════════
  -- 5. RLS有効化（Policy・GRANT整理が完了した直後、同一トランザクション内で実施。
  --    FORCE RLSは設定しない）
  -- ══════════════════════════════════════════════════════════
  alter table public.weight_logs enable row level security;
  alter table public.meal_logs   enable row level security;

  -- ══════════════════════════════════════════════════════════
  -- 6. postcondition（1つでも不成立ならcommitさせない）
  -- ══════════════════════════════════════════════════════════

  -- 6a. RLSが有効化されており、FORCE RLSは設定されていないこと
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('weight_logs','meal_logs')
      and (c.relrowsecurity = false or c.relforcerowsecurity = true)
  ) then
    raise exception 'postcondition failed: weight_logs or meal_logs does not have the intended RLS state (expected rls_enabled=true, force_rls=false) after apply';
  end if;

  -- 6b/6c. weight_logs 6件・meal_logs 6件のPolicyについて、policyname/
  --        permissive/cmd/roles/USING/WITH CHECKのすべてが、本ファイルの
  --        CREATE POLICY文と一致すること（正規化比較）。意図した12件以外の
  --        Policyが存在しないことも同時に確認する。期待値は、Phase 5B-2F
  --        policy deparse preflight（本番実測、必ずROLLBACKする検証専用
  --        トランザクション）でpg_policiesから実際に取得した正規化後
  --        USING/WITH CHECKをそのまま使用する（推測値ではない）。
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
    raise exception 'postcondition failed: one or more policies do not exactly match the intended definition (policyname/permissive/roles/cmd/using/with_check), or unexpected extra policies exist. mismatched=%, extra=%', v_bad_policy_fields, v_extra_policies;
  end if;

  -- 6d. anonが依然として一切の実効権限を持たないこと
  select array_agg(t || ':' || pr) into v_bad_final_anon_priv
  from unnest(array['weight_logs','meal_logs']::text[]) as t
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr
  where has_table_privilege('anon', ('public.' || t)::regclass, pr);
  if v_bad_final_anon_priv is not null then
    raise exception 'postcondition failed: anon unexpectedly has privileges after apply: %', v_bad_final_anon_priv;
  end if;

  -- 6e. PUBLICの直接ACLが両テーブルとも空であること
  if exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    where n.nspname = 'public' and c.relname in ('weight_logs','meal_logs')
      and a.grantee = 0
  ) then
    raise exception 'postcondition failed: PUBLIC still has a direct ACL entry on weight_logs or meal_logs after apply';
  end if;

  -- 6f. authenticatedが両テーブルともSELECT/INSERT/UPDATEのみを持つこと
  --     （DELETE/TRUNCATE/REFERENCES/TRIGGERは不可）
  if not (
    has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'SELECT')
    and has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'INSERT')
    and has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'UPDATE')
    and not has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'DELETE')
    and not has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.weight_logs'::regclass, 'TRIGGER')
  ) then
    raise exception 'postcondition failed: authenticated privileges on weight_logs do not match the intended SELECT/INSERT/UPDATE-only set';
  end if;

  if not (
    has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'SELECT')
    and has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'INSERT')
    and has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'UPDATE')
    and not has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'DELETE')
    and not has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.meal_logs'::regclass, 'TRIGGER')
  ) then
    raise exception 'postcondition failed: authenticated privileges on meal_logs do not match the intended SELECT/INSERT/UPDATE-only set';
  end if;

  -- 6g. service_roleの権限が変更前と完全に一致すること（本ファイルでは一切変更していないはず）
  select jsonb_object_agg(pr, has_table_privilege('service_role', 'public.weight_logs'::regclass, pr))
    into v_after_svc_weight_logs_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr;

  select jsonb_object_agg(pr, has_table_privilege('service_role', 'public.meal_logs'::regclass, pr))
    into v_after_svc_meal_logs_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr;

  if v_after_svc_weight_logs_priv is distinct from v_before_svc_weight_logs_priv then
    raise exception 'postcondition failed: service_role privileges on weight_logs changed unexpectedly';
  end if;
  if v_after_svc_meal_logs_priv is distinct from v_before_svc_meal_logs_priv then
    raise exception 'postcondition failed: service_role privileges on meal_logs changed unexpectedly';
  end if;

  -- 6h. データ行数が変更されていないこと（本ファイルはDDL/GRANTのみで、
  --     DML文を一切含まない。ACCESS EXCLUSIVEロックにより本トランザクション中の
  --     行数変化は起こり得ないため、この比較は構造的に安全に成立する）
  select count(*) into v_after_weight_logs_count from public.weight_logs;
  select count(*) into v_after_meal_logs_count   from public.meal_logs;

  if v_after_weight_logs_count <> v_before_weight_logs_count then
    raise exception 'postcondition failed: weight_logs row count changed during apply (% -> %)', v_before_weight_logs_count, v_after_weight_logs_count;
  end if;
  if v_after_meal_logs_count <> v_before_meal_logs_count then
    raise exception 'postcondition failed: meal_logs row count changed during apply (% -> %)', v_before_meal_logs_count, v_after_meal_logs_count;
  end if;

  -- 6i. NULL client_id件数・孤立参照件数が両テーブルとも依然として0であること
  if (select count(*) from public.weight_logs where client_id is null) <> 0 then
    raise exception 'postcondition failed: public.weight_logs has row(s) with client_id IS NULL after apply';
  end if;
  if (select count(*) from public.meal_logs where client_id is null) <> 0 then
    raise exception 'postcondition failed: public.meal_logs has row(s) with client_id IS NULL after apply';
  end if;
  if exists (
    select 1 from public.weight_logs w
    where w.client_id is not null and not exists (select 1 from public.clients c where c.id = w.client_id)
  ) then
    raise exception 'postcondition failed: public.weight_logs has row(s) referencing a nonexistent clients.id after apply';
  end if;
  if exists (
    select 1 from public.meal_logs m
    where m.client_id is not null and not exists (select 1 from public.clients c where c.id = m.client_id)
  ) then
    raise exception 'postcondition failed: public.meal_logs has row(s) referencing a nonexistent clients.id after apply';
  end if;
end $$;

commit;
