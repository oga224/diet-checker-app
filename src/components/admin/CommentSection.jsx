import { useEffect, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'

function Bubble({ comment }) {
  const isAdmin = comment.sender === 'admin' || !comment.sender
  const dateStr = format(parseISO(comment.created_at), 'M/d (E) HH:mm', { locale: ja })

  return (
    <div className={`flex gap-2 ${isAdmin ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* アバター */}
      <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white mt-1
        ${isAdmin ? 'bg-blue-500' : 'bg-green-500'}`}>
        {isAdmin ? '管' : '客'}
      </div>
      {/* 吹き出し */}
      <div className={`max-w-[75%] flex flex-col gap-1 ${isAdmin ? 'items-end' : 'items-start'}`}>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${isAdmin ? 'text-blue-600' : 'text-green-600'}`}>
            {isAdmin ? '管理者' : 'お客さん'}
          </span>
          <span className="text-xs text-gray-400">{dateStr}</span>
        </div>
        <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap shadow-sm
          ${isAdmin
            ? 'bg-blue-600 text-white rounded-tr-none'
            : 'bg-gray-100 text-gray-800 rounded-tl-none border border-gray-200'
          }`}>
          {comment.body}
        </div>
      </div>
    </div>
  )
}

export default function CommentSection({ clientId, showToast }) {
  const [comments, setComments] = useState([])
  const [text, setText]         = useState('')
  const [sending, setSending]   = useState(false)
  const [loading, setLoading]   = useState(true)
  const bottomRef               = useRef(null)
  const textareaRef             = useRef(null)

  async function fetchComments() {
    const { data, error } = await supabase
      .from('admin_comments')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: true })
    if (!error) setComments(data ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchComments() }, [clientId])

  useEffect(() => {
    if (!loading) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [comments, loading])

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
      fetchComments()
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend()
  }

  const clientCount = comments.filter((c) => c.sender === 'client').length

  return (
    <div className="flex flex-col h-full">
      {/* お客さんコメント件数バナー */}
      {clientCount > 0 && (
        <div className="mb-3 px-4 py-2.5 bg-green-50 border border-green-200 rounded-xl flex items-center gap-2 flex-shrink-0">
          <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
          <p className="text-sm text-green-700 font-medium">
            お客さんから {clientCount}件のメッセージがあります
          </p>
        </div>
      )}

      {/* コメント一覧 */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0 max-h-96 bg-gray-50 rounded-xl p-4">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
            <span className="text-4xl">💬</span>
            <p className="text-sm">まだコメントはありません</p>
          </div>
        ) : (
          comments.map((c) => <Bubble key={c.id} comment={c} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* 入力欄 */}
      <div className="mt-4 flex gap-3 items-end flex-shrink-0">
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
      <p className="text-xs text-gray-400 mt-1.5">Ctrl + Enter でも送信できます</p>
    </div>
  )
}

/** タブバッジ用：未読（クライアントコメント）件数を返す hook */
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
