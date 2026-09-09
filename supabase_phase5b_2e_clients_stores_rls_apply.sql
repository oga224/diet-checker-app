-- ============================================================
-- Phase 5B-2E: public.clients / public.stores の恒久的なアクセス制御
-- （RLS有効化＋Policy作成＋GRANT整理）を、同一トランザクション内で
-- 一括して適用する本番SQL。
--
-- 背景：
-- Phase 5B-2Bの本番読み取り専用監査（実行済み）により、
-- clients/customer_number_counters/meal_logs/stores/weight_logsの
-- 5テーブルはRLSが無効であり、authenticatedロールが対象8テーブル
-- 全てにSELECT/INSERT/UPDATE/DELETEに加えTRIGGER/TRUNCATE/REFERENCES
-- まで保持していることが確認された（anonは既にPhase 5B-1Eで遮断済み、
-- 全テーブルでfalseを確認済み）。Phase 5B-2Dのアクセス要件設計を踏まえ、
-- 一度に5テーブルへ手を広げず、まず clients と stores の2テーブルだけを
-- 対象に、「RLS有効化」と「そのテーブルに必要な完全なPolicy作成」を
-- 同一トランザクションで行う（管理者Policyが存在しない状態でRLSだけを
-- 先に有効化する瞬間を作らない）。
--
-- 本ファイルが変更するのは、public.clients / public.stores の
-- Policy・RLS有効フラグ・GRANT/REVOKEのみ。
-- customer_number_counters・next_customer_number・weight_logs・
-- meal_logs・profiles・body_photos・admin_comments・Storage・
-- 他店舗匿名化RPC4関数は一切変更しない
-- （customer_number_countersの権限整理は、next_customer_numberの
-- SECURITY DEFINER化・role/店舗判定追加と同一フェーズで別途行う）。
-- データ行のINSERT/UPDATE/DELETEは一切行わない。
-- 新しいテーブル・関数は作成しない。
--
-- 【Policy設計】
-- clients（5件、いずれもTO authenticated、rowsで判定。NULLをワイルド
-- カードとして許可する条件は一切含まない）：
--   - "clients: client select own"（SELECT）：
--       呼び出し元profileがrole='client'であり、かつそのprofile.client_id
--       がclients.idと一致すること（Phase 5B-2E policy deparse preflightで
--       実測・確定した形。client_id一致だけでなくrole='client'も明示的に
--       要求する）
--   - "clients: admin select"（SELECT）：
--       呼び出し元がrole='admin'かつ
--       （is_super_admin=true　または　store_idが非NULLかつclients.store_idと一致）
--   - "clients: admin insert"（INSERT、WITH CHECKのみ）：SELECTと同一条件
--   - "clients: admin update"（UPDATE、USING/WITH CHECK両方に同一条件）：
--       USINGは更新対象の既存行、WITH CHECKは更新後の新しい行を
--       それぞれ同じ条件で判定するため、非super_adminの管理者は
--       他店舗の行を更新できず、既存行のstore_idを他店舗へ書き換える
--       こともできない。
--   - "clients: admin delete"（DELETE）：SELECTと同一条件
-- stores（1件）：
--   - "stores: admin select"（SELECT、TO authenticated）：
--       呼び出し元がrole='admin'であること（store一致条件なし。
--       店舗選択画面が全店舗のid/name/codeを必要とするため）
--
-- 本ファイルは、clients/storesの現在のPolicy状態について、Supabase上で
-- 実際に取得したPhase 5B-2B本番監査結果（clientsは"clients: client
-- read own"（SELECT、permissive、roles={public}、with_check NULL、
-- USINGは下記の正規化済み期待値）の1件だけ、storesは0件）と
-- policyname/permissive/cmd/roles/USING/WITH CHECKのすべてについて
-- 厳密に一致することをpreconditionで確認する。リポジトリ内のSQL
-- ファイル履歴（supabase_auth_setup.sql等）から推測される状態は
-- 一切前提としない（過去に本番監査結果とリポジトリの食い違いが
-- 判明したため、本番監査結果だけを正とする）。1つでも一致しない
-- 場合は、Policyを一切DROPせずここで中断する。
--
-- USING/WITH CHECKの一致判定は、pg_policies.qual / pg_policies.with_check
-- のテキストを、空白（改行・タブ・連続スペースを単一スペースへ圧縮）と
-- 大文字小文字だけを正規化したうえで比較する
-- （lower(regexp_replace(btrim(coalesce(expr,'')), '\s+', ' ', 'g'))）。
-- 条件式の構造そのものを変える正規化（括弧の除去・語順の入れ替え等）は
-- 行わない。
--
-- 【期待値の性質に関する重要な注意】
-- clients: client read ownのUSING期待値は、Phase 5B-2B本番監査で実際に
-- 取得された値をそのまま正規化して用いている。適用後にpostconditionで
-- 検証する新設5件（clients）+1件（stores）のUSING/WITH CHECK期待値も、
-- 推測値ではなく、Phase 5B-2E policy deparse preflight
-- （supabase_phase5b_2e_policy_deparse_preflight.sql、本番で実行し
-- 必ずROLLBACKする検証専用トランザクション）で、同一のCREATE POLICY文を
-- 実際に本番へ一時作成し、pg_policiesから直接取得した正規化後テキストを
-- そのまま使用している。万が一、今後Postgresのバージョンアップ等で
-- デパース結果が変化し、この期待値と一致しなくなった場合は、
-- postconditionがRAISE EXCEPTIONで実際の正規化後テキストを出力した
-- うえでトランザクション全体を中断する。その場合、データもPolicyも
-- RLS状態もGRANTも一切変更されない（begin/commit1本のトランザクション
-- のため）。
--
-- 【GRANT設計】
-- clients: authenticatedからALL PRIVILEGESを一旦REVOKEし、
--   SELECT/INSERT/UPDATE/DELETEのみを再GRANT（TRIGGER/TRUNCATE/
--   REFERENCESは復元しない）。実際の行アクセス制御はRLS Policyが行う。
-- stores: authenticatedからALL PRIVILEGESを一旦REVOKEし、SELECTのみを
--   再GRANT（INSERT/UPDATE/DELETEはGRANTしない。アプリに書き込み経路が
--   存在しないため）。
-- anon/PUBLICへは両テーブルとも一切GRANTしない（既に無権限のはずだが、
--   念のため明示的にREVOKE ALLを再実行する）。
-- service_role・postgresの権限は一切変更しない
--   （REVOKE/GRANT文のfrom/to句に含めない）。
--
-- 影響の見積り：
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY はACCESS EXCLUSIVEロックを
-- 要求するため、本トランザクション実行中は clients / stores への
-- 全ての読み書き（管理者画面・患者画面のSELECT含む）が一時的に
-- キューイングされる。lock_timeout超過時は変更を行わず自動的に
-- エラー終了する。
-- ============================================================

