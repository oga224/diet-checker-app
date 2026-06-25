import { createClient } from '@supabase/supabase-js'

// VITE_SUPABASE_ANON_KEY と VITE_SUPABASE_KEY の両方に対応
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
                 || import.meta.env.VITE_SUPABASE_KEY

// デバッグ用ログ（本番でも確認できるようにconsole.errorを使用）
if (!supabaseUrl || !supabaseKey) {
  console.error('[Supabase] 環境変数が取得できません', {
    VITE_SUPABASE_URL:      !!import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: !!import.meta.env.VITE_SUPABASE_ANON_KEY,
    VITE_SUPABASE_KEY:      !!import.meta.env.VITE_SUPABASE_KEY,
    availableKeys: Object.keys(import.meta.env).filter(k => k.startsWith('VITE_')),
  })
  throw new Error(
    'Supabase環境変数が設定されていません。' +
    'VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY をVercelの環境変数に設定してください。'
  )
}

export const supabase = createClient(supabaseUrl, supabaseKey)
