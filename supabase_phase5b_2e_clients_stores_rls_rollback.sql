-- ============================================================
-- ★★★ 危険：Phase 5B-2E適用前（Phase 5B-2B監査時点）の、より弱い
-- セキュリティ状態へ public.clients / public.stores を戻す緊急用
-- ファイル。通常は実行しないこと。 ★★★
--
-- このSQLを実行すると、supabase_phase5b_2e_clients_stores_rls_apply.sql
-- 適用前の状態、すなわち「clients / stores のRLSが無効であり、
-- authenticatedロール（ログイン済みの患者・管理者を問わず全員）が
-- 両テーブルへSELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER
-- を無条件に持つ」という、Phase 5B-2Bの本番監査で確認された状態へ
-- 戻ります。この状態では、ログイン済みの患者アカウント1つでも、
-- アプリのUIを経由せずSupabaseのREST APIを直接呼べば、他の患者・
-- 他店舗のclients全行を読み書き・削除できてしまいます。
--
-- Phase 5B-2E適用が既存の管理者画面・患者画面を壊した場合の復旧専用
-- ファイルであり、通常運用では実行しないでください。
--
-- ── 復元の範囲に関する制限事項 ──────────────────────────────
-- 本ファイルが復元するのは、Phase 5B-2E適用SQLが変更した範囲
-- （clients/storesのPolicy・RLS有効フラグ・authenticated/anon/PUBLICの
-- GRANT）だけである。anonについては、Phase 5B-2B監査時点で既に
-- Phase 5B-1Eにより権限が遮断済みだったため、本ファイルもanonへは
-- 一切の権限を復元しない（anonを再度開放するとPhase 5B-1Eの緊急対応
-- 自体を無効化してしまうため）。
--
-- RLS・Policy・GRANT以外（データ行、customer_number_counters、
-- next_customer_number、weight_logs、meal_logs、profiles、
-- body_photos、admin_comments、Storage、他店舗匿名化RPC4関数）は
-- このファイルでは一切変更しない。新しいテーブル・関数も作成しない。
--
-- 本ファイルは、Phase 5B-2E適用SQLが実際に完了した状態
-- （clients/storesのRLSが有効かつ、意図した6件のPolicyが
-- policyname/permissive/cmd/roles/USING/WITH CHECKまで完全に一致して
-- 存在する状態）であることを事前確認したうえでのみ処理を進める。
-- この状態でなければ（＝2E適用が完了していなければ）、誤って実行しても
-- 何も変更せずエラー終了する。
--
-- 復元後のclients Policyは、Supabase上で実際に取得したPhase 5B-2B
-- 本番監査結果（"clients: client read own"、SELECT、roles={public}、
-- with_check NULLの1件だけ。"clients: admin all"というPolicyは
-- 本番に存在しなかったため作成しない）と一致する。この比較に使う
-- USING期待値は、Phase 5B-2B本番監査で実際に取得された正規化後
-- テキストをそのまま用いている（推測値ではない）。
--
-- precondition・postconditionが参照するPhase 5B-2E適用SQL側の6Policy
-- （clients 5件・stores 1件）のUSING/WITH CHECK期待値も、Phase 5B-2E
-- policy deparse preflight（本番実測、必ずROLLBACKする検証専用
-- トランザクション）でpg_policiesから直接取得した正規化後テキストを
-- そのまま使用している。
--
-- 変更対象はpublic.clients / public.storesのPolicy・RLS・GRANTのみ。
-- public.profilesはPolicy判定のためのサブクエリで参照するが、
-- 本ファイルはそれ自体を変更しない。
-- ============================================================

begin;
set local lock_timeout = '5s';

-- ロック順序は適用SQLと同一（clients→stores）。
lock table public.clients in access exclusive mode;
lock table public.stores  in access exclusive mode;