begin;
set local lock_timeout = '5s';

-- ロック順序はclients→storesで固定する（今後の関連フェーズでも
-- 同一順序を維持し、デッドロックの可能性を構造的に排除する）。
lock table public.clients in access exclusive mode;
lock table public.stores  in access exclusive mode;

do $$
declare
  v_missing_tables   text[];
  v_missing_columns  text[];
  v_missing_roles    text[];
  v_bad_anon_priv    text[];
  v_bad_auth_priv    text[];
  v_before_clients_count      bigint;
  v_before_stores_count       bigint;
  v_before_svc_clients_priv   jsonb;
  v_before_svc_stores_priv    jsonb;
  v_after_clients_count       bigint;
  v_after_stores_count        bigint;
  v_after_svc_clients_priv    jsonb;
  v_after_svc_stores_priv     jsonb;
  v_bad_final_anon_priv       text[];
  v_bad_final_auth_priv       text[];
  v_clients_policy_count      int;
  v_stores_policy_count       int;
  v_clients_baseline_ok       boolean;
  v_bad_public_acl            text[];
  v_actual_using              text;
  v_actual_with_check         text;
  v_actual_permissive         text;
  v_actual_roles              name[];
  v_actual_cmd                text;
  v_bad_policy_fields         text[];
  v_extra_policies            text[];
