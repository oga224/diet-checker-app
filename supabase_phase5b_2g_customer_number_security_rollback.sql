-- ============================================================
-- ★★★ 危険：Phase 5B-2G適用前（Phase 5B-2G本番監査時点）の、より弱い
-- セキュリティ状態へ public.next_customer_number(text) /
-- public.customer_number_counters を戻す緊急用ファイル。
-- 通常は実行しないこと。 ★★★
--
-- このSQLを実行すると、supabase_phase5b_2g_customer_number_security_apply.sql
-- 適用前の状態、すなわち「next_customer_number(text)がSECURITY INVOKERで
-- 呼び出し元のrole・store_idを一切照合しない」「customer_number_counters
-- のRLSが無効で、authenticatedロール（ログイン済みpatientを含む）が
-- SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGERを無条件に持つ」
-- という、Phase 5B-2Gの本番監査で確認された状態へ戻ります。この状態では、
-- ログイン済みの患者アカウント1つでも、他店舗のstore_codeを渡して
-- next_customer_numberを直接呼び出し、他店舗の採番台帳を進めることが
-- できてしまいます。
--
-- Phase 5B-2G適用が既存の新規顧客登録処理を壊した場合の復旧専用
-- ファイルであり、通常運用では実行しないでください。
--
-- ── 復元の範囲に関する制限事項 ──────────────────────────────
-- 本ファイルが復元するのは、Phase 5B-2G適用SQLが変更した範囲
-- （next_customer_number(text)の定義・customer_number_countersのRLS
-- 有効フラグ・authenticated/anon/PUBLICのGRANT）だけである。anonに
-- ついては、Phase 5B-2G監査時点で既に無権限だったため、本ファイルも
-- anonへは一切の権限を復元しない。
--
-- next_customer_number(text)・customer_number_countersのRLS/GRANT以外
-- （データ行、profiles、stores、clients、weight_logs、meal_logs、
-- 他店舗匿名化RPC4関数、Storage）はこのファイルでは一切変更しない。
-- 新しいテーブル・関数も作成しない。
--
-- 本ファイルは、Phase 5B-2G適用SQLが実際に完了した状態
-- （next_customer_number(text)がSECURITY DEFINER・意図した属性で存在し、
-- customer_number_countersのRLSが有効かつ、authenticated/anon/PUBLICが
-- いずれも直接テーブル権限を持たない状態）であることを事前確認したうえで
-- のみ処理を進める。この状態でなければ（＝Phase 5B-2G適用が完了して
-- いなければ）、誤って実行しても何も変更せずエラー終了する。
--
-- 復元後のnext_customer_number(text)は、supabase_customer_number_unique_fix.sql
-- （27-42行目）に実際に記載されている元の定義をそのまま使用する
-- （推測値ではない）。本文中のテーブル参照は、元の定義が使っていた
-- 表記（customer_number_counters、スキーマ修飾なし）をそのまま維持する
-- （元の定義を「正確に」戻すことを優先し、本ファイル側で修飾を追加・
-- 変更しない）。
--
-- precondition・postconditionが参照するPhase 5B-2G適用SQL側の関数属性
-- （owner/language/security_definer/volatility/strict/leakproof/parallel/
-- identity_arguments/result_type/proconfig/EXECUTE権限）は、いずれも
-- Phase 5B-2G function preflight（本番実測、必ずROLLBACKする検証専用
-- トランザクション）とPhase 5B-2G security apply（本番適用済み）の
-- postconditionで確認済みの実測値をそのまま使用する。
--
-- 変更対象はpublic.next_customer_number(text)の定義とpublic.
-- customer_number_countersのRLS・GRANTのみ。public.profiles /
-- public.storesは関数内部の判定で参照されるが、本ファイルはそれ自体を
-- 変更しない。データ行のINSERT/UPDATE/DELETEは一切行わない。新しい
-- 関数を試験呼び出しすることはなく、実際の顧客番号は生成・取得しない。
-- ============================================================

begin;
set local lock_timeout = '5s';

lock table public.customer_number_counters in access exclusive mode;

