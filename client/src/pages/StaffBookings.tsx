import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { formatPaise } from '../api/inventory';
import { bookingsApi, formatDateTime, statusTone } from '../api/bookings';
import StatusPill from '../components/StatusPill';

export default function StaffBookings() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('CONFIRMED');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['bookings', 'manage', status, search, page],
    queryFn: () => bookingsApi.manage({ status, search, page }),
  });

  const handover = useMutation({
    mutationFn: (id: string) => bookingsApi.handover(id),
    onSuccess: (b) => {
      setMessage({ kind: 'ok', text: `${b.reference} handed over.` });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
    onError: (e) => setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Handover failed.' }),
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Bookings and handover</h1>

      <div className="mt-4 flex flex-wrap gap-3">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label="Filter by status">
          <option value="">All statuses</option>
          {['PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
          ))}
        </select>
        <input
          type="search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search reference, customer or equipment"
          className="min-w-64 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={`mt-4 rounded-lg p-3 text-sm ${message.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
          {message.text}
        </p>
      )}
      {isLoading && <p className="mt-6 text-sm text-slate-500">Loading...</p>}
      {error && <p role="alert" className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">Bookings could not be loaded.</p>}
      {data && data.items.length === 0 && <p className="mt-6 text-sm text-slate-600">No bookings match.</p>}

      <ul className="mt-6 space-y-3">
        {data?.items.map((b) => (
          <li key={b.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{b.equipment.name} <span className="text-sm font-normal text-slate-500">({b.unitTag})</span></p>
                <p className="text-sm text-slate-600">{b.customer.name} · {b.customer.email}</p>
                <p className="text-xs text-slate-500">{b.reference} · {formatDateTime(b.startAt)} to {formatDateTime(b.endAt)} · {formatPaise(b.costPaise)}</p>
              </div>
              <div className="flex items-center gap-3">
                {b.pendingPaise > 0 && <span className="text-xs font-medium text-amber-700">Unpaid: {formatPaise(b.pendingPaise)}</span>}
                <StatusPill tone={statusTone(b.status)}>{b.status.charAt(0) + b.status.slice(1).toLowerCase()}</StatusPill>
                {b.status === 'CONFIRMED' && (
                  <button
                    disabled={handover.isPending}
                    onClick={() => { setMessage(null); handover.mutate(b.id); }}
                    className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    Hand over
                  </button>
                )}
              </div>
            </div>
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
