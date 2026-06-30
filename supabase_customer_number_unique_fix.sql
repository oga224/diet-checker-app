-- ============================================================
-- 顧客番号（customer_number）の永久欠番化・重複防止
-- Supabase SQL Editor で実行してください（上から順に1回実行すればOK）
-- ============================================================

-- ── 1. 店舗コードごとの「最後に発行した番号」を記録する採番台帳 ──
-- 削除された clients 行とは独立して残るため、削除済み番号は二度と出てこない
create table if not exists customer_number_counters (
  store_code   text primary key,
  last_number  integer not null default 0
);

-- ── 2. 既存データから現在の最大番号を採番台帳に取り込む（初期シード） ──
insert into customer_number_counters (store_code, last_number)
select
  s.code,
  coalesce(max((regexp_match(c.customer_number, '(\d+)$'))[1]::integer), 0)
from stores s
left join clients c
  on c.store_id = s.id
  and c.customer_number ~ ('^' || s.code || '-\d+$')
group by s.code
on conflict (store_code) do update
  set last_number = greatest(customer_number_counters.last_number, excluded.last_number);

-- ── 3. 次番号を払い出す関数（store_code 単位でアトミックに +1） ──
create or replace function next_customer_number(p_store_code text)
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

grant execute on function next_customer_number(text) to authenticated;

-- ── 4. 既存の重複 customer_number を解消 ──
-- 同じ番号が複数顧客に付いている場合、最も古い登録（created_at が早い方）だけ番号を残し、
-- それ以外には採番台帳から新しい番号を払い出して付け直す
do $$
declare
  rec record;
  v_store_code text;
  v_new_number text;
begin
  for rec in
    select id, customer_number,
           row_number() over (partition by customer_number order by created_at) as rn
    from clients
    where customer_number is not null
  loop
    if rec.rn > 1 then
      v_store_code := split_part(rec.customer_number, '-', 1);
      v_new_number := next_customer_number(v_store_code);
      update clients set customer_number = v_new_number where id = rec.id;
    end if;
  end loop;
end $$;

-- ── 5. customer_number に DB レベルの UNIQUE 制約を追加 ──
-- （上の重複解消を先に実行してから追加すること）
alter table clients
  add constraint clients_customer_number_unique unique (customer_number);
