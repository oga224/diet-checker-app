import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider }    from './contexts/AuthContext'
import AdminRoute          from './components/AdminRoute'
import ClientLayout        from './components/ClientLayout'

import App                from './App'
import LoginPage          from './pages/LoginPage'
import ClientListPage     from './pages/admin/ClientListPage'
import ClientDetailPage   from './pages/admin/ClientDetailPage'
import ClientTopPage      from './pages/client/ClientTopPage'
import ClientRecordPage   from './pages/client/ClientRecordPage'
import ClientHistoryPage  from './pages/client/ClientHistoryPage'
import ClientCommentsPage from './pages/client/ClientCommentsPage'
import ClientCalendarPage from './pages/client/ClientCalendarPage'
import ClientPasswordChangePage from './pages/client/ClientPasswordChangePage'

export default function AppRouter() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* 公開ページ（認証不要） */}
          <Route path="/"      element={<App />} />
          <Route path="/login" element={<LoginPage />} />

          {/* 管理者専用ページ */}
          <Route element={<AdminRoute />}>
            <Route path="/admin"             element={<Navigate to="/admin/clients" replace />} />
            <Route path="/admin/clients"     element={<ClientListPage />} />
            <Route path="/admin/clients/:id" element={<ClientDetailPage />} />
          </Route>

          {/* お客さん専用ページ（自分のデータのみ） */}
          <Route path="/client/:id" element={<ClientLayout />}>
            <Route index                       element={<ClientTopPage />} />
            <Route path="record"               element={<ClientRecordPage />} />
            <Route path="record/:date"         element={<ClientRecordPage />} />
            <Route path="history"              element={<ClientHistoryPage />} />
            <Route path="comments"             element={<ClientCommentsPage />} />
            <Route path="calendar"             element={<ClientCalendarPage />} />
            <Route path="password"             element={<ClientPasswordChangePage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
