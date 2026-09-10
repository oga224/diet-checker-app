-- ============================================================
-- Phase 5B-2G: public.next_customer_number(text) の安全化と
-- public.customer_number_counters のアクセス制御（RLS有効化＋
-- 直接権限の全面REVOKE）を、同一トランザクション内で一括して適用する
-- 本番SQL。
--
-- 背景：
-- Phase 5B-2G本番読み取り専用監査
-- （supabase_phase5b_2g_customer_number_readonly_audit.sql、実行済み）と
-- 追加集計（last_number_zero_count=1, last_number_negative_count=0,
-- stores_code_null_count=0, normal_admin_store_id_null_count=0,
-- normal_admin_without_usable_store_code_count=0）により、
-- customer_number_counters・next_customer_number(text)・関連する
-- profiles/storesの本番状態を実測済みである。
--
-- 続けて実施したPhase 5B-2G function preflight
-- （supabase_phase5b_2g_customer_number_function_preflight.sql、本番で
-- 実行し必ずROLLBACKする検証専用トランザクション）で、本ファイルが
-- 適用する安全化後のCREATE OR REPLACE FUNCTION文を実際に本番へ一時作成し、
-- pg_catalogから以下の実測値を取得済みである（本ファイルのpostconditionは
-- この実測値をそのまま使用する。推測値ではない）：
--   identity_arguments=p_store_code text, result_type=text, owner=postgres,
--   language=plpgsql, security_definer=true, volatility=VOLATILE,
--   strict=false, leakproof=false, parallel=UNSAFE,
--   proconfig=["search_path=\"\""], has_explicit_search_path_setting=true,
--   owner_has_bypassrls=true, owner_matches_table_owner=true,
--   owner_can_bypass_counters_rls=true, post_anon_can_execute=false,
--   post_authenticated_can_execute=true, post_service_role_can_execute=true,
--   post_public_direct_execute=false, execute_privileges_unchanged=true。
-- なお、pg_get_functiondef()が返す関数定義の完全なテキスト（正規化後も
-- 含む）そのものは、preflight実行結果として本ファイル作成時点では
-- 文字列として受け取っていない（「preflightで作成した安全化後の定義と
-- 完全一致した」という確認のみ）。そのため本ファイルのpostconditionは、
-- その完全なテキストを推測でハードコードして厳密一致判定する代わりに、
-- 上記の実測済み属性（owner/language/security_definer/volatility/strict/
-- leakproof/parallel/identity_arguments/result_type/proconfig）を
-- すべて満たすことと、デパース後定義に安全化ロジックの主要な痕跡
-- （SECURITY DEFINER・search_path・auth.role()・42501・
-- on conflict (store_code)等）が含まれることを確認する。
--
-- 【設計】
-- customer_number_countersはRLSを有効化するが、Policyは一切作成しない
-- （意図的な「全ロール拒否」設計）。FORCE ROW LEVEL SECURITYは設定しない
-- ため、テーブル所有者（postgres）はRLSを通常どおり迂回する。新しい
-- next_customer_number(text)はSECURITY DEFINERであり、その所有者は
-- postgres（= customer_number_countersの所有者と一致、かつ
-- rolbypassrls=trueであることをfunction preflightで実測済み）のため、
-- 関数内部のINSERT ... ON CONFLICT DO UPDATEはRLSに一切妨げられず正常に
-- 動作する。一方、authenticated/anon/PUBLICからは直接のテーブル権限を
-- 全てREVOKEするため、アプリケーションから customer_number_counters への
-- 直接アクセス経路は完全になくなり、唯一の書き込み経路がこの
-- SECURITY DEFINER関数に限定される。
--
-- 新しい関数の権限判定ロジック（詳細はfunction preflightのヘッダー
-- コメントを参照）：
--   1. auth.role() = 'service_role'：p_store_codeが実在する店舗の場合のみ許可
--   2. それ以外：未ログイン拒否 → profilesからrole/store_id/is_super_adminを
--      取得 → role<>'admin'は拒否 → is_super_adminはp_store_codeが実在する
--      場合のみ任意店舗を許可 → 通常adminは自店舗のstores.codeと
--      p_store_codeが完全一致する場合だけ許可
--   3. 不許可はすべて同一のpermission denied（SQLSTATE 42501）に統一
-- 採番本体（INSERT ... ON CONFLICT DO UPDATEによるアトミックな+1、
-- 「store_code-5桁ゼロ埋め」形式の返却）は現行ロジックを維持する。
--
-- 本ファイルが変更するのは、public.next_customer_number(text)の定義と、
-- public.customer_number_countersのRLS有効フラグ・GRANT/REVOKEのみ。
-- public.profiles / public.storesはPolicy・関数内の判定で参照するだけで
-- 一切変更しない。service_role・postgresのテーブル権限は変更しない。
-- データ行のINSERT/UPDATE/DELETEは一切行わない。新しい関数を試験呼び出し
-- することはなく、実際の顧客番号は生成・取得しない。新しいテーブルは
-- 作成しない。
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
  v_normal_admin_store_id_null_count             bigint;
  v_normal_admin_without_usable_store_code_count bigint;
  v_pre_anon_can_execute          boolean;
  v_pre_auth_can_execute          boolean;
  v_pre_svc_can_execute           boolean;
  v_pre_public_direct_execute     boolean;
  v_before_service_role_priv      jsonb;