begin
  -- ══════════════════════════════════════════════════════════
  -- 1. precondition（Phase 5B-2B本番監査結果に基づく事前状態確認）
  -- ══════════════════════════════════════════════════════════

  -- 1a. 対象テーブルの存在確認
  select array_agg(t) into v_missing_tables
  from unnest(array['clients','stores','profiles']::text[]) as t
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
    ('stores','id'), ('stores','name'), ('stores','code')
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

  -- 1d. clients/storesのRLSが現在「無効」であり、FORCE RLSも設定されて
  --     いないこと（Phase 5B-2B確認結果と一致：rls_enabled=false, force_rls=false）
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('clients','stores')
      and (c.relrowsecurity = true or c.relforcerowsecurity = true)
  ) then
    raise exception 'precondition failed: clients or stores already has RLS enabled or FORCE RLS set (state has drifted since the Phase 5B-2B audit; re-audit before proceeding)';
  end if;

  -- 1e. profilesのRLSが現在「有効」であること（本Policyが依存する前提の確認。
  --     ただし各Policyのサブクエリは where p.id = auth.uid() で明示的に
  --     絞り込んでおり、この前提が崩れても行レベルの漏洩には直結しない）
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'profiles'
      and c.relrowsecurity = true
  ) then
    raise exception 'precondition failed: profiles does not currently have RLS enabled';
  end if;

  -- 1f. anonが対象2テーブルへ一切の実効権限を持たないこと（Phase 5B-1E/2Bで確認済み）
  select array_agg(t || ':' || pr) into v_bad_anon_priv
  from unnest(array['clients','stores']::text[]) as t
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr
  where has_table_privilege('anon', ('public.' || t)::regclass, pr);
  if v_bad_anon_priv is not null then
    raise exception 'precondition failed: anon unexpectedly has privileges: %', v_bad_anon_priv;
  end if;

  -- 1g. authenticatedが対象2テーブルへALL PRIVILEGES相当を持つこと（Phase 5B-2B確認結果）
  select array_agg(t || ':' || pr) into v_bad_auth_priv
  from unnest(array['clients','stores']::text[]) as t
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr
  where not has_table_privilege('authenticated', ('public.' || t)::regclass, pr);
  if v_bad_auth_priv is not null then
    raise exception 'precondition failed: authenticated is missing expected privileges: %', v_bad_auth_priv;
  end if;

  -- 1h. PUBLICが対象2テーブルへ直接ACLを持たないこと（Phase 5B-2B確認結果）
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

  -- 1i. clientsのPolicyが、Supabase上で実際に取得したPhase 5B-2B本番監査結果と
  --     policyname/permissive/cmd/roles/USING/WITH CHECKのすべてについて
  --     完全に一致すること。ここではPolicyを一切DROPせず、参照のみで判定する。
  --     1つでも外れていれば、以降のDROP/CREATEには一切進まずここで中断する。
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

    raise exception 'precondition failed: clients policy does not match the Phase 5B-2B production audit baseline exactly. policy_count=%, permissive=%, roles=%, cmd=%, using_normalized=%, with_check_normalized=%',
      v_clients_policy_count, v_actual_permissive, v_actual_roles, v_actual_cmd, v_actual_using, v_actual_with_check;
  end if;

  -- 1j. storesのPolicyが0件であること（Phase 5B-2B本番監査結果）
  select count(*) into v_stores_policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'stores';

  if v_stores_policy_count <> 0 then
    raise exception 'precondition failed: stores unexpectedly has % polic(y/ies) (Phase 5B-2B production audit found zero)', v_stores_policy_count;
  end if;

  -- 1k. 変更前の行数・service_role権限を記録する（固定値としてハードコードせず、
  --     本トランザクション内でのbefore/after比較にのみ使用する）
  select count(*) into v_before_clients_count from public.clients;
  select count(*) into v_before_stores_count  from public.stores;

  select jsonb_object_agg(pr, has_table_privilege('service_role', 'public.clients'::regclass, pr))
    into v_before_svc_clients_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr;

  select jsonb_object_agg(pr, has_table_privilege('service_role', 'public.stores'::regclass, pr))
    into v_before_svc_stores_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr;

  -- ══════════════════════════════════════════════════════════
  -- 2. Policy整理
  -- 直前のprecondition（1i/1j）で、clientsは"clients: client read own"の
  -- 1件だけ、storesは0件であることを確認済みである。ここではその確認済みの
  -- 現行Policyと、これから作成する5件（clients）+1件（stores）の名前だけを
  -- 対象にDROP POLICY IF EXISTSを実行する（IF EXISTSのため、再実行時の
  -- 冪等性のための保険であり、precondition未確認の名前を推測で含めない）。
  -- ══════════════════════════════════════════════════════════
  drop policy if exists "clients: client read own"    on public.clients;
  drop policy if exists "clients: client select own"  on public.clients;
  drop policy if exists "clients: admin select"        on public.clients;
  drop policy if exists "clients: admin insert"        on public.clients;
  drop policy if exists "clients: admin update"        on public.clients;
  drop policy if exists "clients: admin delete"        on public.clients;

  drop policy if exists "stores: admin select" on public.stores;

  -- ══════════════════════════════════════════════════════════
  -- 3. 新しいPolicyを作成する
  -- ══════════════════════════════════════════════════════════
  -- Phase 5B-2E policy deparse preflight（本番実測）で確認済みの形に
  -- 統一する。client_id一致だけでなく、呼び出し元profileがrole='client'
  -- であることも要求する。
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

  -- ══════════════════════════════════════════════════════════
  -- 4. GRANT/REVOKE整理（service_role・postgresは一切変更しない）
  -- ══════════════════════════════════════════════════════════
  revoke all privileges on table public.clients from authenticated, anon, public;
  grant select, insert, update, delete on table public.clients to authenticated;

  revoke all privileges on table public.stores from authenticated, anon, public;
  grant select on table public.stores to authenticated;

  -- ══════════════════════════════════════════════════════════
  -- 5. RLS有効化（Policy・GRANT整理が完了した直後、同一トランザクション内で実施）
  -- ══════════════════════════════════════════════════════════
  alter table public.clients enable row level security;
  alter table public.stores  enable row level security;

  -- ══════════════════════════════════════════════════════════
  -- 6. postcondition（1つでも不成立ならcommitさせない）
  -- ══════════════════════════════════════════════════════════

  -- 6a. RLSが有効化されており、FORCE RLSは設定されていないこと
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('clients','stores')
      and (c.relrowsecurity = false or c.relforcerowsecurity = true)
  ) then
    raise exception 'postcondition failed: clients or stores does not have the intended RLS state (expected rls_enabled=true, force_rls=false) after apply';
  end if;

  -- 6b/6c. clients 5件・stores 1件のPolicyについて、policyname/permissive/
  --        cmd/roles/USING/WITH CHECKのすべてが、本ファイルのCREATE POLICY
  --        文と一致すること（正規化比較）。意図した6件以外のPolicyが存在
  --        しないことも同時に確認する。
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
    raise exception 'postcondition failed: one or more policies do not exactly match the intended definition (policyname/permissive/roles/cmd/using/with_check), or unexpected extra policies exist. mismatched=%, extra=%', v_bad_policy_fields, v_extra_policies;
  end if;

  -- 6d. anonが依然として一切の実効権限を持たないこと
  select array_agg(t || ':' || pr) into v_bad_final_anon_priv
  from unnest(array['clients','stores']::text[]) as t
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
    where n.nspname = 'public' and c.relname in ('clients','stores')
      and a.grantee = 0
  ) then
    raise exception 'postcondition failed: PUBLIC still has a direct ACL entry on clients or stores after apply';
  end if;

  -- 6f. authenticatedがclientsでSELECT/INSERT/UPDATE/DELETEのみ、
  --     storesでSELECTのみを持つこと（TRIGGER/TRUNCATE/REFERENCESを含め、それ以外は不可）
  if not (
    has_table_privilege('authenticated', 'public.clients'::regclass, 'SELECT')
    and has_table_privilege('authenticated', 'public.clients'::regclass, 'INSERT')
    and has_table_privilege('authenticated', 'public.clients'::regclass, 'UPDATE')
    and has_table_privilege('authenticated', 'public.clients'::regclass, 'DELETE')
    and not has_table_privilege('authenticated', 'public.clients'::regclass, 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.clients'::regclass, 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.clients'::regclass, 'TRIGGER')
  ) then
    raise exception 'postcondition failed: authenticated privileges on clients do not match the intended SELECT/INSERT/UPDATE/DELETE-only set';
  end if;

  if not (
    has_table_privilege('authenticated', 'public.stores'::regclass, 'SELECT')
    and not has_table_privilege('authenticated', 'public.stores'::regclass, 'INSERT')
    and not has_table_privilege('authenticated', 'public.stores'::regclass, 'UPDATE')
    and not has_table_privilege('authenticated', 'public.stores'::regclass, 'DELETE')
    and not has_table_privilege('authenticated', 'public.stores'::regclass, 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.stores'::regclass, 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.stores'::regclass, 'TRIGGER')
  ) then
    raise exception 'postcondition failed: authenticated privileges on stores do not match the intended SELECT-only set';
  end if;

  -- 6g. service_roleの権限が変更前と完全に一致すること（本ファイルでは一切変更していないはず）
  select jsonb_object_agg(pr, has_table_privilege('service_role', 'public.clients'::regclass, pr))
    into v_after_svc_clients_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr;

  select jsonb_object_agg(pr, has_table_privilege('service_role', 'public.stores'::regclass, pr))
    into v_after_svc_stores_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr;

  if v_after_svc_clients_priv is distinct from v_before_svc_clients_priv then
    raise exception 'postcondition failed: service_role privileges on clients changed unexpectedly';
  end if;
  if v_after_svc_stores_priv is distinct from v_before_svc_stores_priv then
    raise exception 'postcondition failed: service_role privileges on stores changed unexpectedly';
  end if;

  -- 6h. データ行数が変更されていないこと（本ファイルはDDL/GRANTのみで、
  --     DML文を一切含まない。ACCESS EXCLUSIVEロックにより本トランザクション中の
  --     行数変化は起こり得ないため、この比較は構造的に安全に成立する）
  select count(*) into v_after_clients_count from public.clients;
  select count(*) into v_after_stores_count  from public.stores;

  if v_after_clients_count <> v_before_clients_count then
    raise exception 'postcondition failed: clients row count changed during apply (% -> %)', v_before_clients_count, v_after_clients_count;
  end if;
  if v_after_stores_count <> v_before_stores_count then
    raise exception 'postcondition failed: stores row count changed during apply (% -> %)', v_before_stores_count, v_after_stores_count;
  end if;
end $$;

commit;
