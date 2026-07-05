-- =====================================================
-- meal_logs テーブル RLS ポリシー修正
-- + (client_id, date) UNIQUE制約追加（upsert用）
-- Supabase ダッシュボード > SQL Editor で実行してください
-- =====================================================

-- 1. (client_id, date) UNIQUE 制約を追加（upsertに必要）
--    既存の重複がある場合は後勝ちで残す
DO $$
BEGIN
  -- 既に制約がなければ追加
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'meal_logs_client_id_date_unique'
  ) THEN
    -- 重複がある場合は古い方を削除してから制約追加
    DELETE FROM meal_logs a USING meal_logs b
    WHERE a.id < b.id
      AND a.client_id = b.client_id
      AND a.date = b.date;

    ALTER TABLE meal_logs
      ADD CONSTRAINT meal_logs_client_id_date_unique
      UNIQUE (client_id, date);
  END IF;
END $$;

-- 2. 既存の meal_logs 書き込みポリシーを削除
DROP POLICY IF EXISTS "staff_meal_logs_write"   ON meal_logs;
DROP POLICY IF EXISTS "clients_meal_logs_write" ON meal_logs;
DROP POLICY IF EXISTS "meal_logs_insert"        ON meal_logs;
DROP POLICY IF EXISTS "meal_logs_update"        ON meal_logs;
DROP POLICY IF EXISTS "meal_logs_delete"        ON meal_logs;
DROP POLICY IF EXISTS "meal_logs_select"        ON meal_logs;

-- 3. RLS を有効化（念のため）
ALTER TABLE meal_logs ENABLE ROW LEVEL SECURITY;

-- 4. SELECT: 認証済みユーザー全員（管理者・患者）
CREATE POLICY "meal_logs_select" ON meal_logs
  FOR SELECT TO authenticated
  USING (true);

-- 5. INSERT: 管理者/スタッフは全顧客分、患者は自分のみ
CREATE POLICY "meal_logs_insert" ON meal_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    -- 管理者・スタッフ
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'staff')
    )
    OR
    -- 患者（自分のclient_idのみ）
    client_id = (
      SELECT profiles.client_id FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'client'
    )
  );

-- 6. UPDATE: 同上
CREATE POLICY "meal_logs_update" ON meal_logs
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'staff')
    )
    OR
    client_id = (
      SELECT profiles.client_id FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'client'
    )
  );

-- 7. DELETE: 管理者・スタッフのみ
CREATE POLICY "meal_logs_delete" ON meal_logs
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'staff')
    )
  );