do $$
declare
  v_bad_auth_priv           text[];
  v_bad_anon_priv           text[];
  v_bad_public_acl          text[];
  v_before_clients_count    bigint;
  v_before_stores_count     bigint;
  v_after_clients_count     bigint;
  v_after_stores_count      bigint;
  v_bad_final_auth_priv     text[];
  v_bad_final_anon_priv     text[];
  v_bad_final_public_acl    text[];
  v_before_svc_clients_priv jsonb;
  v_before_svc_stores_priv  jsonb;
  v_after_svc_clients_priv  jsonb;
  v_after_svc_stores_priv   jsonb;
  v_bad_policy_fields       text[];
  v_extra_policies          text[];
  v_clients_policy_count    int;
  v_clients_baseline_ok     boolean;
  v_actual_permissive       text;
  v_actual_roles            name[];
  v_actual_cmd              text;
  v_actual_using            text;
  v_actual_with_check       text;
begin
  -- ══════════════════════════════════════════════════════════
  -- 1. precondition（Phase 5B-2E適用が完了した状態であることの確認。
  --    未完了の場合は「誤実行」とみなし、ここで中断する）
  -- ══════════════════════════════════════════════════════════

  -- 1a. clients/storesのRLSが現在「有効」であり、FORCE RLSは設定されて
  --     いないこと（2E適用後の想定状態）
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('clients','stores')
      and (c.relrowsecurity = false or c.relforcerowsecurity = true)
  ) then
    raise exception 'precondition failed: clients or stores does not have the expected post-apply RLS state (rls_enabled=true, force_rls=false); Phase 5B-2E apply does not appear to have completed. Refusing to run this rollback';
  end if;

  -- 1b. clients 5件・stores 1件のPolicyが、policyname/permissive/cmd/roles/
  --     USING/WITH CHECKのすべてについて、Phase 5B-2E適用SQLの意図した
  --     定義と完全に一致すること（正規化比較）。意図した6件以外のPolicyが
  --     存在しないことも確認する。
  -- 期待値は、Phase 5B-2E policy deparse preflight（本番実測、必ずROLLBACK
  -- する検証専用トランザクション）でpg_policiesから実際に取得した
  -- 正規化後USING/WITH CHECKをそのまま使用する（推測値ではない）。
  with expected_policies (tablename, policyname, permissive, roles, cmd, using_expected, with_check_expected) as (
    values
      ('clients', 'clients: client select own', 'PERMISSIVE', array['authenticated']::name[], 'SELECT',
       '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''client''::text) and (p.client_id = clients.id))))', null::text),
      ('clients', 'clients: admin select', 'PERMISSIVE', array['authenticated']::name[], 'SELECT',
       '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (p.store_id = clients.store_id))))))', null::text),
      ('clients', 'clients: admin insert', 'PERMISSIVE', array['authenticated']::name[], 'INSERT',
       null::text, '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (p.store_id = clients.store_id))))))'),
      ('clients', 'clients: admin update', 'PERMISSIVE', array['authenticated']::name[], 'UPDATE',
       '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (p.store_id = clients.store_id))))))',
       '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (p.store_id = clients.store_id))))))'),
      ('clients', 'clients: admin delete', 'PERMISSIVE', array['authenticated']::name[], 'DELETE',
       '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text) and ((coalesce(p.is_super_admin, false) = true) or ((p.store_id is not null) and (p.store_id = clients.store_id))))))', null::text),
      ('stores', 'stores: admin select', 'PERMISSIVE', array['authenticated']::name[], 'SELECT',
       '(exists ( select 1 from profiles p where ((p.id = auth.uid()) and (p.role = ''admin''::text))))', null::text)
  ),
  actual as (
    select
      p.tablename, p.policyname, p.permissive, p.roles, p.cmd,
      lower(regexp_replace(btrim(coalesce(p.qual, '')), '\s+', ' ', 'g')) as using_norm,
      lower(regexp_replace(btrim(coalesce(p.with_check, '')), '\s+', ' ', 'g')) as with_check_norm
    from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename in ('clients','stores')
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
    raise exception 'precondition failed: the current clients/stores policies do not exactly match the expected post-apply 6-policy set; Phase 5B-2E apply does not appear to have completed as intended. Refusing to run this rollback. mismatched=%, extra=%', v_bad_policy_fields, v_extra_policies;
  end if;

  -- 1c. authenticatedが2E適用後の想定（clientsはSELECT/INSERT/UPDATE/DELETEのみ、
  --     TRUNCATE/REFERENCES/TRIGGERなし。storesはSELECTのみ、
  --     INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGERなし）と一致すること
  select array_agg(chk) into v_bad_auth_priv
  from (
    select 'clients:SELECT'     as chk where not has_table_privilege('authenticated', 'public.clients'::regclass, 'SELECT')
    union all select 'clients:INSERT'     where not has_table_privilege('authenticated', 'public.clients'::regclass, 'INSERT')
    union all select 'clients:UPDATE'     where not has_table_privilege('authenticated', 'public.clients'::regclass, 'UPDATE')
    union all select 'clients:DELETE'     where not has_table_privilege('authenticated', 'public.clients'::regclass, 'DELETE')
    union all select 'clients:TRUNCATE'   where has_table_privilege('authenticated', 'public.clients'::regclass, 'TRUNCATE')
    union all select 'clients:REFERENCES' where has_table_privilege('authenticated', 'public.clients'::regclass, 'REFERENCES')
    union all select 'clients:TRIGGER'    where has_table_privilege('authenticated', 'public.clients'::regclass, 'TRIGGER')
    union all select 'stores:SELECT'      where not has_table_privilege('authenticated', 'public.stores'::regclass, 'SELECT')
    union all select 'stores:INSERT'      where has_table_privilege('authenticated', 'public.stores'::regclass, 'INSERT')
    union all select 'stores:UPDATE'      where has_table_privilege('authenticated', 'public.stores'::regclass, 'UPDATE')
    union all select 'stores:DELETE'      where has_table_privilege('authenticated', 'public.stores'::regclass, 'DELETE')
    union all select 'stores:TRUNCATE'    where has_table_privilege('authenticated', 'public.stores'::regclass, 'TRUNCATE')
    union all select 'stores:REFERENCES'  where has_table_privilege('authenticated', 'public.stores'::regclass, 'REFERENCES')
    union all select 'stores:TRIGGER'     where has_table_privilege('authenticated', 'public.stores'::regclass, 'TRIGGER')
  ) x;
  if v_bad_auth_priv is not null then
    raise exception 'precondition failed: authenticated privileges do not match the expected post-apply state (refusing to run this rollback): %', v_bad_auth_priv;
  end if;

  -- 1d. anonが依然として無権限であること
  select array_agg(t || ':' || pr) into v_bad_anon_priv
  from unnest(array['clients','stores']::text[]) as t
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
    where n.nspname = 'public' and c.relname in ('clients','stores')
      and a.grantee = 0
  ) x;
  if v_bad_public_acl is not null then
    raise exception 'precondition failed: PUBLIC unexpectedly has a direct ACL entry on: %', v_bad_public_acl;
  end if;

  -- 1f. 変更前のservice_role権限・行数を記録する（本トランザクション内での
  --     before/after比較にのみ使用し、固定値としてハードコードしない）
  select jsonb_object_agg(pr, has_table_privilege('service_role', 'public.clients'::regclass, pr))
    into v_before_svc_clients_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr;

  select jsonb_object_agg(pr, has_table_privilege('service_role', 'public.stores'::regclass, pr))
    into v_before_svc_stores_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr;

  select count(*) into v_before_clients_count from public.clients;
  select count(*) into v_before_stores_count  from public.stores;

  -- ══════════════════════════════════════════════════════════
  -- 2. Policyを2B監査時点の状態へ戻す
  -- ══════════════════════════════════════════════════════════
  drop policy if exists "clients: client select own" on public.clients;
  drop policy if exists "clients: admin select"        on public.clients;
  drop policy if exists "clients: admin insert"        on public.clients;
  drop policy if exists "clients: admin update"        on public.clients;
  drop policy if exists "clients: admin delete"        on public.clients;
  drop policy if exists "stores: admin select"          on public.stores;

  -- Phase 5B-2B本番監査で実際に確認された定義に一致させる（Supabase上で
  -- 取得した監査結果を正とし、リポジトリ内SQLファイルの履歴からの推測は
  -- 使用しない）。本番監査時点、clientsのPolicyは"clients: client read
  -- own"（SELECT、roles={public}、with_check NULL）の1件だけであり、
  -- "clients: admin all"というPolicyは存在しなかったため、本ファイルでも
  -- 作成しない。
  create policy "clients: client read own" on public.clients
    for select using (
      id = (select client_id from public.profiles where profiles.id = auth.uid())
    );

  -- storesは2B監査時点でPolicyが存在しなかったため、何も作成しない。

  -- ══════════════════════════════════════════════════════════
  -- 3. GRANTを2B監査時点の状態へ戻す（authenticatedにALL PRIVILEGESを復元）
  -- ══════════════════════════════════════════════════════════
  grant select, insert, update, delete, truncate, references, trigger
    on table public.clients to authenticated;
  grant select, insert, update, delete, truncate, references, trigger
    on table public.stores to authenticated;

  -- anon/PUBLICへは何も付与しない（Phase 5B-1Eの緊急対応を維持する）。

  -- ══════════════════════════════════════════════════════════
  -- 4. RLSを2B監査時点の状態（無効）へ戻す
  -- ══════════════════════════════════════════════════════════
  alter table public.clients disable row level security;
  alter table public.stores  disable row level security;

  -- ══════════════════════════════════════════════════════════
  -- 5. postcondition
  -- ══════════════════════════════════════════════════════════

  -- 5a. RLSが無効化されており、FORCE RLSも設定されていないこと
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('clients','stores')
      and (c.relrowsecurity = true or c.relforcerowsecurity = true)
  ) then
    raise exception 'postcondition failed: clients or stores does not have the intended RLS state (expected rls_enabled=false, force_rls=false) after rollback';
  end if;

  -- 5b. clientsのPolicyが正確に1件、Phase 5B-2B本番監査結果と
  --     policyname/permissive/cmd/roles/USING/WITH CHECKのすべてで一致すること
  select count(*) into v_clients_policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'clients';

  select exists (
    select 1
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'clients'
      and p.policyname = 'clients: client read own'
      and p.permissive = 'PERMISSIVE'
      and p.roles = array['public']::name[]
      and p.cmd = 'SELECT'
      and lower(regexp_replace(btrim(coalesce(p.qual, '')), '\s+', ' ', 'g'))
          = lower(regexp_replace(btrim(
              '(id = ( select profiles.client_id from profiles where (profiles.id = auth.uid())))'
            ), '\s+', ' ', 'g'))
      and p.with_check is null
  ) into v_clients_baseline_ok;

  if v_clients_policy_count <> 1 or not v_clients_baseline_ok then
    select p.permissive, p.roles, p.cmd,
           lower(regexp_replace(btrim(coalesce(p.qual, '')), '\s+', ' ', 'g')),
           lower(regexp_replace(btrim(coalesce(p.with_check, '')), '\s+', ' ', 'g'))
      into v_actual_permissive, v_actual_roles, v_actual_cmd, v_actual_using, v_actual_with_check
    from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'clients' and p.policyname = 'clients: client read own';

    raise exception 'postcondition failed: restored clients policy does not match the Phase 5B-2B production audit baseline exactly. policy_count=%, permissive=%, roles=%, cmd=%, using_normalized=%, with_check_normalized=%',
      v_clients_policy_count, v_actual_permissive, v_actual_roles, v_actual_cmd, v_actual_using, v_actual_with_check;
  end if;

  -- 5c. storesのPolicyが0件であること
  if exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'stores') then
    raise exception 'postcondition failed: stores unexpectedly has one or more policies after rollback';
  end if;

  -- 5d. authenticatedがclients/storesともALL PRIVILEGES相当（7権限すべてtrue）を持つこと
  select array_agg(chk) into v_bad_final_auth_priv
  from (
    select 'clients:SELECT'    as chk where not has_table_privilege('authenticated', 'public.clients'::regclass, 'SELECT')
    union all select 'clients:INSERT'    where not has_table_privilege('authenticated', 'public.clients'::regclass, 'INSERT')
    union all select 'clients:UPDATE'    where not has_table_privilege('authenticated', 'public.clients'::regclass, 'UPDATE')
    union all select 'clients:DELETE'    where not has_table_privilege('authenticated', 'public.clients'::regclass, 'DELETE')
    union all select 'clients:TRUNCATE'  where not has_table_privilege('authenticated', 'public.clients'::regclass, 'TRUNCATE')
    union all select 'clients:REFERENCES' where not has_table_privilege('authenticated', 'public.clients'::regclass, 'REFERENCES')
    union all select 'clients:TRIGGER'   where not has_table_privilege('authenticated', 'public.clients'::regclass, 'TRIGGER')
    union all select 'stores:SELECT'     where not has_table_privilege('authenticated', 'public.stores'::regclass, 'SELECT')
    union all select 'stores:INSERT'     where not has_table_privilege('authenticated', 'public.stores'::regclass, 'INSERT')
    union all select 'stores:UPDATE'     where not has_table_privilege('authenticated', 'public.stores'::regclass, 'UPDATE')
    union all select 'stores:DELETE'     where not has_table_privilege('authenticated', 'public.stores'::regclass, 'DELETE')
    union all select 'stores:TRUNCATE'   where not has_table_privilege('authenticated', 'public.stores'::regclass, 'TRUNCATE')
    union all select 'stores:REFERENCES' where not has_table_privilege('authenticated', 'public.stores'::regclass, 'REFERENCES')
    union all select 'stores:TRIGGER'    where not has_table_privilege('authenticated', 'public.stores'::regclass, 'TRIGGER')
  ) x;
  if v_bad_final_auth_priv is not null then
    raise exception 'postcondition failed: authenticated privileges do not match the Phase 5B-2B baseline (ALL PRIVILEGES expected): %', v_bad_final_auth_priv;
  end if;

  -- 5e. anonが依然として無権限であること
  select array_agg(t || ':' || pr) into v_bad_final_anon_priv
  from unnest(array['clients','stores']::text[]) as t
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr
  where has_table_privilege('anon', ('public.' || t)::regclass, pr);
  if v_bad_final_anon_priv is not null then
    raise exception 'postcondition failed: anon unexpectedly has privileges after rollback: %', v_bad_final_anon_priv;
  end if;

  -- 5f. PUBLICが依然として直接ACLを持たないこと
  select array_agg(t) into v_bad_final_public_acl
  from (
    select c.relname as t
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    where n.nspname = 'public' and c.relname in ('clients','stores')
      and a.grantee = 0
  ) x;
  if v_bad_final_public_acl is not null then
    raise exception 'postcondition failed: PUBLIC unexpectedly has a direct ACL entry on clients or stores after rollback: %', v_bad_final_public_acl;
  end if;

  -- 5g. service_roleの権限がrollback前と完全に一致すること（本ファイルでは一切変更していないはず）
  select jsonb_object_agg(pr, has_table_privilege('service_role', 'public.clients'::regclass, pr))
    into v_after_svc_clients_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr;

  select jsonb_object_agg(pr, has_table_privilege('service_role', 'public.stores'::regclass, pr))
    into v_after_svc_stores_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr;

  if v_after_svc_clients_priv is distinct from v_before_svc_clients_priv then
    raise exception 'postcondition failed: service_role privileges on clients changed unexpectedly during rollback';
  end if;
  if v_after_svc_stores_priv is distinct from v_before_svc_stores_priv then
    raise exception 'postcondition failed: service_role privileges on stores changed unexpectedly during rollback';
  end if;

  -- 5h. データ行数が変更されていないこと
  select count(*) into v_after_clients_count from public.clients;
  select count(*) into v_after_stores_count  from public.stores;
  if v_after_clients_count <> v_before_clients_count then
    raise exception 'postcondition failed: clients row count changed during rollback (% -> %)', v_before_clients_count, v_after_clients_count;
  end if;
  if v_after_stores_count <> v_before_stores_count then
    raise exception 'postcondition failed: stores row count changed during rollback (% -> %)', v_before_stores_count, v_after_stores_count;
  end if;
end $$;

commit;
