import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bookingsApi } from '../api/bookings';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function shiftMonth(month: string, delta: number): string {
  const [y = 0, m = 1] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Month view of how many units are free each day. Clicking a free day picks it as the pickup date. */
export default function AvailabilityCalendar({
  equipmentId,
  onPick,
}: {
  equipmentId: string;
  onPick?: (date: string) => void;
}) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const { data, isLoading, error } = useQuery({
    queryKey: ['bookings', 'calendar', equipmentId, month],
    queryFn: () => bookingsApi.calendar(equipmentId, month),
  });

  const first = new Date(`${month}-01T00:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7; // Monday first

  return (
    <div>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} className="rounded px-2 py-1 text-sm hover:bg-slate-100" aria-label="Previous month">
          &lt;
        </button>
        <span className="text-sm font-medium">
          {first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
        </span>
        <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} className="rounded px-2 py-1 text-sm hover:bg-slate-100" aria-label="Next month">
          &gt;
        </button>
      </div>

      {isLoading && <p className="mt-3 text-sm text-slate-500">Loading...</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">The calendar could not be loaded.</p>}

      {data && (
        <>
          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs text-slate-500">
            {WEEKDAYS.map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {Array.from({ length: offset }, (_, i) => (
              <div key={`pad-${i}`} />
            ))}
            {data.days.map((day) => {
              const past = day.date < data.today;
              const full = day.free === 0;
              const disabled = past || full;
              return (
                <button
                  key={day.date}
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick?.(day.date)}
                  title={past ? 'Past' : full ? 'Fully booked' : `${day.free} free`}
                  className={`rounded-md py-1.5 text-xs ${
                    past
                      ? 'text-slate-300'
                      : full
                        ? 'bg-red-50 text-red-600 line-through'
                        : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  }`}
                >
                  {Number(day.date.slice(8))}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Green: units free. Red: fully booked. {data.totalUnits} bookable unit(s).
          </p>
        </>
      )}
    </div>
  );
}
