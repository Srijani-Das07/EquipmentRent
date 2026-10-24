import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatPaise } from '../api/inventory';
import { bookingsApi, formatDate, statusTone } from '../api/bookings';
import StatusPill from '../components/StatusPill';

const FILTERS = ['', 'PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED'];

export default function MyBookings() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ['bookings', 'mine', status, page],
    queryFn: () => bookingsApi.mine({ status, page }),
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">My bookings</h1>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          aria-label="Filter by status"
        >
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {f ? f.charAt(0) + f.slice(1).toLowerCase() : 'All statuses'}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <p className="mt-6 text-sm text-slate-500">Loading...</p>}
      {error && <p role="alert" className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">Your bookings could not be loaded.</p>}

      {data && data.items.length === 0 && (
        <p className="mt-6 text-sm text-slate-600">
          No bookings yet. <Link to="/catalog" className="text-brand-700 hover:underline">Browse the catalog</Link>.
        </p>
      )}

      <ul className="mt-6 space-y-3">
        {data?.items.map((b) => (
          <li key={b.id}>
            <Link to={`/my-bookings/${b.id}`} className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-500">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{b.equipment.name}</span>
                <StatusPill tone={statusTone(b.status)}>{b.status.charAt(0) + b.status.slice(1).toLowerCase()}</StatusPill>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                {formatDate(b.startAt)} to {formatDate(b.endAt)} ({b.rentalDays} day{b.rentalDays === 1 ? '' : 's'})
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {b.reference} · {formatPaise(b.costPaise)}
                {b.pendingPaise > 0 && <span className="ml-2 font-medium text-amber-700">Payment due: {formatPaise(b.pendingPaise)}</span>}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      {data && data.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between text-sm">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border px-3 py-1 disabled:opacity-40">Previous</button>
          <span>Page {data.page} of {data.totalPages}</span>
          <button disabled={page >= data.totalPages} onClick={() => setPage(page + 1)} className="rounded border px-3 py-1 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
