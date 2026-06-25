-- ============================================================
-- 整骨院体重管理アプリ Supabase スキーマ
-- Supabase ダッシュボード > SQL Editor で実行してください
-- ============================================================

-- お客さんテーブル
create table if not exists clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  kana          text,
  phone         text,
  goal_weight   numeric(5,1),
  memo          text,
  created_at    timestamptz default now()
);

-- 体重記録テーブル
create table if not exists weight_logs (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  date          date not null,
  morning_kg    numeric(5,1),
  evening_kg    numeric(5,1),
  note          text,
  created_at    timestamptz default now(),
  unique(client_id, date)
);

-- 食事記録テーブル
create table if not exists meal_logs (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  date          date not null,
  meal_type     text check (meal_type in ('朝', '昼', '夜', '間食')),
  memo          text,
  photo_url     text,
  created_at    timestamptz default now()
);

-- 施術前後写真テーブル
create table if not exists body_photos (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  date          date not null,
  type          text check (type in ('before', 'after')),
  photo_url     text not null,
  created_at    timestamptz default now()
);

-- 管理者コメントテーブル
create table if not exists admin_comments (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  body          text not null,
  created_at    timestamptz default now()
);

-- ============================================================
-- テスト用データ（開発中のみ。本番では削除してください）
-- ============================================================

insert into clients (id, name, kana, phone, goal_weight, memo) values
  ('00000000-0000-0000-0000-000000000001', '山田 花子', 'ヤマダ ハナコ', '090-1234-5678', 55.0, '腰痛改善が目標'),
  ('00000000-0000-0000-0000-000000000002', '鈴木 太郎', 'スズキ タロウ', '080-9876-5432', 70.0, '3ヶ月で-5kg目標'),
  ('00000000-0000-0000-0000-000000000003', '田中 美咲', 'タナカ ミサキ', '070-1111-2222', 48.0, null)
on conflict (id) do nothing;

insert into weight_logs (client_id, date, morning_kg, evening_kg) values
  ('00000000-0000-0000-0000-000000000001', current_date - 6, 60.2, 60.8),
  ('00000000-0000-0000-0000-000000000001', current_date - 5, 59.8, 60.3),
  ('00000000-0000-0000-0000-000000000001', current_date - 4, 59.5, 60.0),
  ('00000000-0000-0000-0000-000000000001', current_date - 3, 59.2, 59.7),
  ('00000000-0000-0000-0000-000000000001', current_date - 2, 58.9, 59.4),
  ('00000000-0000-0000-0000-000000000001', current_date - 1, 58.6, 59.1),
  ('00000000-0000-0000-0000-000000000001', current_date,     58.3, null),
  ('00000000-0000-0000-0000-000000000002', current_date - 3, 76.0, 76.5),
  ('00000000-0000-0000-0000-000000000002', current_date - 2, 75.5, 76.0),
  ('00000000-0000-0000-0000-000000000002', current_date - 1, 75.2, 75.8),
  ('00000000-0000-0000-0000-000000000002', current_date,     74.9, null)
on conflict (client_id, date) do nothing;

-- RLS（Row Level Security）は開発中は無効のままで可
-- 本番運用前に必ず設定してください
