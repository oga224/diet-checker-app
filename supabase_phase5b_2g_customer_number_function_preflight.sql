-- ============================================================
-- Phase 5B-2G function preflight（本番・COMMITしない検証専用）
--
-- 目的：
-- 安全化後の public.next_customer_number(text) を本番トランザクション内で
-- 一時的に CREATE OR REPLACE し、PostgreSQLが実際に受理すること、および
-- pg_catalog（pg_proc・pg_get_functiondef等）へ実際に記録される定義・
-- 属性を実測することだけを目的とする。本トランザクションは必ず
-- ROLLBACKし、一切の変更を確定させない。
--
-- 背景：
-- Phase 5B-2G本番読み取り専用監査
-- （supabase_phase5b_2g_customer_number_readonly_audit.sql の実行結果）と、
-- 追加で実行した集計（last_number_zero_count=1, last_number_negative_count=0,
-- stores_code_null_count=0, normal_admin_store_id_null_count=0,
-- normal_admin_without_usable_store_code_count=0）により、
-- customer_number_counters・next_customer_number(text)・関連するprofiles/
-- storesの現在の本番状態を実測済みである。last_number=0の1件は、まだ
-- 採番されていない店舗の正常な初期値として扱い、データ修正は行わない
-- （本ファイルもデータ修正を一切行わない）。
--
-- 現行のnext_customer_number(text)は、
--   - SECURITY DEFINERではない（INVOKER）
--   - 内部にauth.uid()・role・store_idの照合が一切ない
--   - authenticated全体（ログイン済みpatientを含む）へEXECUTEが許可されて
--     いる（supabase_phase5b_1e_emergency_anon_lockdown.sql 141-147行目で
--     PUBLIC/anonのEXECUTEはREVOKE済みだが、authenticatedへのEXECUTEは
--     意図的に維持されており、この問題自体は未解消のままだったことが
--     同ファイル27-29行目に明記されている）
-- という状態であった。本ファイルは、この関数をSECURITY DEFINER化し、
-- 内部にrole/店舗判定を追加した安全な定義へ置き換えた場合に、
-- PostgreSQLが実際にどう受理・記録するかを実測する（推測での
-- apply/postcheck/rollback期待値は作らない）。
--
-- 【新しい関数の権限判定ロジック】
--   1. auth.role() = 'service_role' の場合：
--      p_store_code が public.stores に実在する場合のみ許可。
--      実在しなければ permission denied。
--   2. service_role以外の場合：
--      - auth.uid() が NULL なら permission denied（未ログイン拒否）
--      - auth.uid() に対応する public.profiles を検索
--      - role が 'admin' 以外なら permission denied
--      - is_super_admin ではない通常adminは store_id が必須（NULLなら
--        permission denied）。通常adminは、自分の store_id に対応する
--        stores.code と p_store_code が完全一致する場合だけ許可。
--      - is_super_admin=true の場合は、p_store_code が public.stores に
--        実在する場合のみ、任意店舗への採番を許可する（現在super_adminは
--        0件だが、既存コードとの将来互換性のため分岐は残す）。
--      - 店舗が存在しない場合・権限が一致しない場合は、いずれも同一の
--        permission denied（SQLSTATE 42501）にまとめ、存在の有無や
--        不一致の理由を呼び出し元へ一切漏らさない。
-- 採番本体（INSERT ... ON CONFLICT DO UPDATEによる原子的な+1、
-- 「store_code-5桁ゼロ埋め」形式での返却）は現行のロジックをそのまま
-- 維持する。search_path = '' を設定するため、テーブル・関数はすべて
-- public. または auth. で完全修飾する。
--
-- 本ファイルが変更するのは next_customer_number(text) の定義のみであり、
-- 必ずROLLBACKするため本番へは何も確定しない。customer_number_countersの
-- RLS・Policy・GRANT/REVOKE、テーブルデータ、profiles・storesその他の
-- テーブル、フロントエンド、Edge Functionは一切変更しない。preflight内で
-- next_customer_number(text)（新旧いずれも）を呼び出すことはない
-- （実際の顧客番号を生成・取得しない）。
-- ============================================================

begin;
set local lock_timeout = '5s';

lock table public.customer_number_counters in access exclusive mode;