do $$
declare
  v_func_oid                    regprocedure;
  v_owner_name                   text;
  v_language_name                text;
  v_prosecdef                    boolean;
  v_provolatile                   "char";
  v_proisstrict                     boolean;
  v_proleakproof                     boolean;
  v_proparallel                       "char";
  v_proconfig                          text[];
  v_identity_arguments                   text;
  v_result_type                            text;
  v_bad_auth_priv                text[];
  v_bad_anon_priv                 text[];
  v_bad_public_acl                text[];
  v_pre_anon_can_execute           boolean;
  v_pre_auth_can_execute           boolean;
  v_pre_svc_can_execute            boolean;
  v_pre_public_direct_execute      boolean;
  v_counters_total                  bigint;
  v_before_service_role_priv         jsonb;
begin
  -- ══════════════════════════════════════════════════════════
  -- precondition（Phase 5B-2G適用が完了した状態であることの確認。
  -- 未完了の場合は「誤実行」とみなし、ここで中断する）
  -- ══════════════════════════════════════════════════════════

  -- customer_number_countersのRLSが現在「有効」であり、FORCE RLSは
  -- 設定されていないこと（2G適用後の想定状態）
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'customer_number_counters'
      and (c.relrowsecurity = false or c.relforcerowsecurity = true)
  ) then
    raise exception 'precondition failed: customer_number_counters does not have the expected post-apply RLS state (rls_enabled=true, force_rls=false); Phase 5B-2G apply does not appear to have completed. Refusing to run this rollback';
  end if;

  -- Policy数=0（2G適用後もPolicyは作成していないため引き続き0のはず）
  if exists (
    select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'customer_number_counters'
  ) then
    raise exception 'precondition failed: customer_number_counters unexpectedly has one or more policies; refusing to run this rollback';
  end if;

  -- authenticated/anonが直接テーブル権限を一切持たないこと（2G適用後の想定状態）
  select array_agg(pr) into v_bad_auth_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr
  where has_table_privilege('authenticated', 'public.customer_number_counters'::regclass, pr);
  if v_bad_auth_priv is not null then
    raise exception 'precondition failed: authenticated unexpectedly has table privilege(s) on customer_number_counters before rollback (expected none, post-apply state): %', v_bad_auth_priv;
  end if;

  select array_agg(pr) into v_bad_anon_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr
  where has_table_privilege('anon', 'public.customer_number_counters'::regclass, pr);
  if v_bad_anon_priv is not null then
    raise exception 'precondition failed: anon unexpectedly has table privilege(s) on customer_number_counters: %', v_bad_anon_priv;
  end if;

  select array_agg(a.privilege_type) into v_bad_public_acl
  from pg_catalog.pg_class c
  cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
  where c.oid = 'public.customer_number_counters'::regclass and a.grantee = 0;
  if v_bad_public_acl is not null then
    raise exception 'precondition failed: PUBLIC unexpectedly has direct ACL entries on customer_number_counters: %', v_bad_public_acl;
  end if;

  -- next_customer_number(text)がPhase 5B-2G適用後の想定属性と完全一致すること
  v_func_oid := pg_catalog.to_regprocedure('public.next_customer_number(text)');
  if v_func_oid is null then
    raise exception 'precondition failed: public.next_customer_number(text) could not be resolved; refusing to run this rollback';
  end if;

  select
    pg_catalog.pg_get_userbyid(p.proowner), l.lanname, p.prosecdef, p.provolatile,
    p.proisstrict, p.proleakproof, p.proparallel, p.proconfig,
    pg_catalog.pg_get_function_identity_arguments(p.oid),
    pg_catalog.pg_get_function_result(p.oid)
    into
    v_owner_name, v_language_name, v_prosecdef, v_provolatile,
    v_proisstrict, v_proleakproof, v_proparallel, v_proconfig,
    v_identity_arguments, v_result_type
  from pg_catalog.pg_proc p
  join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid = v_func_oid::oid;

  if v_owner_name is distinct from 'postgres' then
    raise exception 'precondition failed: next_customer_number(text) owner is not postgres (found %); refusing to run this rollback', v_owner_name;
  end if;
  if v_language_name is distinct from 'plpgsql' then
    raise exception 'precondition failed: next_customer_number(text) language is not plpgsql (found %); refusing to run this rollback', v_language_name;
  end if;
  if v_prosecdef is distinct from true then
    raise exception 'precondition failed: next_customer_number(text) is not SECURITY DEFINER; Phase 5B-2G apply does not appear to have completed. Refusing to run this rollback';
  end if;
  if v_provolatile is distinct from 'v' then
    raise exception 'precondition failed: next_customer_number(text) volatility is not VOLATILE (found %); refusing to run this rollback', v_provolatile;
  end if;
  if v_proisstrict is distinct from false then
    raise exception 'precondition failed: next_customer_number(text) strict flag is not false; refusing to run this rollback';
  end if;
  if v_proleakproof is distinct from false then
    raise exception 'precondition failed: next_customer_number(text) leakproof flag is not false; refusing to run this rollback';
  end if;
  if v_proparallel is distinct from 'u' then
    raise exception 'precondition failed: next_customer_number(text) parallel safety is not UNSAFE (found %); refusing to run this rollback', v_proparallel;
  end if;
  if v_identity_arguments is distinct from 'p_store_code text' then
    raise exception 'precondition failed: next_customer_number(text) identity_arguments is not "p_store_code text" (found %); refusing to run this rollback', v_identity_arguments;
  end if;
  if v_result_type is distinct from 'text' then
    raise exception 'precondition failed: next_customer_number(text) result_type is not "text" (found %); refusing to run this rollback', v_result_type;
  end if;
  if v_proconfig is distinct from array['search_path=""']::text[] then
    raise exception 'precondition failed: next_customer_number(text) proconfig is not [search_path=""] (found %); refusing to run this rollback', v_proconfig;
  end if;

  -- EXECUTE権限：authenticated/service_role=true、anon/PUBLIC=false（2G適用後の想定状態）
  v_pre_auth_can_execute := has_function_privilege('authenticated', v_func_oid::oid, 'EXECUTE');
  v_pre_svc_can_execute  := has_function_privilege('service_role',  v_func_oid::oid, 'EXECUTE');
  v_pre_anon_can_execute := has_function_privilege('anon', v_func_oid::oid, 'EXECUTE');
  select exists (
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid = v_func_oid::oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) into v_pre_public_direct_execute;

  if not v_pre_auth_can_execute or not v_pre_svc_can_execute or v_pre_anon_can_execute or v_pre_public_direct_execute then
    raise exception 'precondition failed: next_customer_number(text) EXECUTE privileges do not match the expected post-apply state (authenticated=%, service_role=%, anon=%, public_direct=%); refusing to run this rollback',
      v_pre_auth_can_execute, v_pre_svc_can_execute, v_pre_anon_can_execute, v_pre_public_direct_execute;
  end if;

  -- 変更前（rollback前＝apply完了後）のservice_role権限・行数を記録する
  select jsonb_object_agg(pr, has_table_privilege('service_role', 'public.customer_number_counters'::regclass, pr))
    into v_before_service_role_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr;

  select count(*) into v_counters_total from public.customer_number_counters;

  perform set_config('phase5b2g_rollback.before_row_count', v_counters_total::text, true);
  perform set_config('phase5b2g_rollback.before_service_role_priv', v_before_service_role_priv::text, true);
