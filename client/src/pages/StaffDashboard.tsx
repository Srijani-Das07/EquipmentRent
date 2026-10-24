import { roleLabel } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import UpcomingCard from '../components/UpcomingCard';

export default function StaffDashboard() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Staff tools</h1>
        <p className="mt-1 text-sm text-slate-600">
          {user.name} ({roleLabel[user.role]})
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <UpcomingCard title="Inventory" description="View equipment and update the status of physical units." to="/staff/inventory" />
        <UpcomingCard title="Hand over equipment" description="Mark confirmed bookings as picked up." module="Module 3" />
        <UpcomingCard title="Process returns" description="Log item condition and apply late fees and damage penalties." module="Module 5" />
        <UpcomingCard title="Maintenance queue" description="View flagged items and clear them after maintenance." module="Module 6" />
      </div>
    </div>
  );
}