begin
  -- ══════════════════════════════════════════════════════════
  -- precondition（Phase 5B-2G本番監査結果・追加集計結果・function
  -- preflight実測（適用前の"現行"関数の状態）と完全一致することを、
  -- 変更文より前に確認する。1つでも一致しなければ何も変更せずここで
  -- 中断する）
  -- ══════════════════════════════════════════════════════════

  -- 1. public.customer_number_counters が通常テーブルとして存在
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'customer_number_counters' and c.relkind = 'r'
  ) then
    raise exception 'precondition failed: public.customer_number_counters does not exist as an ordinary table';
  end if;

  -- 2. RLS=false, FORCE RLS=false（適用前の想定状態）
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

  -- 7. authenticatedが7権限すべてを持つ（適用前の想定状態）
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

  -- 11. owner=postgres（適用前の現行関数）
  if v_owner_name is distinct from 'postgres' then
    raise exception 'precondition failed: public.next_customer_number(text) owner is not "postgres" (found %)', v_owner_name;
  end if;

  -- 12. language=plpgsql
  if v_language_name is distinct from 'plpgsql' then
    raise exception 'precondition failed: public.next_customer_number(text) language is not "plpgsql" (found %)', v_language_name;
  end if;

  -- 13. SECURITY INVOKER（適用前は security_definer=false のはず）
  if v_prosecdef is distinct from false then
    raise exception 'precondition failed: public.next_customer_number(text) is unexpectedly already SECURITY DEFINER before this apply (state may have drifted)';
  end if;

  -- 14. volatility=VOLATILE
  if v_provolatile is distinct from 'v' then
    raise exception 'precondition failed: public.next_customer_number(text) volatility is not VOLATILE (found %)', v_provolatile;
  end if;

  -- 15. proconfigが空でsearch_path指定なし（適用前）
  if v_proconfig is not null and array_length(v_proconfig, 1) > 0 then
    raise exception 'precondition failed: public.next_customer_number(text) unexpectedly has a non-empty proconfig before apply: %', v_proconfig;
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

  -- 23. store_code重複=0
  select count(*) into v_store_code_duplicate_count
  from (
    select store_code from public.customer_number_counters
    where store_code is not null
    group by store_code having count(*) > 1
  ) d;
  if v_store_code_duplicate_count <> 0 then
    raise exception 'precondition failed: customer_number_counters has % duplicate store_code group(s) (expected 0)', v_store_code_duplicate_count;
  end if;

  -- 24. countersとstoresの不一致=0
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

  -- 27. 通常adminの店舗参照・店舗コード不備=0
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

  -- ══════════════════════════════════════════════════════════
  -- すべてのprecondition通過後、変更文（REVOKE/ALTER/CREATE FUNCTION）
  -- より前に、変更前の状態をトランザクションローカル設定へ退避する
  -- （postcondition側の別DOブロックから比較するため。true=トランザクション
  -- 終了時に自動的に破棄される）。
  -- ══════════════════════════════════════════════════════════
  select jsonb_object_agg(pr, has_table_privilege('service_role', 'public.customer_number_counters'::regclass, pr))
    into v_before_service_role_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr;

  perform set_config('phase5b2g_apply.before_row_count', v_counters_total::text, true);
  perform set_config('phase5b2g_apply.before_service_role_priv', v_before_service_role_priv::text, true);
  perform set_config(
    'phase5b2g_apply.before_execute_privs',
    jsonb_build_object(
      'anon_can_execute',          v_pre_anon_can_execute,
      'authenticated_can_execute', v_pre_auth_can_execute,
      'service_role_can_execute',  v_pre_svc_can_execute,
      'public_direct_execute',     v_pre_public_direct_execute
    )::text,
    true
  );