end $$;

-- ══════════════════════════════════════════════════════════
-- next_customer_number(text)を、readonly audit・emergency lockdown
-- ファイル（supabase_customer_number_unique_fix.sql 27-42行目）に
-- 実際に記載されている元の定義へ正確に戻す（推測値ではない）。
-- 元の定義はSECURITY句を持たない（＝SECURITY INVOKER）、search_path
-- 指定なし、VOLATILE（デフォルト）であり、本文中のテーブル参照も
-- 元のままスキーマ修飾なしで維持する。
-- ══════════════════════════════════════════════════════════
create or replace function public.next_customer_number(p_store_code text)
returns text
language plpgsql
as $$
declare
  v_next integer;
begin
  insert into customer_number_counters (store_code, last_number)
  values (p_store_code, 1)
  on conflict (store_code)
  do update set last_number = customer_number_counters.last_number + 1
  returning last_number into v_next;

  return p_store_code || '-' || lpad(v_next::text, 5, '0');
end;
$$;

-- ══════════════════════════════════════════════════════════
-- customer_number_countersのRLSを2G監査時点の状態（無効）へ戻す。
-- FORCE RLSはそもそも一度も設定していないため、無効のまま維持される。
-- ══════════════════════════════════════════════════════════
alter table public.customer_number_counters disable row level security;

