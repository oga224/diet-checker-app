-- ============================================================
-- Phase 5B-2F policy deparse preflight（本番・COMMITしない検証専用）
--
-- 目的：
-- Phase 5B-2Fで作成予定の12Policy（weight_logs 6件・meal_logs 6件）を、
-- 本番の public.weight_logs / public.meal_logs 上で実際にCREATE POLICY
-- し、PostgreSQLがpg_policies.qual / pg_policies.with_check へ実際に
-- 出力するデパース後のUSING/WITH CHECK式を取得する。取得した実測値を
-- 確認したのち、本トランザクションは必ずROLLBACKし、一切の変更を
-- 確定させない。
--
-- 背景：
-- Phase 5B-2F本番読み取り専用監査
-- （supabase_phase5b_2f_weight_meal_logs_readonly_audit.sql の実行結果）
-- により、weight_logs / meal_logs は現在それぞれ以下の状態にあることが
-- 実測で確認済み：
--   - RLS=false, FORCE RLS=false
--   - Policyは各テーブル正確に1件、policyname="<table>: client all own"、
--     permissive=PERMISSIVE, roles={public}, cmd=ALL, with_check=NULL、
--     qual = (client_id = ( SELECT profiles.client_id
--              FROM profiles
--             WHERE (profiles.id = auth.uid())))
--   - anonは7権限すべてfalse、authenticated/service_roleは7権限すべて
--     true、PUBLIC直接ACLなし
--   - client_idはuuid・NOT NULL、clients(id)へのFK（ON DELETE CASCADE）、
--     NULL参照0件・孤立参照0件
-- 本ファイルはこの実測値をpreconditionとして要求する。
--
-- 【作成前に確認した現行実装（推測ではなく実ファイルを確認済み）】
-- 1. src/pages/client/ClientRecordPage.jsx（患者自身の記録入力・編集）は
--    profiles.client_id から得た自分のclient_idのみでweight_logs/
--    meal_logsをselect/insert/updateしており、DELETE呼び出しは
--    src/・supabase/functions/のいずれにも存在しない
--    （src/では admin_comments 等の別テーブルに対する .delete() のみ）。
-- 2. src/pages/admin/ClientListPage.jsx は、通常admin（is_super_admin
--    でない）は profile.store_id と一致する自店舗clientsのみを取得し、
--    is_super_admin===true のadminのみ店舗フィルタを外して全店舗へ
--    アクセスしている（コード内コメント「既存どおり全店舗・全情報への
--    直接アクセスを維持する」）。
-- 3. src/lib/otherStoreApi.js が admin_list_other_store_clients /
--    admin_get_other_store_client / admin_get_other_store_weight_logs /
--    admin_get_other_store_meal_logs の4RPC（いずれもSECURITY DEFINER、
--    supabase_other_store_anonymized_rpc.sql 等で定義）を呼び出す唯一の
--    箇所であり、他店舗データへの直接 .from('weight_logs'/'meal_logs')
--    アクセスはこのファイル以外に存在しない。
-- 4. supabase/functions配下（create-patient-user, reset-patient-password,
--    ocr-to-csv）はいずれもweight_logs/meal_logsに書き込まない。
-- 5. 上記1〜4により、今回作成する12Policy（client SELECT/INSERT/UPDATE
--    own、admin SELECT/INSERT/UPDATE own store、DELETE PolicyとFOR ALL
--    Policyは作成しない）は現行実装と整合する。
-- 6. 参考：リポジトリ内 supabase_meal_logs_rls_fix.sql は過去に
--    admin/staff全員へのDELETE許可・非店舗スコープSELECT等を作成した
--    履歴があるが、Phase 5B-2F本番監査の実測は現在それとは異なる
--    単一ALL Policyの状態であり、本ファイルのpreconditionはその
--    実測値（古いファイルの内容ではない）と照合する。
--
-- 本ファイルが変更するのは、public.weight_logs / public.meal_logsの
-- Policyの一時的なDROP/CREATEのみであり、必ずROLLBACKするため本番へは
-- 何も確定しない。RLSのENABLE/DISABLE、GRANT/REVOKE、データ行のINSERT/
-- UPDATE/DELETE、新しいテーブル・関数の作成・変更は一切行わない。
-- COMMITは含まれていない。今回はpreflight（実測専用）であり、
-- apply/postcheck/rollbackファイルはまだ作成・変更しない。
-- ============================================================