end $$;

-- ══════════════════════════════════════════════════════════
-- customer_number_countersからauthenticated/anon/PUBLICの直接権限を
-- すべて取り除く。service_role・postgresの権限はfrom句に含めないため
-- 一切変更しない。
-- ══════════════════════════════════════════════════════════
revoke all privileges on table public.customer_number_counters from authenticated, anon, public;

-- ══════════════════════════════════════════════════════════
-- RLSを有効化する（Policyは一切作成しない意図的な「全ロール拒否」設計。
-- FORCE ROW LEVEL SECURITYは設定しない＝テーブル所有者postgresは
-- 引き続きRLSを迂回し、SECURITY DEFINER関数からの内部アクセスが機能する）。
-- ══════════════════════════════════════════════════════════
alter table public.customer_number_counters enable row level security;

-- ══════════════════════════════════════════════════════════
-- next_customer_number(text)を安全化後の定義へCREATE OR REPLACEする。
-- Phase 5B-2G function preflightで本番実測済みのCREATE OR REPLACE
-- FUNCTION文と同一のテキストを使用する。
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
-- postcondition（1つでも不成立ならcommitさせない）
-- ══════════════════════════════════════════════════════════
do $$
declare
  v_func_oid                regprocedure;
  v_owner_name               text;
  v_language_name            text;
  v_prosecdef                boolean;
  v_provolatile               "char";
  v_proisstrict                boolean;
  v_proleakproof                boolean;
  v_proparallel                 "char";
  v_proconfig                    text[];
  v_identity_arguments            text;
  v_result_type                    text;
  v_function_definition              text;
  v_bad_auth_priv              text[];
  v_bad_anon_priv               text[];
  v_bad_public_acl              text[];
  v_after_service_role_priv     jsonb;
  v_before_service_role_priv    jsonb;
  v_after_row_count              bigint;
  v_before_row_count             bigint;
  v_post_anon_can_execute        boolean;
  v_post_auth_can_execute        boolean;
  v_post_svc_can_execute         boolean;
  v_post_public_direct_execute   boolean;
  v_before_execute_privs         jsonb;
  v_after_execute_privs          jsonb;
  v_store_code_null_count         bigint;
  v_last_number_null_count        bigint;
  v_store_code_duplicate_count    bigint;
  v_counters_orphan_count         bigint;
