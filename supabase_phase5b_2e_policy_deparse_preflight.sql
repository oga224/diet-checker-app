-- ============================================================
-- Phase 5B-2E policy deparse preflight（本番・COMMITしない検証専用）
--
-- 目的：
-- Phase 5B-2Eで作成予定の6Policy（clients 5件・stores 1件）を、本番の
-- public.clients / public.stores 上で実際にCREATE POLICYし、
-- PostgreSQLがpg_policies.qual / pg_policies.with_check へ実際に出力する
-- デパース後のUSING/WITH CHECK式を取得する。取得した実測値を確認した
-- のち、本トランザクションは必ずROLLBACKし、一切の変更を確定させない。
--
-- 背景：
-- Phase 5B-2E適用SQL・rollback SQLに記載していた新設6Policyの
-- USING/WITH CHECK期待値は、CREATE POLICY文の記載そのものを正規化した
-- 推測値であり、PostgreSQLの実際のデパース結果（括弧の追加・
-- スキーマ修飾・型キャスト等）と一致する保証がなかった。また、
-- 既存"clients: client read own"の期待値についても、Phase 5B-2B本番
-- 監査の実測値
-- 「(id = ( select profiles.client_id from profiles where (profiles.id = auth.uid())))」
-- と、これまでのapplyの期待値
-- 「id = ( select p.client_id from public.profiles p where p.id = auth.uid() )」
-- （外側の括弧・public.のスキーマ修飾・WHERE条件の括弧が異なる）との
-- 不一致が判明した。期待値をこれ以上推測で修正することを避けるため、
-- 本ファイルで実測する。
--
-- 本ファイルが変更するのは、public.clients / public.stores のPolicyの
-- 一時的なDROP/CREATEのみであり、必ずROLLBACKするため本番へは何も
-- 確定しない。RLSのENABLE/DISABLE、GRANT/REVOKE、データ行のINSERT/
-- UPDATE/DELETE、新しいテーブル・関数の作成は一切行わない。
-- COMMITは含まれていない。
--
-- 【新しい患者用Policyについて】
-- "clients: client select own"は、これまでのclient_id一致だけの条件から、
-- 呼び出し元profileがrole='client'であることも要求する形へ変更している
-- （下記CREATE POLICY文を参照）。他の5件（admin select/insert/update/
-- delete、stores: admin select）は、これまでの設計から変更していない。
-- 本ファイルはpreflight（実測専用）であり、既存のapply/postcheck/
-- rollbackファイルはまだ変更しない。
-- ============================================================

begin;
set local lock_timeout = '5s';

-- ロック順序はapply/rollbackと同一（clients→stores）。
lock table public.clients in access exclusive mode;
lock table public.stores  in access exclusive mode;

do $$
declare
  v_clients_policy_count int;
  v_stores_policy_count  int;
  v_baseline_ok           boolean;
  v_actual_permissive     text;
  v_actual_roles          name[];
  v_actual_cmd            text;
  v_actual_qual_norm      text;
  v_actual_with_check_norm text;
