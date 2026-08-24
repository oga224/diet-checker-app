-- ============================================================
-- Phase 5B-1E-2A: anon 緊急封じ込め（テーブルGRANT + next_customer_number EXECUTE）
--
-- 目的：
--   本番precheckにより、anon ロールが対象8テーブルすべてに
--   SELECT/INSERT/UPDATE/DELETEの実効権限を持ち、うち5テーブルは
--   RLSが無効なため、未ログインのAPIキーだけで直接読み書きできる
--   状態が確認された。本ファイルは、その未ログイン(anon)経路だけを
--   先行して遮断する緊急対応であり、恒久的な権限設計（Policy再設計・
--   RLS有効化・GRANT全体の最小権限化）そのものではない。
--
-- 本ファイルが変更するのはテーブルGRANTと next_customer_number(text)の
-- EXECUTE権限のみ。RLSのENABLE/DISABLE、FORCE RLS、Policyの
-- DROP/CREATE/ALTER、next_customer_number本体のCREATE OR REPLACE、
-- テーブル/列/index/constraintの変更、データのINSERT/UPDATE/DELETE、
-- Auth/Storage操作、authenticated/service_roleのテーブル権限変更、
-- デフォルト権限のALTERは一切行わない。
--
-- 【今回の緊急対応では解決しない問題（恒久対応で対応する）】
--   - authenticated（ログイン済みpatient含む）がRLS無効テーブルへ
--     直接アクセスできる問題（clients/weight_logs/meal_logs/stores/
--     customer_number_countersのRLS有効化で対応）
--   - 通常adminの店舗境界がPolicyで強制されていない問題
--   - admin_comments/body_photosのNULLワイルドカード条件
--     （p.store_id is null or c.store_id is null）
--   - 患者がadmin投稿のコメントを編集・削除できる問題
--   - next_customer_number内部にrole・店舗判定がなく、
--     ログイン済みpatientでも呼び出せてしまう問題
--     （本ファイル適用後も authenticated 全体に EXECUTE を許可するため、
--      この問題は明示的に残る。恒久対応でFunction本体を
--      SECURITY DEFINER化しrole/店舗判定を追加する）
--   - profilesの既存機能不全（password_changed/first_login_at更新、
--     admin向けhasPatientAccount判定）
--   - super_admin顧客作成フローのstore_id決定ロジック未確認事項
--   - GRANTの恒久的な最小権限化（REFERENCES/TRIGGER/TRUNCATE等の整理）
--   - 新規オブジェクト作成時のデフォルト権限（ALTER DEFAULT PRIVILEGES）
--   恒久対応では、customer_number_counters を含む public スキーマ上の
--   対象テーブルすべてについて RLS 有効化を検討・実施する方針とする。
--
-- 事前条件が本番の実際の状態と一致しない場合、下記 DO ブロックが
-- 例外を発生させ、このトランザクション全体が自動的にロールバックされる
-- （後続の REVOKE/GRANT は一切実行されない）。
-- ============================================================

begin;

do $$
declare
  v_missing_tables text[];
  v_missing_roles  text[];
  v_bad_table_priv text[];
  v_func_oid       oid;
  v_func_owner     oid;
  v_func_acl       aclitem[];
begin
  -- 1. 対象8テーブルの存在確認
  select array_agg(t) into v_missing_tables
  from unnest(array[
    'clients','weight_logs','meal_logs','admin_comments',
    'body_photos','stores','customer_number_counters','profiles'
  ]::text[]) as t
  where not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = t
  );
  if v_missing_tables is not null then
    raise exception 'precondition failed: missing tables: %', v_missing_tables;
  end if;

  -- 2. role の存在確認（anon / authenticated / service_role）
  select array_agg(r) into v_missing_roles
  from unnest(array['anon','authenticated','service_role']::text[]) as r
  where not exists (select 1 from pg_roles where rolname = r);
  if v_missing_roles is not null then
    raise exception 'precondition failed: missing roles: %', v_missing_roles;
  end if;

  -- 3. next_customer_number(text) の存在確認（引数名に依存しない完全修飾OID解決）。
  --    pg_get_function_identity_arguments()の返り値は引数名付き表記
  --    （例: "p_store_code text"）になる場合があり、'text'との文字列完全一致では
  --    実在するFunctionを誤って検出できないことが本番実行で確認されたため、
  --    to_regprocedureによる完全修飾名解決へ変更する。
  v_func_oid := pg_catalog.to_regprocedure('public.next_customer_number(text)');

  if v_func_oid is null then
    raise exception 'precondition failed: function public.next_customer_number(text) not found';
  end if;

  select p.proowner, p.proacl
    into v_func_owner, v_func_acl
  from pg_proc p
  where p.oid = v_func_oid;

  -- 4. anon が対象8テーブルへ SELECT/INSERT/UPDATE/DELETE を持つことを確認
  select array_agg(t || ':' || pr) into v_bad_table_priv
  from unnest(array[
    'clients','weight_logs','meal_logs','admin_comments',
    'body_photos','stores','customer_number_counters','profiles'
  ]::text[]) as t
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']::text[]) as pr
  where not has_table_privilege('anon', ('public.' || t)::regclass, pr);

  if v_bad_table_priv is not null then
    raise exception 'precondition failed: anon missing expected privileges: %', v_bad_table_priv;
  end if;

  -- 5. PUBLIC が next_customer_number(text) を実行可能なことを確認
  if not exists (
    select 1
    from aclexplode(coalesce(v_func_acl, acldefault('f', v_func_owner))) a
    where a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'precondition failed: PUBLIC cannot currently execute next_customer_number(text)';
  end if;

  -- 6. anon が next_customer_number(text) を実行可能なことを確認
  if not has_function_privilege('anon', v_func_oid, 'EXECUTE') then
    raise exception 'precondition failed: anon cannot currently execute next_customer_number(text)';
  end if;

  -- 7. authenticated が next_customer_number(text) を実行可能なことを確認
  if not has_function_privilege('authenticated', v_func_oid, 'EXECUTE') then
    raise exception 'precondition failed: authenticated cannot currently execute next_customer_number(text)';
  end if;
end $$;

-- ── ここまでの事前条件確認をすべて通過した場合のみ、以下を実行する ──

-- 対象8テーブル：anon / PUBLIC から ALL PRIVILEGES を REVOKE
-- （SELECT/INSERT/UPDATE/DELETEに加え、TRUNCATE/REFERENCES/TRIGGERも含む）
-- authenticated / service_role の権限はここでは一切変更しない。
revoke all privileges on table public.clients                 from anon, public;
revoke all privileges on table public.weight_logs              from anon, public;
revoke all privileges on table public.meal_logs                from anon, public;
revoke all privileges on table public.admin_comments           from anon, public;
revoke all privileges on table public.body_photos              from anon, public;
revoke all privileges on table public.stores                   from anon, public;
revoke all privileges on table public.customer_number_counters from anon, public;
revoke all privileges on table public.profiles                 from anon, public;

-- next_customer_number(text)：PUBLIC / anon から EXECUTE を REVOKE し、
-- authenticated / service_role へ明示的に EXECUTE を GRANT する。
-- Function本体（SECURITY DEFINER化・role/店舗判定の追加）は今回変更しない。
-- そのため、ログイン済みpatientがこのFunctionを呼べる問題は緊急対応後も残る。
revoke execute on function public.next_customer_number(text) from public, anon;
grant  execute on function public.next_customer_number(text) to authenticated;
grant  execute on function public.next_customer_number(text) to service_role;

commit;
