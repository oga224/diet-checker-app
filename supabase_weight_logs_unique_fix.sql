-- weight_logs テーブルに (client_id, date) の UNIQUE 制約を追加
-- CSVインポートの upsert（上書きモード）で必要です。
-- Supabase SQL Editor に貼り付けて実行してください。

-- 既存の重複データを確認（実行前に確認用）
-- SELECT client_id, date, COUNT(*) FROM weight_logs GROUP BY client_id, date HAVING COUNT(*) > 1;

-- 重複がある場合は古い方を削除してから制約を追加
DELETE FROM weight_logs
WHERE id NOT IN (
  SELECT MAX(id)
  FROM weight_logs
  GROUP BY client_id, date
);

-- UNIQUE 制約を追加（既に存在する場合は無視）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'weight_logs'::regclass
      AND contype = 'u'
      AND conname = 'weight_logs_client_id_date_key'
  ) THEN
    ALTER TABLE weight_logs
      ADD CONSTRAINT weight_logs_client_id_date_key UNIQUE (client_id, date);
  END IF;
END$$;

-- 確認
SELECT conname, contype FROM pg_constraint WHERE conrelid = 'weight_logs'::regclass;
