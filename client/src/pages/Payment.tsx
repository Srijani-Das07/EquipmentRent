import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { ApiError } from '../api/client';
import { formatPaise } from '../api/inventory';
import { chargeLabel, formatDateTime, paymentsApi, type PayInput } from '../api/bookings';
import Field from '../components/Field';

type Method = 'UPI' | 'CARD';

export default function Payment() {
  const { chargeId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<Method>('UPI');
  const [card, setCard] = useState({ cardNumber: '', expiry: '', cvv: '', name: '' });
  const [failure, setFailure] = useState<string | null>(null);

  const { data: charge, isLoading, error } = useQuery({
    queryKey: ['payments', 'charge', chargeId],
    queryFn: () => paymentsApi.charge(chargeId),
  });

  const pay = useMutation({
    mutationFn: (input: PayInput) => paymentsApi.pay(chargeId, input),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      if (result.status === 'SUCCESS' && result.receiptId) {
        navigate(`/receipts/${result.receiptId}`);
      } else {
        setFailure(result.failureReason ?? 'The payment failed.');
      }
    },
    onError: (e) => setFailure(e instanceof ApiError ? e.message : 'The payment could not be processed.'),
  });

  if (isLoading) return <p className="mx-auto max-w-xl px-4 py-8 text-sm text-slate-500">Loading...</p>;
  if (error || !charge) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">This charge could not be found.</p>
        <Link to="/payments" className="mt-4 inline-block text-sm text-brand-700 hover:underline">Back to payments</Link>
      </div>
    );
  }

  if (charge.status !== 'PENDING') {
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <p className="rounded-lg bg-slate-100 p-4 text-sm text-slate-700">
          This charge is {charge.status.toLowerCase()} and cannot be paid.
        </p>
        <Link to="/my-bookings" className="mt-4 inline-block text-sm text-brand-700 hover:underline">Back to my bookings</Link>
      </div>
    );
  }

  const upiLink = `upi://pay?pa=equipmentrental@mockbank&pn=Equipment%20Rental&am=${(charge.amountPaise / 100).toFixed(2)}&cu=INR&tn=${charge.booking.reference}`;
  const setField = (k: keyof typeof card) => (e: React.ChangeEvent<HTMLInputElement>) => setCard({ ...card, [k]: e.target.value });

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <Link to={`/my-bookings/${charge.booking.id}`} className="text-sm text-brand-700 hover:underline">Back to booking</Link>
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Pay {formatPaise(charge.amountPaise)}</h1>
        <p className="mt-1 text-sm text-slate-600">{chargeLabel[charge.type]} for {charge.booking.equipmentName} ({charge.booking.reference})</p>
        {charge.booking.status === 'PENDING' && charge.booking.holdExpiresAt && (
          <p className="mt-2 text-sm text-amber-700">Held until {formatDateTime(charge.booking.holdExpiresAt)}.</p>
        )}
        <p className="mt-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-500">
          This is a practice gateway. No real money moves and no real card is needed.
        </p>

        <div className="mt-5 flex gap-2" role="tablist">
          {(['UPI', 'CARD'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={method === m}
              onClick={() => { setMethod(m); setFailure(null); }}
              className={`rounded-lg px-4 py-2 text-sm font-medium ${method === m ? 'bg-brand-600 text-white' : 'border border-slate-300 hover:bg-slate-50'}`}
            >
              {m === 'UPI' ? 'UPI' : 'Card'}
            </button>
          ))}
        </div>

        {failure && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{failure} You can try again.</p>}

        {method === 'UPI' ? (
          <div className="mt-5 text-center">
            <div className="inline-block rounded-lg border border-slate-200 bg-white p-3">
              <QRCodeSVG value={upiLink} size={168} />
            </div>
            <p className="mt-2 text-xs text-slate-500">Scan with any UPI app (sample QR).</p>
            <div className="mt-4 flex justify-center gap-3">
              <button disabled={pay.isPending} onClick={() => { setFailure(null); pay.mutate({ method: 'UPI', outcome: 'SUCCESS' }); }} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                Simulate success
              </button>
              <button disabled={pay.isPending} onClick={() => { setFailure(null); pay.mutate({ method: 'UPI', outcome: 'FAILURE' }); }} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">
                Simulate failure
              </button>
            </div>
          </div>
        ) : (
          <form
            className="mt-5 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setFailure(null);
              pay.mutate({ method: 'CARD', ...card });
            }}
          >
            <Field label="Card number" name="cardNumber" inputMode="numeric" autoComplete="off" placeholder="4111 1111 1111 1111" value={card.cardNumber} onChange={setField('cardNumber')} required />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Expiry (MM/YY)" name="expiry" placeholder="12/30" autoComplete="off" value={card.expiry} onChange={setField('expiry')} required />
              <Field label="CVV" name="cvv" inputMode="numeric" type="password" autoComplete="off" maxLength={4} value={card.cvv} onChange={setField('cvv')} required />
            </div>
            <Field label="Name on card" name="name" autoComplete="off" value={card.name} onChange={setField('name')} required />
            <button disabled={pay.isPending} className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {pay.isPending ? 'Processing...' : `Pay ${formatPaise(charge.amountPaise)}`}
            </button>
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <p className="font-medium">Test cards</p>
              <ul className="mt-1 space-y-0.5">
                <li>4111 1111 1111 1111 (Visa): succeeds</li>
                <li>5555 5555 5555 4444 (Mastercard): succeeds</li>
                <li>4000 0000 0000 0002: declined</li>
                <li>4000 0000 0000 9995: insufficient funds</li>
              </ul>
              <p className="mt-1">Use any future expiry and any 3 digit CVV.</p>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