-- ══════════════════════════════════════════════════════════
-- authenticatedへ2G監査時点のGRANT（7権限すべて）を復元する。
-- anon/PUBLICへは何も付与しない（Phase 5B-1Eの緊急対応を維持する）。
-- service_role・postgresの権限は一切変更しない。
-- ══════════════════════════════════════════════════════════
grant select, insert, update, delete, truncate, references, trigger
  on table public.customer_number_counters to authenticated;

-- ══════════════════════════════════════════════════════════
-- postcondition
-- ══════════════════════════════════════════════════════════
do $$
declare
  v_func_oid                regprocedure;
  v_owner_name                text;
  v_language_name             text;
  v_prosecdef                 boolean;
  v_provolatile                "char";
  v_proconfig                    text[];
  v_bad_auth_priv              text[];
  v_bad_anon_priv               text[];
  v_bad_public_acl              text[];
  v_pre_anon_can_execute         boolean;
  v_pre_auth_can_execute         boolean;
  v_pre_svc_can_execute          boolean;
  v_pre_public_direct_execute    boolean;
  v_after_service_role_priv       jsonb;
  v_before_service_role_priv      jsonb;
  v_after_row_count                bigint;
  v_before_row_count               bigint;
  v_store_code_null_count           bigint;
  v_last_number_null_count          bigint;
  v_store_code_duplicate_count      bigint;
  v_counters_orphan_count           bigint;
