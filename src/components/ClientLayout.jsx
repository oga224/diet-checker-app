import { Navigate, Outlet, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-blue-50">
      <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
    </div>
  )
}

export default function ClientLayout() {
  const { id }                    = useParams()
  const { session, profile, loading } = useAuth()

  if (loading)                    return <Spinner />
  if (!session)                   return <Navigate to="/login" replace />
  if (profile?.role !== 'client') return <Navigate to="/login" replace />

  // 他のお客さんのURLへのアクセスを自分のページにリダイレクト
  if (profile.client_id && id && profile.client_id !== id) {
    return <Navigate to={`/client/${profile.client_id}`} replace />
  }

  return <Outlet />
}
