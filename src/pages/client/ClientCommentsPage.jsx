import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'

function Bubble({ comment }) {
  const isAdmin = comment.sender === 'admin' || !comment.sender
  const dateStr = format(parseISO(comment.created_at), 'M月d日 (E) HH:mm', { locale: ja })

  return (
    <div className={`flex gap-3 ${isAdmin ? 'flex-row' : 'flex-row-reverse'}`}>
      {/* アバター */}
      <div className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-base font-bold text-white mt-1 shadow-sm
        ${isAdmin ? 'bg-blue-500' : 'bg-green-400'}`}>
        {isAdmin ? '先' : '私'}
      </div>

      {/* 吹き出し本体 */}
      <div className={`max-w-[78%] flex flex-col gap-1 ${isAdmin ? 'items-start' : 'items-end'}`}>
        <div className="flex items-center gap-2 px-1">
          <span className={`text-sm font-bold ${isAdmin ? 'text-blue-600' : 'text-green-600'}`}>
            {isAdmin ? '先生' : 'あなた'}
          </span>
          <span className="text-xs text-gray-400">{dateStr}</span>
        </div>
        <div className={`px-5 py-4 rounded-2xl text-lg leading-relaxed whitespace-pre-wrap shadow-sm
          ${isAdmin
            ? 'bg-white text-gray-800 border border-blue-100 rounded-tl-none'
            : 'bg-blue-500 text-white rounded-tr-none'
          }`}>
          {comment.body}
        </div>
      </div>
    </div>
  )
}

export default function ClientCommentsPage() {
  const { id } = useParams()
  const [comments, setComments]     = useState([])
  const [clientName, setClientName] = useState('')
  const [text, setText]             = useState('')
  const [sending, setSending]       = useState(false)
  const [sent, setSent]             = useState(false)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const bottomRef                   = useRef(null)

  async function fetchData() {
    const [clientRes, commentsRes] = await Promise.all([
      supabase.from('clients').select('name').eq('id', id).single(),
      supabase.from('admin_comments')
        .select('*')
        .eq('client_id', id)
        .order('created_at', { ascending: true }),
    ])
    if (!clientRes.error)   setClientName(clientRes.data?.name ?? '')
    if (!commentsRes.error) setComments(commentsRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [id])

  useEffect(() => {
    if (!loading) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [comments, loading])

  async function handleSend() {
    const body = text.trim()
    if (!body) return
    setSending(true)
    setError(null)
    const { error: sendError } = await supabase.from('admin_comments').insert({
      client_id: id,
      body,
      sender: 'client',
    })
    setSending(false)
    if (sendError) {
      setError('送信できませんでした。もう一度お試しください。')
    } else {
      setText('')
      setSent(true)
      setTimeout(() => setSent(false), 3000)
      fetchData()
    }
  }

  const adminCount  = comments.filter((c) => c.sender === 'admin' || !c.sender).length
  const clientCount = comments.filter((c) => c.sender === 'client').length

  return (
    <div className="min-h-screen bg-blue-50 flex flex-col">
      {/* ヘッダー */}
      <header className="bg-blue-600 text-white px-5 py-5 shadow-md flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link to={`/client/${id}`} className="text-blue-200 text-2xl leading-none p-1">‹</Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold">先生とのメッセージ</h1>
            {clientName && <p className="text-blue-200 text-sm">{clientName} さん</p>}
          </div>
          {adminCount > 0 && (
            <div className="text-right">
              <p className="text-xs text-blue-200">先生から</p>
              <p className="text-base font-bold">{adminCount}件</p>
            </div>
          )}
        </div>
      </header>

      {/* 送信完了トースト */}
      {sent && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white text-lg font-bold px-8 py-4 rounded-2xl shadow-2xl">
          ✓ 送信しました
        </div>
      )}

      {/* コメント一覧 */}
      <main className="flex-1 overflow-y-auto px-4 py-5 space-y-5 pb-2">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 space-y-3">
            <p className="text-6xl">💬</p>
            <p className="text-xl font-bold text-gray-500">まだメッセージはありません</p>
            <p className="text-base text-center leading-relaxed">
              先生からのメッセージが届くと<br />ここに表示されます
            </p>
            <p className="text-base text-center text-blue-500 mt-2">
              下の入力欄から先生へ<br />メッセージを送ることができます
            </p>
          </div>
        ) : (
          <>
            <p className="text-center text-sm text-gray-400 bg-white/60 rounded-full px-4 py-1 mx-auto w-fit">
              メッセージ {comments.length}件
            </p>
            {comments.map((c) => <Bubble key={c.id} comment={c} />)}
          </>
        )}
        <div ref={bottomRef} />
      </main>

      {/* 入力エリア */}
      <div className="bg-white border-t border-gray-200 px-4 py-4 flex-shrink-0 shadow-lg">
        {error && (
          <p className="text-base text-red-500 mb-3 bg-red-50 px-4 py-3 rounded-xl">{error}</p>
        )}
        <div className="flex gap-3 items-end">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="先生へのメッセージを書いてください"
            className="flex-1 resize-none text-xl bg-gray-50 rounded-2xl border-2 border-gray-200 focus:border-blue-400 outline-none px-4 py-3 text-gray-800 leading-relaxed"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !text.trim()}
            className="flex-shrink-0 w-16 h-16 bg-blue-600 text-white text-base font-bold rounded-2xl hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center shadow-md"
          >
            {sending
              ? <div className="w-6 h-6 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              : <span className="text-2xl">↑</span>
            }
          </button>
        </div>
        <p className="text-sm text-gray-400 mt-2 text-center">
          メッセージを書いて「↑」ボタンを押してください
        </p>
      </div>
    </div>
  )
}
