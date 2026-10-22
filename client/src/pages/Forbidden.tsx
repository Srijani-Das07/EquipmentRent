import { Link } from 'react-router-dom';
import { homeFor } from '../api/auth';
import { useAuth } from '../auth/AuthContext';

export default function Forbidden() {
  const { user } = useAuth();
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold">Access denied</h1>
      <p className="mt-2 text-slate-600">Your role does not have permission to view that page.</p>
      <Link
        to={user ? homeFor(user.role) : '/login'}
        className="mt-6 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        {user ? 'Back to my dashboard' : 'Go to login'}
      </Link>
    </div>
  );
}