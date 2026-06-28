import { useEffect, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'

// ── コメントカード（種別ごとに色分け） ─────────────────────────
function CommentCard({ item, onEdit, onDelete }) {
  const [editing, setEditing]   = useState(false)
  const [editText, setEditText] = useState(item.body)
  const [confirm, setConfirm]   = useState(false)
  const [saving, setSaving]     = useState(false)

  // admin_message のみ編集・削除可
  const canEdit = item.type === 'admin_message' && onEdit && onDelete

  async function handleSave() {
    if (!editText.trim()) return
    setSaving(true); await onEdit(item.rawId, editText.trim()); setSaving(false); setEditing(false)
  }
  async function handleDelete() {
    setSaving(true); await onDelete(item.rawId); setSaving(false); setConfirm(false)
  }
  const typeConfig = {
    daily: {
      label:   '📝 今日のコメント',
      border:  'border-l-yellow-400',
      labelCls: 'text-yellow-700',
      bg:       'bg-yellow-50',
    },
    client_message: {
      label:   '💬 先生へのメッセージ',
      border:  'border-l-green-400',
      labelCls: 'text-green-700',
      bg:       'bg-green-50',
    },
    admin_message: {
      label:   '👩‍⚕️ 管理者からの返信',
      border:  'border-l-blue-400',
      labelCls: 'text-blue-700',
      bg:       'bg-blue-50',
    },
  }
  const cfg = typeConfig[item.type]
  return (
    <div className={`border-l-4 ${cfg.border} ${cfg.bg} rounded-r-xl px-4 py-3 space-y-1`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs font-bold ${cfg.labelCls}`}>{cfg.label}</span>
        <div className="flex items-center gap-2">
          {item.edited && <span className="text-xs text-gray-300">（編集済み）</span>}
          <span className="text-xs text-gray-400">
            {item.dateLabel}{item.timeLabel ? ` ${item.timeLabel}` : ''}
          </span>
        </div>
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={2}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-blue-400 resize-none" />
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving}
              className="text-xs font-bold bg-blue-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
              {saving ? '…' : '保存'}
            </button>
            <button onClick={() => { setEditing(false); setEditText(item.body) }}
              className="text-xs text-gray-500 hover:text-gray-700">キャンセル</button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{item.body}</p>
      )}
      {canEdit && !editing && (
        <div className="flex gap-3 pt-1">
          {!confirm ? (
            <>
              <button onClick={() => setEditing(true)} className="text-xs text-gray-400 hover:text-blue-500">✏️ 編集</button>
              <button onClick={() => setConfirm(true)} className="text-xs text-gray-400 hover:text-red-400">🗑️ 削除</button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-500 font-bold">削除しますか？</span>
              <button onClick={handleDelete} disabled={saving}
                className="text-xs font-bold text-white bg-red-500 px-2 py-0.5 rounded-full">
                {saving ? '…' : '削除'}
              </button>
              <button onClick={() => setConfirm(false)} className="text-xs text-gray-400">やめる</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function CommentSection({ clientId, showToast }) {
  const [items,   setItems]   = useState([])   // マージ済み一覧
  const [text,    setText]    = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const textareaRef           = useRef(null)

  async function fetchAll() {
    setLoading(true)
    const [acRes, wlRes] = await Promise.all([
      // admin_comments（管理者↔お客さんのメッセージ）
      supabase.from('admin_comments').select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false }),
      // weight_logs.comment（今日のコメント）
      supabase.from('weight_logs')
        .select('date, comment')
        .eq('client_id', clientId)
        .not('comment', 'is', null)
        .order('date', { ascending: false }),
    ])

    // admin_comments を変換
    const messages = (acRes.data ?? []).map((c) => ({
      type:      c.sender === 'admin' ? 'admin_message' : 'client_message',
      sortKey:   c.created_at,
      dateLabel: format(parseISO(c.created_at), 'yyyy/M/d (E)', { locale: ja }),
      timeLabel: format(parseISO(c.created_at), 'HH:mm', { locale: ja }),
      body:      c.body,
      id:        `msg-${c.id}`,
      rawId:     c.id,
      edited:    false,
    }))

    // weight_logs.comment を変換（空文字は除外）
    const dailyComments = (wlRes.data ?? [])
      .filter((l) => l.comment?.trim())
      .map((l) => ({
        type:      'daily',
        sortKey:   `${l.date}T23:59:59`, // 日次は日の末尾として扱う
        dateLabel: format(parseISO(l.date), 'yyyy/M/d (E)', { locale: ja }),
        timeLabel: null,
        body:      l.comment,
        id:        `daily-${l.date}`,
      }))

    // 時系列降順（新しい順）でマージ
    const all = [...messages, ...dailyComments]
      .sort((a, b) => b.sortKey.localeCompare(a.sortKey))

    setItems(all)
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [clientId])

  async function handleEditMsg(rawId, newBody) {
    const { error } = await supabase.from('admin_comments')
      .update({ body: newBody })
      .eq('id', rawId)
    if (error) {
      console.error('Edit error:', error)
      showToast('error', `編集できませんでした：${error.message}`)
      return
    }
    // 画面を即時更新
    setItems(prev => prev.map(item =>
      item.rawId === rawId ? { ...item, body: newBody, edited: true } : item
    ))
  }

  async function handleDeleteMsg(rawId) {
    const { error } = await supabase.from('admin_comments')
      .delete()
      .eq('id', rawId)
    if (error) {
      console.error('Delete error:', error)
      showToast('error', `削除できませんでした：${error.message}`)
      return
    }
    // 画面から即時削除
    setItems(prev => prev.filter(item => item.rawId !== rawId))
  }

  async function handleSend() {
    const body = text.trim()
    if (!body) return
    setSending(true)
    const { error } = await supabase.from('admin_comments').insert({
      client_id: clientId,
      body,
      sender: 'admin',
    })
    setSending(false)
    if (error) {
      showToast('error', `送信失敗：${error.message}`)
    } else {
      setText('')
      fetchAll()
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend()
  }

  // 件数集計
  const dailyCount   = items.filter((i) => i.type === 'daily').length
  const clientMsgCnt = items.filter((i) => i.type === 'client_message').length

  return (
    <div className="flex flex-col gap-4">
      {/* ── 件数バナー ── */}
      {(dailyCount > 0 || clientMsgCnt > 0) && (
        <div className="flex flex-wrap gap-2">
          {dailyCount > 0 && (
            <span className="text-xs font-medium bg-yellow-50 text-yellow-700 border border-yellow-200 px-3 py-1.5 rounded-full">
              📝 今日のコメント {dailyCount}件
            </span>
          )}
          {clientMsgCnt > 0 && (
            <span className="text-xs font-medium bg-green-50 text-green-700 border border-green-200 px-3 py-1.5 rounded-full">
              💬 先生へのメッセージ {clientMsgCnt}件
            </span>
          )}
        </div>
      )}

      {/* ── コメント一覧 ── */}
      <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-gray-400 gap-2">
            <span className="text-4xl">💬</span>
            <p className="text-sm">コメントはまだありません</p>
          </div>
        ) : (
          items.map((item) => (
            <CommentCard key={item.id} item={item}
              onEdit={item.rawId ? handleEditMsg : null}
              onDelete={item.rawId ? handleDeleteMsg : null}
            />
          ))
        )}
      </div>

      {/* ── 管理者コメント入力 ── */}
      <div className="border-t border-gray-100 pt-4 flex gap-3 items-end">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder="お客さんへのコメントを入力…（Ctrl+Enter で送信）"
          className="flex-1 resize-none text-sm border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !text.trim()}
          className="flex-shrink-0 px-5 py-3 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? '送信中…' : '送信'}
        </button>
      </div>
      <p className="text-xs text-gray-400">Ctrl + Enter でも送信できます</p>
    </div>
  )
}

/** ヘッダーバッジ用：お客さんメッセージ件数を返す hook */
export function useClientCommentCount(clientId) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    supabase
      .from('admin_comments')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('sender', 'client')
      .then(({ count: c }) => setCount(c ?? 0))
  }, [clientId])
  return count
}
