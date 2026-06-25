import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
    </div>
  )
}

export default function AdminRoute() {
  const { session, profile, loading } = useAuth()

  if (loading)                      return <Spinner />
  if (!session)                     return <Navigate to="/login" replace />
  if (profile?.role !== 'admin')    return <Navigate to="/login" replace />

  return <Outlet />
}
