import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { formatPaise } from '../api/inventory';
import { bookingsApi, formatDateTime, type Booking } from '../api/bookings';
import { conditionLabel, returnsApi, type Condition, type ReturnResult } from '../api/returns';

const CONDITIONS: Condition[] = ['GOOD', 'MINOR_DAMAGE', 'MAJOR_DAMAGE', 'LOST'];

export default function StaffReturns() {
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [result, setResult] = useState<ReturnResult | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['bookings', 'manage', 'ACTIVE', search],
    queryFn: () => bookingsApi.manage({ status: 'ACTIVE', search }),
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Process returns</h1>
      <p className="mt-1 text-sm text-slate-600">Active bookings waiting to come back. Log the condition to complete the return.</p>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search reference, customer or equipment"
        className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />

      {result && <ResultNotice result={result} onClose={() => setResult(null)} />}
      {isLoading && <p className="mt-6 text-sm text-slate-500">Loading...</p>}
      {error && <p role="alert" className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">Bookings could not be loaded.</p>}
      {data && data.items.length === 0 && <p className="mt-6 text-sm text-slate-600">No active bookings.</p>}

      <ul className="mt-6 space-y-3">
        {data?.items.map((b) => (
          <li key={b.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{b.equipment.name} <span className="text-sm font-normal text-slate-500">({b.unitTag})</span></p>
                <p className="text-sm text-slate-600">{b.customer.name} · {b.customer.email}</p>
                <p className="text-xs text-slate-500">{b.reference} · due {formatDateTime(b.endAt)}</p>
              </div>
              <button
                onClick={() => setOpenId(openId === b.id ? null : b.id)}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
              >
                {openId === b.id ? 'Close' : 'Process return'}
              </button>
            </div>
            {openId === b.id && (
              <ReturnForm
                booking={b}
                onDone={(r) => {
                  setResult(r);
                  setOpenId(null);
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReturnForm({ booking, onDone }: { booking: Booking; onDone: (r: ReturnResult) => void }) {
  const queryClient = useQueryClient();
  const [condition, setCondition] = useState<Condition>('GOOD');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: ['returns', 'preview', booking.id, condition],
    queryFn: () => returnsApi.preview(booking.id, condition),
  });

  const submit = useMutation({
    mutationFn: () => returnsApi.process({ bookingId: booking.id, condition, notes: notes.trim() || undefined }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      onDone(r);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'The return could not be processed.'),
  });

  const p = preview.data;
  return (
    <div className="mt-4 space-y-4 rounded-lg bg-slate-50 p-4">
      <fieldset>
        <legend className="text-sm font-medium">Condition of the returned item</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {CONDITIONS.map((c) => (
            <label
              key={c}
              className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${condition === c ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-slate-300 bg-white'}`}
            >
              <input type="radio" name={`cond-${booking.id}`} className="sr-only" checked={condition === c} onChange={() => setCondition(c)} />
              {conditionLabel[c]}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block text-sm font-medium">
        Notes (optional)
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          rows={2}
          className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
        {preview.isLoading && <p className="text-slate-500">Calculating...</p>}
        {p && (
          <dl className="space-y-1">
            <Row label={p.daysLate > 0 ? `Late fee (${p.daysLate} day${p.daysLate === 1 ? '' : 's'} late)` : 'Late fee (on time)'} value={formatPaise(p.lateFeePaise)} />
            <Row label={`Damage penalty (${p.damagePenaltyPct}% of ${formatPaise(p.itemValuePaise)})`} value={formatPaise(p.damagePenaltyPaise)} />
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold">
              <dt>Charged to customer</dt>
              <dd>{formatPaise(p.totalPaise)}</dd>
            </div>
            <p className="pt-1 text-xs text-slate-500">
              {p.unitStatusAfter === 'RETIRED'
                ? 'The unit will be retired.'
                : p.unitStatusAfter === 'UNDER_MAINTENANCE'
                  ? `The unit will go to the maintenance queue (${p.maintenanceTrigger === 'DAMAGE' ? 'damage' : 'rental interval reached'}).`
                  : 'The unit goes back to available.'}
            </p>
          </dl>
        )}
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <button
        disabled={submit.isPending || preview.isLoading}
        onClick={() => {
          setError(null);
          submit.mutate();
        }}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {submit.isPending ? 'Saving...' : 'Complete return'}
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-600">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ResultNotice({ result, onClose }: { result: ReturnResult; onClose: () => void }) {
  const total = result.lateFeePaise + result.damagePenaltyPaise;
  return (
    <div role="status" className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900">
      <div className="flex justify-between gap-3">
        <p className="font-medium">
          {result.booking.reference} returned ({conditionLabel[result.returnRecord.condition]}).
          {total > 0 ? ` ${formatPaise(total)} added to the customer's payments.` : ' No extra charges.'}
        </p>
        <button onClick={onClose} className="text-emerald-700 hover:underline">Dismiss</button>
      </div>
      <p className="mt-1">
        Unit {result.unit.tag} is now {result.unit.status.replace('_', ' ').toLowerCase()}.
        {result.upcomingBookingsMoved > 0 && ` ${result.upcomingBookingsMoved} upcoming booking(s) moved to another unit.`}
      </p>
      {result.upcomingBookingsNeedingAttention > 0 && (
        <p className="mt-1 font-medium text-amber-800">
          {result.upcomingBookingsNeedingAttention} upcoming booking(s) could not be moved to another unit and need attention.
        </p>
      )}
    </div>
  );
}
