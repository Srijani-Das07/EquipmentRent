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
import Catalog from './pages/Catalog';
import EquipmentDetail from './pages/EquipmentDetail';
import InventoryManager from './pages/InventoryManager';
import MyBookings from './pages/MyBookings';
import BookingDetail from './pages/BookingDetail';
import Payment from './pages/Payment';
import PaymentsPage from './pages/PaymentsPage';
import Receipt from './pages/Receipt';
import StaffBookings from './pages/StaffBookings';

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
          <Route path="catalog" element={<Catalog />} />
          <Route path="catalog/:id" element={<EquipmentDetail />} />
          <Route
            path="customer"
            element={
              <RequireRole roles={['CUSTOMER']}>
                <CustomerDashboard />
              </RequireRole>
            }
          />
          <Route path="my-bookings" element={<RequireRole roles={['CUSTOMER']}><MyBookings /></RequireRole>} />
          <Route path="my-bookings/:id" element={<RequireRole roles={['CUSTOMER']}><BookingDetail /></RequireRole>} />
          <Route path="pay/:chargeId" element={<RequireRole roles={['CUSTOMER']}><Payment /></RequireRole>} />
          <Route path="payments" element={<RequireRole roles={['CUSTOMER']}><PaymentsPage /></RequireRole>} />
          <Route path="receipts/:id" element={<RequireRole roles={['CUSTOMER', 'STAFF', 'ADMIN']}><Receipt /></RequireRole>} />
          <Route path="staff/bookings" element={<RequireRole roles={['STAFF', 'ADMIN']}><StaffBookings /></RequireRole>} />
          <Route
            path="staff"
            element={
              <RequireRole roles={['STAFF', 'ADMIN']}>
                <StaffDashboard />
              </RequireRole>
            }
          />
          <Route
            path="staff/inventory"
            element={
              <RequireRole roles={['STAFF', 'ADMIN']}>
                <InventoryManager mode="staff" />
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
          <Route
            path="admin/inventory"
            element={
              <RequireRole roles={['ADMIN']}>
                <InventoryManager mode="admin" />
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