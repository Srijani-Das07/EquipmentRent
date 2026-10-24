import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { inventoryApi, formatPaise } from '../api/inventory';
import StatusPill from '../components/StatusPill';
import BookingPanel from '../components/BookingPanel';

export default function EquipmentDetail() {
  const { id = '' } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['inventory', 'equipment', id],
    queryFn: () => inventoryApi.get(id),
  });

  if (isLoading) return <p className="mx-auto max-w-3xl px-4 py-8 text-sm text-slate-500">Loading...</p>;

  if (error || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
          {notFound ? 'This equipment is not available.' : 'The equipment could not be loaded.'}
        </p>
        <Link to="/catalog" className="mt-4 inline-block text-sm text-brand-700 hover:underline">
          Back to catalog
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link to="/catalog" className="text-sm text-brand-700 hover:underline">
        Back to catalog
      </Link>
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{data.category.name}</span>
        <h1 className="mt-1 text-2xl font-semibold">{data.name}</h1>
        <p className="mt-3 whitespace-pre-line text-slate-700">{data.description || 'No description provided.'}</p>

        <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-slate-500">Rate</dt>
            <dd className="mt-0.5 text-lg font-semibold text-brand-700">{formatPaise(data.dailyRatePaise)} / day</dd>
          </div>
          <div>
            <dt className="text-slate-500">Availability</dt>
            <dd className="mt-1">
              {data.availableUnits > 0 ? (
                <StatusPill tone="ok">
                  {data.availableUnits} of {data.totalUnits} available
                </StatusPill>
              ) : (
                <StatusPill tone="bad">Currently unavailable</StatusPill>
              )}
            </dd>
          </div>
        </dl>
      </div>

      <BookingPanel equipmentId={data.id} />
    </div>
  );
}
