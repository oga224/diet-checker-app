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

-- RLS（Row Level Security）は開発中は無効のままで可
-- 本番運用前に必ず設定してください