begin
  -- ══════════════════════════════════════════════════════════
  -- precondition（Phase 5B-2B本番監査結果と完全一致することの確認。
  -- 1つでも外れていれば、Policyを一切DROPせずここで中断する）
  -- ══════════════════════════════════════════════════════════

  -- clients/storesのRLSが無効、FORCE RLSも設定されていないこと
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('clients','stores')
      and (c.relrowsecurity = true or c.relforcerowsecurity = true)
  ) then
    raise exception 'precondition failed: clients or stores already has RLS enabled or FORCE RLS set (state has drifted since the Phase 5B-2B audit)';
  end if;

  -- clientsのPolicyが正確に1件、Phase 5B-2B本番監査で実際に取得された
  -- 値と完全に一致すること（policyname/permissive/roles/cmd/qual/with_check）。
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
  ) into v_baseline_ok;

  if v_clients_policy_count <> 1 or not v_baseline_ok then
    select p.permissive, p.roles, p.cmd,
           lower(regexp_replace(btrim(coalesce(p.qual, '')), '\s+', ' ', 'g')),
           lower(regexp_replace(btrim(coalesce(p.with_check, '')), '\s+', ' ', 'g'))
      into v_actual_permissive, v_actual_roles, v_actual_cmd, v_actual_qual_norm, v_actual_with_check_norm
    from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'clients' and p.policyname = 'clients: client read own';

    raise exception 'precondition failed: clients policy does not match the Phase 5B-2B production audit baseline exactly. policy_count=%, permissive=%, roles=%, cmd=%, qual_normalized=%, with_check_normalized=%',
      v_clients_policy_count, v_actual_permissive, v_actual_roles, v_actual_cmd, v_actual_qual_norm, v_actual_with_check_norm;
  end if;

  -- storesのPolicyが0件であること
  select count(*) into v_stores_policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'stores';

  if v_stores_policy_count <> 0 then
    raise exception 'precondition failed: stores unexpectedly has % polic(y/ies) (Phase 5B-2B production audit found zero)', v_stores_policy_count;
  end if;

  -- ══════════════════════════════════════════════════════════
  -- 既存clients Policyの一時的なDROP（precondition通過後のみ到達する）
  -- ══════════════════════════════════════════════════════════
  drop policy if exists "clients: client read own"    on public.clients;
  drop policy if exists "clients: client select own"  on public.clients;
  drop policy if exists "clients: admin select"        on public.clients;
  drop policy if exists "clients: admin insert"        on public.clients;
  drop policy if exists "clients: admin update"        on public.clients;
  drop policy if exists "clients: admin delete"        on public.clients;
  drop policy if exists "stores: admin select"          on public.stores;

  -- ══════════════════════════════════════════════════════════
  -- 新規6Policyの一時的なCREATE
  -- ══════════════════════════════════════════════════════════

  -- "clients: client select own"：client_id一致に加え、呼び出し元profileが
  -- role='client'であることも要求する新しい形。
  create policy "clients: client select own" on public.clients
    for select
    to authenticated
    using (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'client'
          and p.client_id = clients.id
      )
    );

  create policy "clients: admin select" on public.clients
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
            or (p.store_id is not null and p.store_id = clients.store_id)
          )
      )
    );

  create policy "clients: admin insert" on public.clients
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
            or (p.store_id is not null and p.store_id = clients.store_id)
          )
      )
    );

  create policy "clients: admin update" on public.clients
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
            or (p.store_id is not null and p.store_id = clients.store_id)
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
            or (p.store_id is not null and p.store_id = clients.store_id)
          )
      )
    );

  create policy "clients: admin delete" on public.clients
    for delete
    to authenticated
    using (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'admin'
          and (
            coalesce(p.is_super_admin, false) = true
            or (p.store_id is not null and p.store_id = clients.store_id)
          )
      )
    );

  create policy "stores: admin select" on public.stores
    for select
    to authenticated
    using (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'admin'
      )
    );
end $$;

-- ══════════════════════════════════════════════════════════
-- 実際にpg_policiesへ出力されたUSING/WITH CHECK式を取得する
-- （DOブロックは結果セットを返せないため、DOブロック完了後に
-- 通常のSELECTとして取得する。同一トランザクション内のため、
-- 直前にCREATEした未コミットのPolicyもここで読み取れる）
-- ══════════════════════════════════════════════════════════
select
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check,
  lower(regexp_replace(btrim(coalesce(qual, '')), '\s+', ' ', 'g')) as qual_normalized,
  lower(regexp_replace(btrim(coalesce(with_check, '')), '\s+', ' ', 'g')) as with_check_normalized
from pg_catalog.pg_policies
where schemaname = 'public' and tablename in ('clients','stores')
order by tablename, cmd, policyname;

rollback;
