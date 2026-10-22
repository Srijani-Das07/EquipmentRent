import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { AuthProvider, useAuth } from './auth/AuthContext';
import RequireRole from './auth/RequireRole';
import { homeFor } from './api/auth';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import Forbidden from './pages/Forbidden';
import CustomerDashboard from './pages/CustomerDashboard';
import StaffDashboard from './pages/StaffDashboard';
import AdminDashboard from './pages/AdminDashboard';
import NotFound from './pages/NotFound';

function DashboardRedirect() {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="dashboard" element={<DashboardRedirect />} />
          <Route
            path="customer"
            element={
              <RequireRole roles={['CUSTOMER']}>
                <CustomerDashboard />
              </RequireRole>
            }
          />
          <Route
            path="staff"
            element={
              <RequireRole roles={['STAFF', 'ADMIN']}>
                <StaffDashboard />
              </RequireRole>
            }
          />
          <Route
            path="admin"
            element={
              <RequireRole roles={['ADMIN']}>
                <AdminDashboard />
              </RequireRole>
            }
          />
          <Route path="forbidden" element={<Forbidden />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}