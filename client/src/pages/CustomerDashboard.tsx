import { roleLabel } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import UpcomingCard from '../components/UpcomingCard';

export default function CustomerDashboard() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Welcome, {user.name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          Signed in as {user.email} ({roleLabel[user.role]})
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <UpcomingCard title="Browse equipment" description="Search the catalog and filter by category and availability." module="Module 2" />
        <UpcomingCard title="My bookings" description="Book, modify or cancel rentals and track their status." module="Module 3" />
        <UpcomingCard title="Payments and receipts" description="Pay for bookings and view outstanding charges and receipts." module="Module 4" />
      </div>
    </div>
  );
}