do $$
declare
  v_pk_ok                       boolean;
  v_bad_anon_priv                text[];
  v_bad_auth_priv                text[];
  v_bad_public_acl               text[];
  v_func_count                   int;
  v_func_oid                     regprocedure;
  v_owner_name                   text;
  v_language_name                text;
  v_prosecdef                    boolean;
  v_provolatile                  "char";
  v_proconfig                    text[];
  v_counters_total                bigint;
  v_store_code_null_count         bigint;
  v_last_number_null_count        bigint;
  v_last_number_zero_count        bigint;
  v_last_number_negative_count    bigint;
  v_store_code_duplicate_count    bigint;
  v_counters_orphan_count         bigint;
  v_stores_code_null_count        bigint;
  v_normal_admin_store_id_null_count            bigint;
  v_normal_admin_without_usable_store_code_count bigint;
  v_pre_anon_can_execute          boolean;
  v_pre_auth_can_execute          boolean;
  v_pre_svc_can_execute           boolean;
  v_pre_public_direct_execute     boolean;
begin
  -- ══════════════════════════════════════════════════════════
  -- precondition（Phase 5B-2G本番監査結果・追加集計結果と完全一致する
  -- ことを、CREATE OR REPLACE FUNCTIONより前に確認する。1つでも一致
  -- しなければ、関数を一切変更せずここで中断する）
  -- ══════════════════════════════════════════════════════════

  -- 1. public.customer_number_counters が通常テーブルとして存在
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'customer_number_counters' and c.relkind = 'r'
  ) then
    raise exception 'precondition failed: public.customer_number_counters does not exist as an ordinary table';
  end if;

  -- 2. RLS=false, FORCE RLS=false
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'customer_number_counters'
      and (c.relrowsecurity = true or c.relforcerowsecurity = true)
  ) then
    raise exception 'precondition failed: customer_number_counters already has RLS enabled or FORCE RLS set (state has drifted since the Phase 5B-2G audit)';
  end if;

  -- 3. Policy数=0
  if exists (
    select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'customer_number_counters'
  ) then
    raise exception 'precondition failed: customer_number_counters unexpectedly has one or more policies (Phase 5B-2G audit found zero)';
  end if;

  -- 4. store_code text NOT NULL
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customer_number_counters' and column_name = 'store_code'
      and data_type = 'text' and is_nullable = 'NO'
  ) then
    raise exception 'precondition failed: customer_number_counters.store_code is not "text NOT NULL" as expected';
  end if;

  -- 5. last_number integer NOT NULL, default=0
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customer_number_counters' and column_name = 'last_number'
      and data_type = 'integer' and is_nullable = 'NO' and column_default = '0'
  ) then
    raise exception 'precondition failed: customer_number_counters.last_number is not "integer NOT NULL DEFAULT 0" as expected';
  end if;

  -- 6. PRIMARY KEY(store_code)
  select exists (
    select 1
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_attribute a
      on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    where con.conrelid = 'public.customer_number_counters'::regclass
      and con.contype = 'p'
      and array_length(con.conkey, 1) = 1
      and a.attname = 'store_code'
  ) into v_pk_ok;
  if not v_pk_ok then
    raise exception 'precondition failed: customer_number_counters does not have a single-column PRIMARY KEY on store_code';
  end if;

  -- 7. authenticatedが7権限すべてを持つ
  select array_agg(pr) into v_bad_auth_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr
  where not has_table_privilege('authenticated', 'public.customer_number_counters'::regclass, pr);
  if v_bad_auth_priv is not null then
    raise exception 'precondition failed: authenticated is missing table privilege(s) on customer_number_counters: %', v_bad_auth_priv;
  end if;

  -- 8. anonが7権限すべて持たない
  select array_agg(pr) into v_bad_anon_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr
  where has_table_privilege('anon', 'public.customer_number_counters'::regclass, pr);
  if v_bad_anon_priv is not null then
    raise exception 'precondition failed: anon unexpectedly has table privilege(s) on customer_number_counters: %', v_bad_anon_priv;
  end if;

  -- 9. PUBLIC直接ACLなし
  select array_agg(a.privilege_type) into v_bad_public_acl
  from pg_catalog.pg_class c
  cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
  where c.oid = 'public.customer_number_counters'::regclass and a.grantee = 0;
  if v_bad_public_acl is not null then
    raise exception 'precondition failed: PUBLIC unexpectedly has direct ACL entries on customer_number_counters: %', v_bad_public_acl;
  end if;

  -- 10. next_customer_number(text)が正確に1overload
  select count(*) into v_func_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'next_customer_number';
  if v_func_count <> 1 then
    raise exception 'precondition failed: public.next_customer_number does not have exactly one overload (found %)', v_func_count;
  end if;

  v_func_oid := pg_catalog.to_regprocedure('public.next_customer_number(text)');
  if v_func_oid is null then
    raise exception 'precondition failed: public.next_customer_number(text) could not be resolved via to_regprocedure';
  end if;

  select pg_catalog.pg_get_userbyid(p.proowner), l.lanname, p.prosecdef, p.provolatile, p.proconfig
    into v_owner_name, v_language_name, v_prosecdef, v_provolatile, v_proconfig
  from pg_catalog.pg_proc p
  join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid = v_func_oid::oid;

  -- 11. owner=postgres
  if v_owner_name is distinct from 'postgres' then
    raise exception 'precondition failed: public.next_customer_number(text) owner is not "postgres" (found %)', v_owner_name;
  end if;

  -- 12. language=plpgsql
  if v_language_name is distinct from 'plpgsql' then
    raise exception 'precondition failed: public.next_customer_number(text) language is not "plpgsql" (found %)', v_language_name;
  end if;

  -- 13. security_definer=false（現行はINVOKERのはず。安全化前の状態確認）
  if v_prosecdef is distinct from false then
    raise exception 'precondition failed: public.next_customer_number(text) is unexpectedly already SECURITY DEFINER before this preflight';
  end if;

  -- 14. volatility=VOLATILE
  if v_provolatile is distinct from 'v' then
    raise exception 'precondition failed: public.next_customer_number(text) volatility is not VOLATILE (found %)', v_provolatile;
  end if;

  -- 15. proconfigが空でsearch_path指定なし
  if v_proconfig is not null and array_length(v_proconfig, 1) > 0 then
    raise exception 'precondition failed: public.next_customer_number(text) unexpectedly has a non-empty proconfig: %', v_proconfig;
  end if;

  -- 16. authenticated/service_roleはEXECUTE可能
  v_pre_auth_can_execute := has_function_privilege('authenticated', v_func_oid::oid, 'EXECUTE');
  v_pre_svc_can_execute  := has_function_privilege('service_role',  v_func_oid::oid, 'EXECUTE');
  if not v_pre_auth_can_execute then
    raise exception 'precondition failed: authenticated cannot currently EXECUTE public.next_customer_number(text)';
  end if;
  if not v_pre_svc_can_execute then
    raise exception 'precondition failed: service_role cannot currently EXECUTE public.next_customer_number(text)';
  end if;

  -- 17. anon/PUBLICはEXECUTE不可
  v_pre_anon_can_execute := has_function_privilege('anon', v_func_oid::oid, 'EXECUTE');
  if v_pre_anon_can_execute then
    raise exception 'precondition failed: anon unexpectedly can EXECUTE public.next_customer_number(text)';
  end if;

  select exists (
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid = v_func_oid::oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) into v_pre_public_direct_execute;
  if v_pre_public_direct_execute then
    raise exception 'precondition failed: PUBLIC unexpectedly has a direct EXECUTE grant on public.next_customer_number(text)';
  end if;

  -- CREATE OR REPLACE FUNCTION より前に、置換前のEXECUTE権限状態を
  -- トランザクションローカル設定へ退避する（置換後に同一トランザクション
  -- 内で差分を確認するため。true=トランザクション終了時に自動的に破棄される）。
  perform set_config(
    'phase5b2g_preflight.pre_execute_privs',
    jsonb_build_object(
      'anon_can_execute',          v_pre_anon_can_execute,
      'authenticated_can_execute', v_pre_auth_can_execute,
      'service_role_can_execute',  v_pre_svc_can_execute,
      'public_direct_execute',     v_pre_public_direct_execute
    )::text,
    true
  );

  -- 18. customer_number_counters総数=4
  select count(*) into v_counters_total from public.customer_number_counters;
  if v_counters_total <> 4 then
    raise exception 'precondition failed: customer_number_counters row count is not 4 (found %)', v_counters_total;
  end if;

  -- 19. store_code NULL=0
  select count(*) into v_store_code_null_count from public.customer_number_counters where store_code is null;
  if v_store_code_null_count <> 0 then
    raise exception 'precondition failed: customer_number_counters has % row(s) with store_code IS NULL (expected 0)', v_store_code_null_count;
  end if;

  -- 20. last_number NULL=0
  select count(*) into v_last_number_null_count from public.customer_number_counters where last_number is null;
  if v_last_number_null_count <> 0 then
    raise exception 'precondition failed: customer_number_counters has % row(s) with last_number IS NULL (expected 0)', v_last_number_null_count;
  end if;

  -- 21. last_number=0が1件
  select count(*) into v_last_number_zero_count from public.customer_number_counters where last_number = 0;
  if v_last_number_zero_count <> 1 then
    raise exception 'precondition failed: customer_number_counters has % row(s) with last_number = 0 (expected 1)', v_last_number_zero_count;
  end if;

  -- 22. last_number<0が0件
  select count(*) into v_last_number_negative_count from public.customer_number_counters where last_number < 0;
  if v_last_number_negative_count <> 0 then
    raise exception 'precondition failed: customer_number_counters has % row(s) with last_number < 0 (expected 0)', v_last_number_negative_count;
  end if;

  -- 23. store_code重複=0（PRIMARY KEYにより構造的に不可能なはずだが、推測せず実測する）
  select count(*) into v_store_code_duplicate_count
  from (
    select store_code from public.customer_number_counters
    where store_code is not null
    group by store_code having count(*) > 1
  ) d;
  if v_store_code_duplicate_count <> 0 then
    raise exception 'precondition failed: customer_number_counters has % duplicate store_code group(s) (expected 0)', v_store_code_duplicate_count;
  end if;

  -- 24. countersとstoresの不一致=0（store_codeがstores.codeに存在しない行）
  select count(*) into v_counters_orphan_count
  from public.customer_number_counters cn
  where cn.store_code is not null
    and not exists (select 1 from public.stores s where s.code = cn.store_code);
  if v_counters_orphan_count <> 0 then
    raise exception 'precondition failed: customer_number_counters has % row(s) whose store_code has no matching public.stores.code (expected 0)', v_counters_orphan_count;
  end if;

  -- 25. stores.code NULL=0
  select count(*) into v_stores_code_null_count from public.stores where code is null;
  if v_stores_code_null_count <> 0 then
    raise exception 'precondition failed: public.stores has % row(s) with code IS NULL (expected 0)', v_stores_code_null_count;
  end if;

  -- 26. 通常adminのstore_id NULL=0
  select count(*) into v_normal_admin_store_id_null_count
  from public.profiles p
  where p.role = 'admin' and coalesce(p.is_super_admin, false) = false and p.store_id is null;
  if v_normal_admin_store_id_null_count <> 0 then
    raise exception 'precondition failed: % normal admin profile(s) have store_id IS NULL (expected 0)', v_normal_admin_store_id_null_count;
  end if;

  -- 27. 通常adminの店舗参照・店舗コード不備=0（store_idがstoresへ解決できない、
  --     またはcodeがNULL/空のケース。新関数の店舗コード照合ロジックが依存する前提）
  select count(*) into v_normal_admin_without_usable_store_code_count
  from public.profiles p
  where p.role = 'admin' and coalesce(p.is_super_admin, false) = false and p.store_id is not null
    and not exists (
      select 1 from public.stores s
      where s.id = p.store_id and s.code is not null and btrim(s.code) <> ''
    );
  if v_normal_admin_without_usable_store_code_count <> 0 then
    raise exception 'precondition failed: % normal admin profile(s) have a store_id that does not resolve to a usable stores.code (expected 0)', v_normal_admin_without_usable_store_code_count;
  end if;
