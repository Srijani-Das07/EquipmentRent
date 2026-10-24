import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { chargeLabel, formatDateTime, paymentsApi } from '../api/bookings';

/** Printable receipt. The browser's Print dialog doubles as "Save as PDF". */
export default function Receipt() {
  const { id = '' } = useParams();
  const { data, isLoading, error } = useQuery({ queryKey: ['payments', 'receipt', id], queryFn: () => paymentsApi.receipt(id) });

  if (isLoading) return <p className="mx-auto max-w-xl px-4 py-8 text-sm text-slate-500">Loading...</p>;
  if (error || !data) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">This receipt could not be found.</p>
        <Link to="/payments" className="mt-4 inline-block text-sm text-brand-700 hover:underline">Back to payments</Link>
      </div>
    );
  }

  const p = data.payload;
  const refund = p.kind === 'REFUND';
  const method =
    p.payment.method === 'CARD' ? `${p.payment.cardBrand ?? 'Card'} ending ${p.payment.cardLast4 ?? ''}` : `UPI ${p.payment.upiRef ?? ''}`.trim();

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link to="/payments" className="text-sm text-brand-700 hover:underline">Back to payments</Link>
        <button onClick={() => window.print()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
          Print or save as PDF
        </button>
      </div>

      <article className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm print:border-0 print:shadow-none">
        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">{refund ? 'Refund receipt' : 'Payment receipt'}</h1>
            <p className="text-sm text-slate-500">Equipment Rental & Maintenance</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">{p.receiptNumber}</p>
            <p className="text-slate-500">{formatDateTime(p.issuedAt)}</p>
          </div>
        </header>

        <dl className="mt-6 space-y-3 text-sm">
          <Row label="Customer" value={`${p.customer.name} (${p.customer.email})`} />
          <Row label="Booking" value={p.booking.reference} />
          <Row label="Equipment" value={`${p.booking.equipment} (${p.booking.unitTag})`} />
          <Row label="Rental period" value={`${formatDateTime(p.booking.startAt)} to ${formatDateTime(p.booking.endAt)} (${p.booking.days} day${p.booking.days === 1 ? '' : 's'})`} />
          <Row label="For" value={`${chargeLabel[p.charge.type]}: ${p.charge.description}`} />
          <Row label="Method" value={method} />
          <Row label="Reference" value={p.payment.reference} />
        </dl>

        <div className="mt-6 flex items-center justify-between border-t border-slate-200 pt-4">
          <span className="font-medium">{refund ? 'Amount refunded' : 'Amount paid'}</span>
          <span className="text-xl font-semibold">{p.payment.amountText}</span>
        </div>
      </article>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
