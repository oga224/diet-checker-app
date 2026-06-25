-- admin_comments に送信者区分を追加
-- Supabase ダッシュボード > SQL Editor で実行してください

alter table admin_comments
  add column if not exists sender text
    default 'admin'
    check (sender in ('admin', 'client'));

-- 既存データは全て admin 扱いにする
update admin_comments set sender = 'admin' where sender is null;

-- anon に insert 権限が必要な場合（RLSを有効にしている場合のみ）
-- create policy "anon_insert_comments" on admin_comments for insert to anon with check (true);
-- create policy "anon_select_comments" on admin_comments for select to anon using (true);
