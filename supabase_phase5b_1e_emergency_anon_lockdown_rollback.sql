-- ============================================================
-- ★★★ 危険：緊急封じ込め解除ファイル（通常は実行しないこと） ★★★
--
-- このSQLを実行すると、supabase_phase5b_1e_emergency_anon_lockdown.sql
-- 適用前の状態、すなわち「anon（未ログイン状態のSupabase APIキー）が
-- 対象8テーブルへ直接 SELECT/INSERT/UPDATE/DELETE でき、
-- next_customer_number(text) を PUBLIC/anon から誰でも実行できる」
-- という、本番precheckで問題として確認された公開状態に戻ります。
--
-- 緊急封じ込めSQLの適用が既存機能を壊した場合の復旧専用ファイルであり、
-- 通常運用では実行しないでください。
--
-- ── 復元の範囲に関する制限事項 ──────────────────────────────
-- 緊急封じ込めSQLは対象8テーブルに対して ALL PRIVILEGES を REVOKE して
-- おり、これには SELECT/INSERT/UPDATE/DELETE に加え、
-- TRUNCATE/REFERENCES/TRIGGER も含まれる。
-- 本ロールバックは、Phase 5B-1E-1の本番precheckで「anonが実際に
-- 保持していたことが確認されている」SELECT/INSERT/UPDATE/DELETEの
-- 4権限だけを明示的なGRANTで復元する。
-- TRUNCATE/REFERENCES/TRIGGERをanonが適用前に個別に保持していたかは
-- 今回のPhase 5B-1E-1では実測しておらず、本ロールバックはこれらを
-- 復元しない。すなわち本ファイルは「緊急封じ込め前に実際に確認されて
-- いた実効権限の復元」であり、「適用前のACL行そのものの完全復元」
-- ではないことに注意すること。
--
-- next_customer_number(text)については、緊急封じ込め前に
-- PUBLIC・anonの双方がEXECUTE可能であったことが確認されているため、
-- 両方へ明示的にEXECUTEを復元する。
--
-- RLS・Policy・Function本体・データはこのファイルでは一切変更しない
-- （緊急封じ込めSQル自体もこれらを変更していないため、復元対象にも含まれない）。
-- authenticated・service_roleの権限は緊急封じ込めSQLで変更していないため
-- 本ファイルでも変更しない（実行可能な状態は継続して維持される）。
-- ============================================================

begin;

grant select, insert, update, delete on table public.clients                 to anon;
grant select, insert, update, delete on table public.weight_logs              to anon;
grant select, insert, update, delete on table public.meal_logs                to anon;
grant select, insert, update, delete on table public.admin_comments           to anon;
grant select, insert, update, delete on table public.body_photos              to anon;
grant select, insert, update, delete on table public.stores                   to anon;
grant select, insert, update, delete on table public.customer_number_counters to anon;
grant select, insert, update, delete on table public.profiles                 to anon;

grant execute on function public.next_customer_number(text) to public;
grant execute on function public.next_customer_number(text) to anon;

commit;
