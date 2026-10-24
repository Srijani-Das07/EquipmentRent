import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { formatPaise } from '../api/inventory';
import { bookingsApi, formatDateTime, toDateInput, type AlternativeWindow } from '../api/bookings';
import AvailabilityCalendar from './AvailabilityCalendar';

const addDaysLocal = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toDateInput(d);
};

/** Calendar, date pickers, live quote and the Book button, shown on the equipment page. */
export default function BookingPanel({ equipmentId }: { equipmentId: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tomorrow = addDaysLocal(toDateInput(new Date()), 1);
  const [startDate, setStartDate] = useState(tomorrow);
  const [endDate, setEndDate] = useState(addDaysLocal(tomorrow, 1));
  const [alternatives, setAlternatives] = useState<AlternativeWindow[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const isCustomer = user?.role === 'CUSTOMER';
  const range = { equipmentId, startDate, endDate };
  const validRange = endDate > startDate;

  const quote = useQuery({
    queryKey: ['bookings', 'quote', equipmentId, startDate, endDate],
    queryFn: () => bookingsApi.quote(range),
    enabled: isCustomer && validRange,
    retry: false,
  });

  const book = useMutation({
    mutationFn: () => bookingsApi.create(range),
    onSuccess: (booking) => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      navigate(`/my-bookings/${booking.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        const alts = (err.details as { alternatives?: AlternativeWindow[] } | undefined)?.alternatives ?? [];
        setAlternatives(alts);
      }
      setMessage(err instanceof ApiError ? err.message : 'The booking could not be created.');
    },
  });

  function pick(date: string) {
    setStartDate(date);
    if (endDate <= date) setEndDate(addDaysLocal(date, 1));
    setAlternatives([]);
    setMessage(null);
  }

  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Book this equipment</h2>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <AvailabilityCalendar equipmentId={equipmentId} onPick={pick} />

        <div>
          {!user && (
            <p className="text-sm text-slate-600">
              <Link to="/login" className="text-brand-700 hover:underline">Log in</Link> as a customer to book.
            </p>
          )}
          {user && !isCustomer && <p className="text-sm text-slate-600">Only customer accounts can make bookings.</p>}

          {isCustomer && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-medium text-slate-700">
                  Pickup date
                  <input
                    type="date"
                    min={tomorrow}
                    value={startDate}
                    onChange={(e) => pick(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Return date
                  <input
                    type="date"
                    min={addDaysLocal(startDate, 1)}
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      setAlternatives([]);
                      setMessage(null);
                    }}
                    className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>

              {!validRange && <p className="text-sm text-red-700">The return date must be after the pickup date.</p>}
              {quote.isLoading && <p className="text-sm text-slate-500">Checking availability...</p>}
              {quote.error && (
                <p role="alert" className="text-sm text-red-700">
                  {quote.error instanceof ApiError ? quote.error.message : 'The price could not be calculated.'}
                </p>
              )}

              {quote.data && (
                <div className="rounded-lg bg-slate-50 p-3 text-sm">
                  <p>
                    {quote.data.days} day(s) x {formatPaise(quote.data.dailyRatePaise)}
                  </p>
                  <p className="text-lg font-semibold text-brand-700">{formatPaise(quote.data.costPaise)}</p>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(quote.data.startAt)} to {formatDateTime(quote.data.endAt)}
                  </p>
                  {!quote.data.available && (
                    <div className="mt-2 text-red-700">
                      <p>No unit is free for these dates.</p>
                      {quote.data.alternatives.length > 0 && (
                        <AlternativeList items={quote.data.alternatives} onPick={(a) => { setStartDate(a.startDate); setEndDate(a.endDate); }} />
                      )}
                    </div>
                  )}
                </div>
              )}

              {message && (
                <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  {message}
                </p>
              )}
              {alternatives.length > 0 && (
                <AlternativeList items={alternatives} onPick={(a) => { setStartDate(a.startDate); setEndDate(a.endDate); setMessage(null); setAlternatives([]); }} />
              )}

              <button
                type="button"
                disabled={!quote.data?.available || book.isPending}
                onClick={() => {
                  setMessage(null);
                  book.mutate();
                }}
                className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {book.isPending ? 'Booking...' : 'Book and continue to payment'}
              </button>
              <p className="text-xs text-slate-500">
                Your booking is held for a short time while you pay. It is confirmed only after payment succeeds.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function AlternativeList({ items, onPick }: { items: AlternativeWindow[]; onPick: (a: AlternativeWindow) => void }) {
  return (
    <div className="mt-2 text-sm text-slate-700">
      <p className="font-medium">Available instead:</p>
      <ul className="mt-1 flex flex-wrap gap-2">
        {items.map((a) => (
          <li key={a.startDate}>
            <button type="button" onClick={() => onPick(a)} className="rounded-full border border-brand-500 px-3 py-1 text-xs text-brand-700 hover:bg-brand-50">
              {a.startDate} to {a.endDate}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