begin;
set local lock_timeout = '5s';

-- ロック順序：weight_logs → meal_logs で固定。
lock table public.weight_logs in access exclusive mode;
lock table public.meal_logs   in access exclusive mode;

do $$
declare
  v_weight_logs_policy_count int;
  v_meal_logs_policy_count   int;
  v_weight_logs_baseline_ok  boolean;
  v_meal_logs_baseline_ok    boolean;
  v_actual_permissive        text;
  v_actual_roles             name[];
  v_actual_cmd               text;
  v_actual_qual_norm         text;
  v_actual_with_check_norm   text;
  v_expected_qual_norm       text;
begin
  v_expected_qual_norm := lower(regexp_replace(btrim(
    '(client_id = ( SELECT profiles.client_id
     FROM profiles
    WHERE (profiles.id = auth.uid())))'
  ), '\s+', ' ', 'g'));

  -- ══════════════════════════════════════════════════════════
  -- precondition 1: 両テーブルの存在・relkind・必要列の確認
  -- ══════════════════════════════════════════════════════════
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'weight_logs' and c.relkind = 'r'
  ) then
    raise exception 'precondition failed: public.weight_logs does not exist as an ordinary table';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'meal_logs' and c.relkind = 'r'
  ) then
    raise exception 'precondition failed: public.meal_logs does not exist as an ordinary table';
  end if;

  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'weight_logs' and column_name in ('id', 'client_id')
  ) <> 2 then
    raise exception 'precondition failed: public.weight_logs is missing required column(s) (id, client_id)';
  end if;

  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'meal_logs' and column_name in ('id', 'client_id')
  ) <> 2 then
    raise exception 'precondition failed: public.meal_logs is missing required column(s) (id, client_id)';
  end if;

  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'clients' and column_name in ('id', 'store_id')
  ) <> 2 then
    raise exception 'precondition failed: public.clients is missing required column(s) (id, store_id)';
  end if;

  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name in ('id', 'role', 'client_id', 'store_id', 'is_super_admin')
  ) <> 5 then
    raise exception 'precondition failed: public.profiles is missing required column(s) (id, role, client_id, store_id, is_super_admin)';
  end if;

  -- ══════════════════════════════════════════════════════════
  -- precondition 2: RLS=false, FORCE RLS=false
  -- ══════════════════════════════════════════════════════════
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('weight_logs', 'meal_logs')
      and (c.relrowsecurity = true or c.relforcerowsecurity = true)
  ) then
    raise exception 'precondition failed: weight_logs or meal_logs already has RLS enabled or FORCE RLS set (state has drifted since the Phase 5B-2F audit)';
  end if;

  -- ══════════════════════════════════════════════════════════
  -- precondition 3: 既存Policyが Phase 5B-2F 本番監査の実測値と
  -- 全項目（policyname/permissive/roles/cmd/qual/with_check）完全一致
  -- ══════════════════════════════════════════════════════════
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

  -- ══════════════════════════════════════════════════════════
  -- precondition 4: anon/PUBLIC/authenticated/service_role のACLが
  -- Phase 5B-2F 本番監査の実測値と一致
  -- (anon: 7権限すべてfalse / authenticated・service_role: 7権限すべて
  --  true / PUBLIC直接ACL: 0件)
  -- ══════════════════════════════════════════════════════════
  if exists (
    select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as priv
    where has_table_privilege('anon', 'public.weight_logs', priv)
  ) then
    raise exception 'precondition failed: anon unexpectedly has a table privilege on public.weight_logs (Phase 5B-2F audit found all 7 false)';
  end if;

  if exists (
    select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as priv
    where has_table_privilege('anon', 'public.meal_logs', priv)
  ) then
    raise exception 'precondition failed: anon unexpectedly has a table privilege on public.meal_logs (Phase 5B-2F audit found all 7 false)';
  end if;

  if exists (
    select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as priv
    where not has_table_privilege('authenticated', 'public.weight_logs', priv)
  ) then
    raise exception 'precondition failed: authenticated is missing a table privilege on public.weight_logs (Phase 5B-2F audit found all 7 true)';
  end if;

  if exists (
    select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as priv
    where not has_table_privilege('authenticated', 'public.meal_logs', priv)
  ) then
    raise exception 'precondition failed: authenticated is missing a table privilege on public.meal_logs (Phase 5B-2F audit found all 7 true)';
  end if;

  if exists (
    select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as priv
    where not has_table_privilege('service_role', 'public.weight_logs', priv)
  ) then
    raise exception 'precondition failed: service_role is missing a table privilege on public.weight_logs (Phase 5B-2F audit found all 7 true)';
  end if;

  if exists (
    select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as priv
    where not has_table_privilege('service_role', 'public.meal_logs', priv)
  ) then
    raise exception 'precondition failed: service_role is missing a table privilege on public.meal_logs (Phase 5B-2F audit found all 7 true)';
  end if;

  if exists (
    select 1
    from pg_catalog.aclexplode(coalesce(
      (select c.relacl from pg_catalog.pg_class c where c.oid = 'public.weight_logs'::regclass),
      pg_catalog.acldefault('r', (select c.relowner from pg_catalog.pg_class c where c.oid = 'public.weight_logs'::regclass))
    )) a
    where a.grantee = 0
  ) then
    raise exception 'precondition failed: public.weight_logs unexpectedly has a direct PUBLIC ACL grant (Phase 5B-2F audit found none)';
  end if;

  if exists (
    select 1
    from pg_catalog.aclexplode(coalesce(
      (select c.relacl from pg_catalog.pg_class c where c.oid = 'public.meal_logs'::regclass),
      pg_catalog.acldefault('r', (select c.relowner from pg_catalog.pg_class c where c.oid = 'public.meal_logs'::regclass))
    )) a
    where a.grantee = 0
  ) then
    raise exception 'precondition failed: public.meal_logs unexpectedly has a direct PUBLIC ACL grant (Phase 5B-2F audit found none)';
  end if;

  -- ══════════════════════════════════════════════════════════
  -- 既存2Policyの一時的なDROP（すべてのpreconditionを通過した後のみ到達する）
  -- ══════════════════════════════════════════════════════════
  drop policy if exists "weight_logs: client all own" on public.weight_logs;
  drop policy if exists "meal_logs: client all own"   on public.meal_logs;

  -- ══════════════════════════════════════════════════════════
  -- 新規12Policyの一時的なCREATE（weight_logs 6件・meal_logs 6件）
  -- DELETE PolicyとFOR ALL Policyは作成しない。他店舗adminへの直接
  -- アクセスは許可せず、他店舗閲覧は既存のSECURITY DEFINER匿名化RPC
  -- （admin_get_other_store_weight_logs / admin_get_other_store_meal_logs
  --  等）経由のみとする（本Policyでは意図的に扱わない）。
  -- service_role の権限・GRANT/REVOKEは一切変更しない。
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
end $$;

-- ══════════════════════════════════════════════════════════
-- 実際にpg_policiesへ出力されたUSING/WITH CHECK式を取得する
-- （DOブロックは結果セットを返せないため、DOブロック完了後に通常の
-- SELECTとして取得する。同一トランザクション内のため、直前にCREATE
-- した未コミットのPolicyもここで読み取れる）。個人情報・個別UUID・
-- ログ内容は含まれない（Policy定義のメタデータのみ）。
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
where schemaname = 'public' and tablename in ('weight_logs', 'meal_logs')
order by tablename, cmd, policyname;

rollback;