end $$;

-- ══════════════════════════════════════════════════════════
-- すべてのpreconditionを通過した後にのみ到達する、安全化後の
-- next_customer_number(text)のCREATE OR REPLACE。
-- DOブロックは$$で区切られているため、内部でさらに$$区切りの関数本体を
-- 持つCREATE FUNCTIONを直接ネストできない。そのため、precondition用の
-- DOブロックとは別の、独立したトップレベルDDL文として実行する
-- （同一トランザクション内であることに変わりはない）。
-- ══════════════════════════════════════════════════════════
create or replace function public.next_customer_number(p_store_code text)
returns text
language plpgsql
security definer
volatile
set search_path = ''
as $func$
declare
  v_caller_role          text;
  v_caller_store_id      uuid;
  v_caller_is_super      boolean;
  v_caller_store_code    text;
  v_target_store_exists  boolean;
  v_next                 integer;
begin
  if auth.role() = 'service_role' then
    -- service_role：p_store_codeが実在する店舗の場合のみ許可
    select exists (select 1 from public.stores s where s.code = p_store_code)
      into v_target_store_exists;
    if not v_target_store_exists then
      raise exception 'permission denied' using errcode = '42501';
    end if;
  else
    -- service_role以外：未ログインは拒否
    if auth.uid() is null then
      raise exception 'permission denied' using errcode = '42501';
    end if;

    select p.role, p.store_id, coalesce(p.is_super_admin, false)
      into v_caller_role, v_caller_store_id, v_caller_is_super
    from public.profiles p
    where p.id = auth.uid();

    -- role が admin 以外（client・未登録含む）は拒否
    if v_caller_role is distinct from 'admin' then
      raise exception 'permission denied' using errcode = '42501';
    end if;

    if v_caller_is_super then
      -- super_admin：p_store_codeが実在する店舗の場合のみ、任意店舗を許可
      select exists (select 1 from public.stores s where s.code = p_store_code)
        into v_target_store_exists;
      if not v_target_store_exists then
        raise exception 'permission denied' using errcode = '42501';
      end if;
    else
      -- 通常admin：store_id必須。自店舗のstores.codeとp_store_codeが
      -- 完全一致する場合だけ許可（他店舗のstore_codeは一切受け付けない）。
      if v_caller_store_id is null then
        raise exception 'permission denied' using errcode = '42501';
      end if;

      select s.code into v_caller_store_code
      from public.stores s
      where s.id = v_caller_store_id;

      if v_caller_store_code is null or v_caller_store_code is distinct from p_store_code then
        raise exception 'permission denied' using errcode = '42501';
      end if;
    end if;
  end if;

  -- 採番本体：現行と同一の、store_code単位でアトミックに+1する処理を維持する。
  insert into public.customer_number_counters as cnc (store_code, last_number)
  values (p_store_code, 1)
  on conflict (store_code)
  do update set last_number = cnc.last_number + 1
  returning cnc.last_number into v_next;

  return p_store_code || '-' || lpad(v_next::text, 5, '0');
