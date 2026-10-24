import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatPaise } from '../api/inventory';
import { chargeLabel, formatDateTime, paymentsApi } from '../api/bookings';
import StatusPill from '../components/StatusPill';

export default function PaymentsPage() {
  const charges = useQuery({ queryKey: ['payments', 'charges', 'PENDING'], queryFn: () => paymentsApi.charges('PENDING') });
  const receipts = useQuery({ queryKey: ['payments', 'receipts'], queryFn: paymentsApi.receipts });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Payments and receipts</h1>

      <section className="mt-6">
        <h2 className="font-semibold">Outstanding charges</h2>
        {charges.isLoading && <p className="mt-2 text-sm text-slate-500">Loading...</p>}
        {charges.data?.length === 0 && <p className="mt-2 text-sm text-slate-600">Nothing to pay right now.</p>}
        <ul className="mt-3 space-y-3">
          {charges.data?.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div>
                <p className="font-medium">{chargeLabel[c.type]}: {c.booking.equipmentName}</p>
                <p className="text-xs text-slate-500">{c.booking.reference}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold">{formatPaise(c.amountPaise)}</span>
                <Link to={`/pay/${c.id}`} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700">Pay</Link>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold">Receipts</h2>
        {receipts.isLoading && <p className="mt-2 text-sm text-slate-500">Loading...</p>}
        {receipts.data?.length === 0 && <p className="mt-2 text-sm text-slate-600">No receipts yet.</p>}
        <ul className="mt-3 space-y-3">
          {receipts.data?.map((r) => (
            <li key={r.id}>
              <Link to={`/receipts/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-500">
                <div>
                  <p className="font-medium">{r.receiptNumber}</p>
                  <p className="text-xs text-slate-500">{formatDateTime(r.issuedAt)} · {r.method}</p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill tone={r.kind === 'REFUND' ? 'wait' : 'ok'}>{r.kind === 'REFUND' ? 'Refund' : 'Payment'}</StatusPill>
                  <span className="font-semibold">{formatPaise(r.amountPaise)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
