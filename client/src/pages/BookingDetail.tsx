import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { formatPaise } from '../api/inventory';
import {
  bookingsApi,
  chargeLabel,
  formatDateTime,
  statusTone,
  toDateInput,
  type AlternativeWindow,
} from '../api/bookings';
import StatusPill from '../components/StatusPill';

export default function BookingDetail() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [showCancel, setShowCancel] = useState(false);
  const [showModify, setShowModify] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<AlternativeWindow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const { data: booking, isLoading, error: loadError } = useQuery({
    queryKey: ['bookings', 'detail', id],
    queryFn: () => bookingsApi.get(id),
    refetchInterval: (q) => (q.state.data?.status === 'PENDING' ? 15_000 : false),
  });

  const preview = useQuery({
    queryKey: ['bookings', 'cancel-preview', id],
    queryFn: () => bookingsApi.cancelPreview(id),
    enabled: showCancel,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['bookings'] });

  const cancel = useMutation({
    mutationFn: () => bookingsApi.cancel(id),
    onSuccess: (res) => {
      setShowCancel(false);
      setNotice(
        res.cancellation.feePaise > 0
          ? `Cancelled. A fee of ${formatPaise(res.cancellation.feePaise)} was kept and ${formatPaise(res.cancellation.refundPaise)} was refunded.`
          : res.cancellation.refundPaise > 0
            ? `Cancelled. ${formatPaise(res.cancellation.refundPaise)} was refunded.`
            : 'Cancelled.',
      );
      refresh();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not cancel the booking.'),
  });

  const modify = useMutation({
    mutationFn: () => bookingsApi.modify(id, { startDate, endDate }),
    onSuccess: () => {
      setShowModify(false);
      setAlternatives([]);
      setNotice('Dates updated.');
      refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        setAlternatives((e.details as { alternatives?: AlternativeWindow[] } | undefined)?.alternatives ?? []);
      }
      setError(e instanceof ApiError ? e.message : 'Could not change the dates.');
    },
  });

  if (isLoading) return <p className="mx-auto max-w-3xl px-4 py-8 text-sm text-slate-500">Loading...</p>;
  if (loadError || !booking) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">This booking could not be found.</p>
        <Link to="/my-bookings" className="mt-4 inline-block text-sm text-brand-700 hover:underline">Back to my bookings</Link>
      </div>
    );
  }

  const pendingCharges = booking.charges.filter((c) => c.status === 'PENDING');

  function openModify() {
    if (!booking) return;
    setStartDate(toDateInput(new Date(booking.startAt)));
    setEndDate(toDateInput(new Date(booking.endAt)));
    setError(null);
    setAlternatives([]);
    setShowModify(true);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link to="/my-bookings" className="text-sm text-brand-700 hover:underline">Back to my bookings</Link>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">{booking.equipment.name}</h1>
          <StatusPill tone={statusTone(booking.status)}>{booking.status.charAt(0) + booking.status.slice(1).toLowerCase()}</StatusPill>
        </div>
        <p className="mt-1 text-sm text-slate-500">{booking.reference}</p>

        <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-slate-500">Pickup</dt><dd>{formatDateTime(booking.startAt)}</dd></div>
          <div><dt className="text-slate-500">Return</dt><dd>{formatDateTime(booking.endAt)}</dd></div>
          <div><dt className="text-slate-500">Duration</dt><dd>{booking.rentalDays} day(s) at {formatPaise(booking.dailyRatePaise)}</dd></div>
          <div><dt className="text-slate-500">Booking cost</dt><dd className="font-semibold">{formatPaise(booking.costPaise)}</dd></div>
          <div><dt className="text-slate-500">Unit</dt><dd>{booking.unitTag}</dd></div>
        </dl>

        {booking.status === 'PENDING' && booking.holdExpiresAt && (
          <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            Held for you until {formatDateTime(booking.holdExpiresAt)}. Pay before then or the booking is released.
          </p>
        )}
        {notice && <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-semibold">Charges</h2>
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {booking.charges.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <p className="font-medium">{chargeLabel[c.type]}</p>
                <p className="text-xs text-slate-500">{c.description}</p>
              </div>
              <div className="flex items-center gap-3">
                <span>{formatPaise(c.amountPaise)}</span>
                <StatusPill tone={c.status === 'PAID' ? 'ok' : c.status === 'PENDING' ? 'wait' : 'bad'}>{c.status.toLowerCase()}</StatusPill>
                {c.status === 'PENDING' && (
                  <Link to={`/pay/${c.id}`} className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-700">Pay</Link>
                )}
              </div>
            </li>
          ))}
        </ul>
        {pendingCharges.length === 0 && booking.charges.some((c) => c.status === 'PAID') && (
          <Link to="/payments" className="mt-3 inline-block text-sm text-brand-700 hover:underline">View receipts</Link>
        )}
      </section>

      {booking.canChange && (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold">Change or cancel</h2>
          <p className="mt-1 text-sm text-slate-600">
            Free until 24 hours before pickup. After that a late fee applies.
          </p>
          <div className="mt-3 flex gap-3">
            <button onClick={openModify} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">Change dates</button>
            <button
              onClick={() => {
                setError(null);
                setShowCancel(true);
              }}
              className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Cancel booking
            </button>
          </div>

          {showModify && (
            <div className="mt-4 space-y-3 rounded-lg bg-slate-50 p-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-medium">Pickup date
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                </label>
                <label className="block text-sm font-medium">Return date
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                </label>
              </div>
              {alternatives.length > 0 && (
                <div className="text-sm">
                  <p className="font-medium">Available instead:</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {alternatives.map((a) => (
                      <button key={a.startDate} type="button" onClick={() => { setStartDate(a.startDate); setEndDate(a.endDate); setError(null); setAlternatives([]); }} className="rounded-full border border-brand-500 px-3 py-1 text-xs text-brand-700">
                        {a.startDate} to {a.endDate}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <button disabled={modify.isPending} onClick={() => { setError(null); modify.mutate(); }} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {modify.isPending ? 'Saving...' : 'Save new dates'}
                </button>
                <button onClick={() => setShowModify(false)} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">Close</button>
              </div>
            </div>
          )}

          {showCancel && (
            <div className="mt-4 space-y-3 rounded-lg bg-red-50 p-4 text-sm">
              {preview.isLoading && <p>Checking what cancelling would cost...</p>}
              {preview.data && (
                <p>
                  {preview.data.feePaise > 0
                    ? `Cancelling now costs a late fee of ${formatPaise(preview.data.feePaise)} (${preview.data.lateCancellationFeePct}%). You would be refunded ${formatPaise(preview.data.refundPaise)}.`
                    : preview.data.refundPaise > 0
                      ? `Cancelling is free. You would be refunded ${formatPaise(preview.data.refundPaise)}.`
                      : 'Cancelling is free. Nothing has been paid.'}
                </p>
              )}
              <div className="flex gap-2">
                <button disabled={cancel.isPending || preview.isLoading} onClick={() => cancel.mutate()} className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-50">
                  {cancel.isPending ? 'Cancelling...' : 'Confirm cancellation'}
                </button>
                <button onClick={() => setShowCancel(false)} className="rounded-lg px-4 py-2 text-slate-600 hover:bg-red-100">Keep booking</button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