begin
  -- RLS=false, FORCE RLS=false
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'customer_number_counters'
      and (c.relrowsecurity = true or c.relforcerowsecurity = true)
  ) then
    raise exception 'postcondition failed: customer_number_counters does not have the intended RLS state (expected rls_enabled=false, force_rls=false) after rollback';
  end if;

  -- Policy数=0
  if exists (
    select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'customer_number_counters'
  ) then
    raise exception 'postcondition failed: customer_number_counters unexpectedly has one or more policies after rollback';
  end if;

  -- authenticatedが7権限すべてtrue
  select array_agg(pr) into v_bad_auth_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr
  where not has_table_privilege('authenticated', 'public.customer_number_counters'::regclass, pr);
  if v_bad_auth_priv is not null then
    raise exception 'postcondition failed: authenticated is missing table privilege(s) on customer_number_counters after rollback: %', v_bad_auth_priv;
  end if;

  -- anonが7権限すべてfalse
  select array_agg(pr) into v_bad_anon_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr
  where has_table_privilege('anon', 'public.customer_number_counters'::regclass, pr);
  if v_bad_anon_priv is not null then
    raise exception 'postcondition failed: anon unexpectedly has table privilege(s) on customer_number_counters after rollback: %', v_bad_anon_priv;
  end if;

  -- PUBLIC直接ACLなし
  select array_agg(a.privilege_type) into v_bad_public_acl
  from pg_catalog.pg_class c
  cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
  where c.oid = 'public.customer_number_counters'::regclass and a.grantee = 0;
  if v_bad_public_acl is not null then
    raise exception 'postcondition failed: PUBLIC unexpectedly has direct ACL entries on customer_number_counters after rollback: %', v_bad_public_acl;
  end if;

  -- next_customer_number(text)が元の定義属性へ戻っていること
  v_func_oid := pg_catalog.to_regprocedure('public.next_customer_number(text)');
  if v_func_oid is null then
    raise exception 'postcondition failed: public.next_customer_number(text) could not be resolved after rollback';
  end if;

  select pg_catalog.pg_get_userbyid(p.proowner), l.lanname, p.prosecdef, p.provolatile, p.proconfig
    into v_owner_name, v_language_name, v_prosecdef, v_provolatile, v_proconfig
  from pg_catalog.pg_proc p
  join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid = v_func_oid::oid;

  if v_owner_name is distinct from 'postgres' then
    raise exception 'postcondition failed: next_customer_number(text) owner is not postgres after rollback (found %)', v_owner_name;
  end if;
  if v_language_name is distinct from 'plpgsql' then
    raise exception 'postcondition failed: next_customer_number(text) language is not plpgsql after rollback (found %)', v_language_name;
  end if;
  if v_prosecdef is distinct from false then
    raise exception 'postcondition failed: next_customer_number(text) is still SECURITY DEFINER after rollback (expected SECURITY INVOKER)';
  end if;
  if v_provolatile is distinct from 'v' then
    raise exception 'postcondition failed: next_customer_number(text) volatility is not VOLATILE after rollback (found %)', v_provolatile;
  end if;
  if v_proconfig is not null and array_length(v_proconfig, 1) > 0 then
    raise exception 'postcondition failed: next_customer_number(text) unexpectedly has a non-empty proconfig after rollback: %', v_proconfig;
  end if;

  -- EXECUTE権限：authenticated/service_role=true、anon/PUBLIC=false（2G監査時点の想定状態を維持）
  v_pre_auth_can_execute := has_function_privilege('authenticated', v_func_oid::oid, 'EXECUTE');
  v_pre_svc_can_execute  := has_function_privilege('service_role',  v_func_oid::oid, 'EXECUTE');
  v_pre_anon_can_execute := has_function_privilege('anon', v_func_oid::oid, 'EXECUTE');
  select exists (
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid = v_func_oid::oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) into v_pre_public_direct_execute;

  if not v_pre_auth_can_execute or not v_pre_svc_can_execute or v_pre_anon_can_execute or v_pre_public_direct_execute then
    raise exception 'postcondition failed: next_customer_number(text) EXECUTE privileges after rollback do not match the intended set (authenticated=%, service_role=%, anon=%, public_direct=%)',
      v_pre_auth_can_execute, v_pre_svc_can_execute, v_pre_anon_can_execute, v_pre_public_direct_execute;
  end if;

  -- service_role権限がrollback前（apply完了後）と完全一致すること
  v_before_service_role_priv := current_setting('phase5b2g_rollback.before_service_role_priv')::jsonb;
  select jsonb_object_agg(pr, has_table_privilege('service_role', 'public.customer_number_counters'::regclass, pr))
    into v_after_service_role_priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']::text[]) as pr;
  if v_after_service_role_priv is distinct from v_before_service_role_priv then
    raise exception 'postcondition failed: service_role privileges on customer_number_counters changed unexpectedly during rollback';
  end if;

  -- 行数が変更されていないこと
  v_before_row_count := current_setting('phase5b2g_rollback.before_row_count')::bigint;
  select count(*) into v_after_row_count from public.customer_number_counters;
  if v_after_row_count <> v_before_row_count then
    raise exception 'postcondition failed: customer_number_counters row count changed during rollback (% -> %)', v_before_row_count, v_after_row_count;
  end if;

  -- データ整合性件数（構造的に不変のはずの項目を再確認）
  select count(*) into v_store_code_null_count from public.customer_number_counters where store_code is null;
  if v_store_code_null_count <> 0 then
    raise exception 'postcondition failed: customer_number_counters has row(s) with store_code IS NULL after rollback';
  end if;

  select count(*) into v_last_number_null_count from public.customer_number_counters where last_number is null;
  if v_last_number_null_count <> 0 then
    raise exception 'postcondition failed: customer_number_counters has row(s) with last_number IS NULL after rollback';
  end if;

  select count(*) into v_store_code_duplicate_count
  from (
    select store_code from public.customer_number_counters
    where store_code is not null
    group by store_code having count(*) > 1
  ) d;
  if v_store_code_duplicate_count <> 0 then
    raise exception 'postcondition failed: customer_number_counters has duplicate store_code group(s) after rollback';
  end if;

  select count(*) into v_counters_orphan_count
  from public.customer_number_counters cn
  where cn.store_code is not null
    and not exists (select 1 from public.stores s where s.code = cn.store_code);
  if v_counters_orphan_count <> 0 then
    raise exception 'postcondition failed: customer_number_counters has row(s) whose store_code has no matching public.stores.code after rollback';
  end if;
end $$;

commit;