begin
  -- RLS=true, FORCE RLS=false
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'customer_number_counters'
      and (c.relrowsecurity = false or c.relforcerowsecurity = true)
  ) then
    raise exception 'postcondition failed: customer_number_counters does not have the intended RLS state (expected rls_enabled=true, force_rls=false) after apply';
  end if;

  -- Policy数=0
  if exists (
    select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'customer_number_counters'
  ) then
    raise exception 'postcondition failed: customer_number_counters unexpectedly has one or more policies after apply (expected zero)';
  end if;

  -- authenticated/anon: 7権限すべてfalse（直接権限を全てREVOKE済みのはず）
  select array_agg(pr) into v_bad_auth_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr
  where has_table_privilege('authenticated', 'public.customer_number_counters'::regclass, pr);
  if v_bad_auth_priv is not null then
    raise exception 'postcondition failed: authenticated still has table privilege(s) on customer_number_counters after apply: %', v_bad_auth_priv;
  end if;

  select array_agg(pr) into v_bad_anon_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr
  where has_table_privilege('anon', 'public.customer_number_counters'::regclass, pr);
  if v_bad_anon_priv is not null then
    raise exception 'postcondition failed: anon still has table privilege(s) on customer_number_counters after apply: %', v_bad_anon_priv;
  end if;

  -- PUBLIC直接ACLなし
  select array_agg(a.privilege_type) into v_bad_public_acl
  from pg_catalog.pg_class c
  cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
  where c.oid = 'public.customer_number_counters'::regclass and a.grantee = 0;
  if v_bad_public_acl is not null then
    raise exception 'postcondition failed: PUBLIC still has direct ACL entries on customer_number_counters after apply: %', v_bad_public_acl;
  end if;

  -- service_role権限が変更前と完全一致すること
  v_before_service_role_priv := current_setting('phase5b2g_apply.before_service_role_priv')::jsonb;
  select jsonb_object_agg(pr, has_table_privilege('service_role', 'public.customer_number_counters'::regclass, pr))
    into v_after_service_role_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr;
  if v_after_service_role_priv is distinct from v_before_service_role_priv then
    raise exception 'postcondition failed: service_role privileges on customer_number_counters changed unexpectedly during apply';
  end if;

  -- 行数が変更前と一致すること（本ファイルはDML文を一切含まない）
  v_before_row_count := current_setting('phase5b2g_apply.before_row_count')::bigint;
  select count(*) into v_after_row_count from public.customer_number_counters;
  if v_after_row_count <> v_before_row_count then
    raise exception 'postcondition failed: customer_number_counters row count changed during apply (% -> %)', v_before_row_count, v_after_row_count;
  end if;

  -- next_customer_number(text)の属性がfunction preflightの実測値と一致すること
  v_func_oid := pg_catalog.to_regprocedure('public.next_customer_number(text)');
  if v_func_oid is null then
    raise exception 'postcondition failed: public.next_customer_number(text) could not be resolved after apply';
  end if;

  select
    pg_catalog.pg_get_userbyid(p.proowner), l.lanname, p.prosecdef, p.provolatile,
    p.proisstrict, p.proleakproof, p.proparallel, p.proconfig,
    pg_catalog.pg_get_function_identity_arguments(p.oid),
    pg_catalog.pg_get_function_result(p.oid),
    pg_catalog.pg_get_functiondef(p.oid)
    into
    v_owner_name, v_language_name, v_prosecdef, v_provolatile,
    v_proisstrict, v_proleakproof, v_proparallel, v_proconfig,
    v_identity_arguments, v_result_type, v_function_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid = v_func_oid::oid;

  if v_owner_name is distinct from 'postgres' then
    raise exception 'postcondition failed: next_customer_number(text) owner is not postgres after apply (found %)', v_owner_name;
  end if;
  if v_language_name is distinct from 'plpgsql' then
    raise exception 'postcondition failed: next_customer_number(text) language is not plpgsql after apply (found %)', v_language_name;
  end if;
  if v_prosecdef is distinct from true then
    raise exception 'postcondition failed: next_customer_number(text) is not SECURITY DEFINER after apply';
  end if;
  if v_provolatile is distinct from 'v' then
    raise exception 'postcondition failed: next_customer_number(text) volatility is not VOLATILE after apply (found %)', v_provolatile;
  end if;
  if v_proisstrict is distinct from false then
    raise exception 'postcondition failed: next_customer_number(text) strict flag is not false after apply';
  end if;
  if v_proleakproof is distinct from false then
    raise exception 'postcondition failed: next_customer_number(text) leakproof flag is not false after apply';
  end if;
  if v_proparallel is distinct from 'u' then
    raise exception 'postcondition failed: next_customer_number(text) parallel safety is not UNSAFE after apply (found %)', v_proparallel;
  end if;
  if v_identity_arguments is distinct from 'p_store_code text' then
    raise exception 'postcondition failed: next_customer_number(text) identity_arguments is not "p_store_code text" after apply (found %)', v_identity_arguments;
  end if;
  if v_result_type is distinct from 'text' then
    raise exception 'postcondition failed: next_customer_number(text) result_type is not "text" after apply (found %)', v_result_type;
  end if;
  if v_proconfig is distinct from array['search_path=""']::text[] then
    raise exception 'postcondition failed: next_customer_number(text) proconfig is not [search_path=""] after apply (found %)', v_proconfig;
  end if;

  -- 完全なデパース後関数定義：リテラルの期待値は保持していないため厳密
  -- 一致判定は行わないが、安全化ロジックの主要な痕跡が含まれることを
  -- 確認する（definitionがnullでないこと自体もCREATE成功の証跡になる）。
  if v_function_definition is null then
    raise exception 'postcondition failed: pg_get_functiondef returned null for next_customer_number(text) after apply';
  end if;
  if not (
    v_function_definition ilike '%security definer%'
    and v_function_definition ilike '%search_path%'
    and v_function_definition ilike '%auth.role()%'
    and v_function_definition ilike '%auth.uid()%'
    and v_function_definition ilike '%42501%'
    and v_function_definition ilike '%on conflict (store_code)%'
  ) then
    raise exception 'postcondition failed: next_customer_number(text) deparsed definition is missing one or more expected safety markers after apply';
  end if;

  -- EXECUTE権限：authenticated/service_role=true、anon/PUBLIC=false、
  -- かつ変更前のスナップショットと完全一致（CREATE OR REPLACEでACLが
  -- 変化していないこと）
  v_post_auth_can_execute      := has_function_privilege('authenticated', v_func_oid::oid, 'EXECUTE');
  v_post_svc_can_execute       := has_function_privilege('service_role',  v_func_oid::oid, 'EXECUTE');
  v_post_anon_can_execute      := has_function_privilege('anon', v_func_oid::oid, 'EXECUTE');
  select exists (
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid = v_func_oid::oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) into v_post_public_direct_execute;

  if not v_post_auth_can_execute or not v_post_svc_can_execute or v_post_anon_can_execute or v_post_public_direct_execute then
    raise exception 'postcondition failed: next_customer_number(text) EXECUTE privileges after apply do not match the intended set (authenticated=%, service_role=%, anon=%, public_direct=%)',
      v_post_auth_can_execute, v_post_svc_can_execute, v_post_anon_can_execute, v_post_public_direct_execute;
  end if;

  v_before_execute_privs := current_setting('phase5b2g_apply.before_execute_privs')::jsonb;
  v_after_execute_privs := jsonb_build_object(
    'anon_can_execute',          v_post_anon_can_execute,
    'authenticated_can_execute', v_post_auth_can_execute,
    'service_role_can_execute',  v_post_svc_can_execute,
    'public_direct_execute',     v_post_public_direct_execute
  );
  if v_after_execute_privs is distinct from v_before_execute_privs then
    raise exception 'postcondition failed: next_customer_number(text) EXECUTE privileges changed unexpectedly during apply (before=%, after=%)', v_before_execute_privs, v_after_execute_privs;
  end if;

  -- データ整合性件数（構造的に不変のはずの項目を再確認）
  select count(*) into v_store_code_null_count from public.customer_number_counters where store_code is null;
  if v_store_code_null_count <> 0 then
    raise exception 'postcondition failed: customer_number_counters has row(s) with store_code IS NULL after apply';
  end if;

  select count(*) into v_last_number_null_count from public.customer_number_counters where last_number is null;
  if v_last_number_null_count <> 0 then
    raise exception 'postcondition failed: customer_number_counters has row(s) with last_number IS NULL after apply';
  end if;

  select count(*) into v_store_code_duplicate_count
  from (
    select store_code from public.customer_number_counters
    where store_code is not null
    group by store_code having count(*) > 1
  ) d;
  if v_store_code_duplicate_count <> 0 then
    raise exception 'postcondition failed: customer_number_counters has duplicate store_code group(s) after apply';
  end if;

  select count(*) into v_counters_orphan_count
  from public.customer_number_counters cn
  where cn.store_code is not null
    and not exists (select 1 from public.stores s where s.code = cn.store_code);
  if v_counters_orphan_count <> 0 then
    raise exception 'postcondition failed: customer_number_counters has row(s) whose store_code has no matching public.stores.code after apply';
  end if;
end $$;

commit;