end;
$func$;

-- ══════════════════════════════════════════════════════════
-- CREATE OR REPLACE FUNCTION直後に、同一トランザクション内でpg_catalogから
-- 実測値を取得する（新しい関数を一切呼び出さない。実際の顧客番号は
-- 生成・取得しない）。
-- ══════════════════════════════════════════════════════════
select
  pg_catalog.pg_get_function_identity_arguments(p.oid)  as identity_arguments,
  pg_catalog.pg_get_function_result(p.oid)               as result_type,
  pg_catalog.pg_get_userbyid(p.proowner)                 as owner,
  l.lanname                                              as language,
  p.prosecdef                                            as security_definer,
  case p.provolatile
    when 'i' then 'IMMUTABLE' when 's' then 'STABLE' when 'v' then 'VOLATILE' else null end
                                                          as volatility,
  p.proisstrict                                          as strict,
  p.proleakproof                                         as leakproof,
  case p.proparallel
    when 's' then 'SAFE' when 'r' then 'RESTRICTED' when 'u' then 'UNSAFE' else null end
                                                          as parallel,
  to_jsonb(coalesce(p.proconfig, array[]::text[]))       as proconfig,
  exists (
    select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg where cfg like 'search_path=%'
  )                                                       as has_explicit_search_path_setting,
  pg_catalog.pg_get_functiondef(p.oid)                    as function_definition_full,
  lower(regexp_replace(btrim(pg_catalog.pg_get_functiondef(p.oid)), '\s+', ' ', 'g'))
                                                          as function_definition_normalized,
  -- 関数所有者がcustomer_number_countersのRLSを迂回できる根拠：
  -- rolbypassrls、またはテーブル所有者との一致のいずれか。
  exists (
    select 1 from pg_catalog.pg_roles r where r.oid = p.proowner and r.rolbypassrls = true
  )                                                       as owner_has_bypassrls,
  (p.proowner = (select c.relowner from pg_catalog.pg_class c where c.oid = 'public.customer_number_counters'::regclass))
                                                          as owner_matches_table_owner,
  (
    exists (select 1 from pg_catalog.pg_roles r where r.oid = p.proowner and r.rolbypassrls = true)
    or p.proowner = (select c.relowner from pg_catalog.pg_class c where c.oid = 'public.customer_number_counters'::regclass)
  )                                                       as owner_can_bypass_counters_rls,
  -- EXECUTE権限がpreflight前後で変化していないこと
  has_function_privilege('anon', p.oid, 'EXECUTE')          as post_anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as post_authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE')  as post_service_role_can_execute,
  exists (
    select 1
    from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where a.grantee = 0 and a.privilege_type = 'EXECUTE'
  )                                                       as post_public_direct_execute,
  (
    jsonb_build_object(
      'anon_can_execute',          has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated_can_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'service_role_can_execute',  has_function_privilege('service_role', p.oid, 'EXECUTE'),
      'public_direct_execute',     exists (
        select 1
        from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'
      )
    ) = current_setting('phase5b2g_preflight.pre_execute_privs')::jsonb
  )                                                       as execute_privileges_unchanged
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
join pg_catalog.pg_language l on l.oid = p.prolang
where n.nspname = 'public' and p.proname = 'next_customer_number';

rollback;
