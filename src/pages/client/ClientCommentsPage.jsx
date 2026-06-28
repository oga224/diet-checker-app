import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'

function Message({ comment, onEdit, onDelete }) {
  const isAdmin   = comment.sender === 'admin' || !comment.sender
  const isDeleted = false // ハードDELETEに変更したため不要
  const dateStr   = format(parseISO(comment.created_at), 'M月d日 (E) HH:mm', { locale: ja })

  const [editing,  setEditing]  = useState(false)
  const [editText, setEditText] = useState(comment.body)
  const [confirm,  setConfirm]  = useState(false)
  const [saving,   setSaving]   = useState(false)

  async function handleSave() {
    if (!editText.trim()) return
    setSaving(true)
    await onEdit(comment.id, editText.trim())
    setSaving(false)
    setEditing(false)
  }

  async function handleDelete() {
    setSaving(true)
    await onDelete(comment.id)
    setSaving(false)
    setConfirm(false)
  }

  if (isDeleted) {
    return (
      <div className={`flex ${isAdmin ? 'flex-row' : 'flex-row-reverse'}`}>
        <div className="max-w-[80%]">
          <p className="text-sm text-gray-300 italic px-2 py-3">このメッセージは削除されました</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex gap-3 ${isAdmin ? 'flex-row' : 'flex-row-reverse'}`}>
      <div className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-base font-bold text-white mt-1
        ${isAdmin ? 'bg-blue-500' : 'bg-green-400'}`}>
        {isAdmin ? '先' : '私'}
      </div>
      <div className={`max-w-[78%] flex flex-col gap-1 ${isAdmin ? 'items-start' : 'items-end'}`}>
        <div className="flex items-center gap-2 px-1">
          <span className={`text-sm font-bold ${isAdmin ? 'text-blue-600' : 'text-green-600'}`}>
            {isAdmin ? '先生' : 'あなた'}
          </span>
          <span className="text-xs text-gray-400">{dateStr}</span>
          {comment._edited && <span className="text-xs text-gray-300">（編集済み）</span>}
        </div>

        {editing ? (
          <div className="w-full space-y-2">
            <textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
              rows={3}
              className="w-full text-base bg-white border-2 border-blue-300 rounded-2xl px-4 py-3 outline-none resize-none"
            />
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={saving}
                className="flex-1 bg-blue-600 text-white text-base font-bold py-3 rounded-xl disabled:opacity-50">
                {saving ? '保存中…' : '保存する'}
              </button>
              <button onClick={() => { setEditing(false); setEditText(comment.body) }}
                className="flex-1 bg-gray-100 text-gray-600 text-base font-bold py-3 rounded-xl">
                キャンセル
              </button>
            </div>
          </div>
        ) : (
          <div className={`px-5 py-4 rounded-2xl text-lg leading-relaxed whitespace-pre-wrap shadow-sm
            ${isAdmin
              ? 'bg-white text-gray-800 border border-blue-100 rounded-tl-none'
              : 'bg-blue-500 text-white rounded-tr-none'
            }`}>
            {comment.body}
          </div>
        )}

        {/* 自分のメッセージのみ編集・削除 */}
        {!isAdmin && !editing && (
          <div className="flex gap-3 px-1">
            {!confirm ? (
              <>
                <button onClick={() => setEditing(true)}
                  className="text-xs text-gray-400 hover:text-blue-500">
                  ✏️ 編集
                </button>
                <button onClick={() => setConfirm(true)}
                  className="text-xs text-gray-400 hover:text-red-400">
                  🗑️ 削除
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-500 font-bold">本当に削除しますか？</span>
                <button onClick={handleDelete} disabled={saving}
                  className="text-xs font-bold text-white bg-red-500 px-3 py-1 rounded-full">
                  {saving ? '…' : '削除'}
                </button>
                <button onClick={() => setConfirm(false)}
                  className="text-xs text-gray-400 hover:text-gray-600">
                  やめる
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function ClientCommentsPage() {
  const { id } = useParams()
  const [comments, setComments]       = useState([])
  const [clientName, setClientName]   = useState('')
  const [text, setText]               = useState('')
  const [sending, setSending]         = useState(false)
  const [sent, setSent]               = useState(false)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const bottomRef                     = useRef(null)

  async function fetchData() {
    const [cr, mr] = await Promise.all([
      supabase.from('clients').select('name').eq('id', id).single(),
      supabase.from('admin_comments').select('*').eq('client_id', id)
        .order('created_at', { ascending: true }),
    ])
    if (!cr.error) setClientName(cr.data?.name ?? '')
    if (!mr.error) setComments(mr.data ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [id])

  useEffect(() => {
    if (!loading) {
      setTimeout(() => {
        const container = bottomRef.current?.parentElement
        if (container) container.scrollTop = container.scrollHeight
      }, 50)
    }
  }, [comments, loading])

  async function handleSend() {
    const body = text.trim()
    if (!body) return
    setSending(true); setError(null)
    const { error: e } = await supabase.from('admin_comments').insert({
      client_id: id, body, sender: 'client',
    })
    setSending(false)
    if (e) {
      setError('送信できませんでした。もう一度お試しください。')
    } else {
      setText(''); setSent(true)
      setTimeout(() => setSent(false), 3000)
      fetchData()
    }
  }

  async function handleEdit(commentId, newBody) {
    const { error } = await supabase.from('admin_comments')
      .update({ body: newBody })
      .eq('id', commentId)
    if (error) {
      console.error('Edit error:', error)
      setError(`編集できませんでした：${error.message}`)
      return
    }
    // 画面を即時更新
    setComments(prev => prev.map(c => c.id === commentId ? { ...c, body: newBody, _edited: true } : c))
  }

  async function handleDelete(commentId) {
    const { error } = await supabase.from('admin_comments')
      .delete()
      .eq('id', commentId)
    if (error) {
      console.error('Delete error:', error)
      setError(`削除できませんでした：${error.message}`)
      return
    }
    // 画面から即時削除
    setComments(prev => prev.filter(c => c.id !== commentId))
  }

  const adminCount  = comments.filter(c => c.sender === 'admin' || !c.sender).length
  const clientCount = comments.filter(c => c.sender === 'client').length

  return (
    <div className="min-h-screen bg-blue-50 flex flex-col">
      <header className="bg-blue-600 text-white px-5 py-5 shadow-md flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link to={`/client/${id}`} className="text-blue-200 text-2xl p-1">‹</Link>
          <div>
            <h1 className="text-xl font-bold">先生とのメッセージ</h1>
            {clientName && <p className="text-blue-200 text-sm">{clientName} さん</p>}
          </div>
          {adminCount > 0 && (
            <span className="ml-auto bg-white text-blue-600 text-sm font-bold px-3 py-1 rounded-full">
              先生 {adminCount}件
            </span>
          )}
        </div>
      </header>

      {sent && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white text-lg font-bold px-8 py-4 rounded-2xl shadow-2xl">
          ✓ 送信しました
        </div>
      )}

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
          </div>
        ) : (
          <>
            <p className="text-center text-sm text-gray-400 bg-white/60 rounded-full px-4 py-1 mx-auto w-fit">
              メッセージ {comments.length}件
            </p>
            {comments.map(c => (
              <Message key={c.id} comment={c} onEdit={handleEdit} onDelete={handleDelete} />
            ))}
          </>
        )}
        <div ref={bottomRef} />
      </main>

      <div className="bg-white border-t border-gray-200 px-4 py-4 flex-shrink-0 shadow-lg">
        {error && <p className="text-base text-red-500 mb-3 bg-red-50 px-4 py-3 rounded-xl">{error}</p>}
        <div className="flex gap-3 items-end">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={3}
            placeholder="先生へのメッセージを書いてください"
            className="flex-1 resize-none text-xl bg-gray-50 rounded-2xl border-2 border-gray-200 focus:border-blue-400 outline-none px-4 py-3 text-gray-800 leading-relaxed"
          />
          <button type="button" onClick={handleSend} disabled={sending || !text.trim()}
            className="flex-shrink-0 w-16 h-16 bg-blue-600 text-white text-2xl font-bold rounded-2xl hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center shadow-md">
            {sending ? <div className="w-6 h-6 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : '↑'}
          </button>
        </div>
        <p className="text-sm text-gray-400 mt-2 text-center">
          自分のメッセージは長押しで編集・削除できます
        </p>
      </div>
    </div>
  )
}
