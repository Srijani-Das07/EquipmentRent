import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { formatDateTime } from '../api/bookings';
import { maintenanceApi, type QueueItem } from '../api/returns';
import StatusPill from '../components/StatusPill';

export default function MaintenanceQueue() {
  const [view, setView] = useState<'open' | 'cleared'>('open');

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Maintenance queue</h1>
      <p className="mt-1 text-sm text-slate-600">Units flagged for maintenance cannot be booked until they are cleared.</p>

      <div className="mt-4 flex gap-2" role="tablist">
        {(['open', 'cleared'] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${view === v ? 'bg-brand-600 text-white' : 'border border-slate-300 hover:bg-slate-50'}`}
          >
            {v === 'open' ? 'Waiting' : 'History'}
          </button>
        ))}
      </div>

      {view === 'open' ? <OpenList /> : <HistoryList />}
    </div>
  );
}

function OpenList() {
  const { data, isLoading, error } = useQuery({ queryKey: ['maintenance', 'open'], queryFn: maintenanceApi.open });
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div>
      {message && <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
      {isLoading && <p className="mt-6 text-sm text-slate-500">Loading...</p>}
      {error && <p role="alert" className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">The queue could not be loaded.</p>}
      {data && data.length === 0 && <p className="mt-6 text-sm text-slate-600">Nothing is waiting for maintenance.</p>}
      <ul className="mt-6 space-y-3">
        {data?.map((item) => (
          <QueueCard key={item.unitId} item={item} onCleared={(tag) => setMessage(`${tag} is back in service.`)} />
        ))}
      </ul>
    </div>
  );
}

function QueueCard({ item, onCleared }: { item: QueueItem; onCleared: (tag: string) => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const clear = useMutation({
    mutationFn: () => maintenanceApi.clear(item.unitId, notes.trim() || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      onCleared(item.tag);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not clear this unit.'),
  });

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">{item.equipmentName} <span className="text-sm font-normal text-slate-500">({item.tag})</span></p>
          <p className="text-xs text-slate-500">
            {item.category} · {item.rentalsSinceMaintenance} rentals since last maintenance · {item.lifetimeRentals} in total
          </p>
          {item.notes && <p className="mt-1 text-sm text-slate-700">{item.notes}</p>}
          {item.openedAt && <p className="text-xs text-slate-500">Flagged {formatDateTime(item.openedAt)}</p>}
        </div>
        <div className="flex items-center gap-3">
          {item.reason && <StatusPill tone={item.reason === 'DAMAGE' ? 'bad' : 'wait'}>{item.reason === 'DAMAGE' ? 'Damage' : 'Rental interval'}</StatusPill>}
          {item.upcomingBookings > 0 && <span className="text-xs font-medium text-amber-700">{item.upcomingBookings} upcoming booking(s)</span>}
          <button onClick={() => setOpen(!open)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700">
            {open ? 'Close' : 'Clear'}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-3 rounded-lg bg-slate-50 p-4">
          <label className="block text-sm font-medium">
            Maintenance done (optional)
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <button
            disabled={clear.isPending}
            onClick={() => {
              setError(null);
              clear.mutate();
            }}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {clear.isPending ? 'Saving...' : 'Mark maintenance complete'}
          </button>
        </div>
      )}
    </li>
  );
}

function HistoryList() {
  const { data, isLoading, error } = useQuery({ queryKey: ['maintenance', 'cleared'], queryFn: maintenanceApi.cleared });
  return (
    <div>
      {isLoading && <p className="mt-6 text-sm text-slate-500">Loading...</p>}
      {error && <p role="alert" className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">The history could not be loaded.</p>}
      {data && data.length === 0 && <p className="mt-6 text-sm text-slate-600">No completed maintenance yet.</p>}
      <ul className="mt-6 space-y-3">
        {data?.map((h) => (
          <li key={h.logId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="font-semibold">{h.equipmentName} <span className="text-sm font-normal text-slate-500">({h.tag})</span></p>
            {h.notes && <p className="mt-1 text-sm text-slate-700">{h.notes}</p>}
            <p className="mt-1 text-xs text-slate-500">
              {h.trigger === 'DAMAGE' ? 'Damage' : 'Rental interval'} · opened {formatDateTime(h.openedAt)} · cleared {formatDateTime(h.clearedAt)}
              {h.clearedBy ? ` by ${h.clearedBy}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
