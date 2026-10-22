import { useQuery } from '@tanstack/react-query';
import { getHealth } from '../api/client';
import StatusPill from '../components/StatusPill';

export default function Home() {
  const health = useQuery({ queryKey: ['health'], queryFn: getHealth, refetchInterval: 15_000 });
  const d = health.data;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold tracking-tight">Equipment Rental &amp; Maintenance</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Foundation is running.
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">System status</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <Row label="API">
            {health.isLoading ? (
              <StatusPill tone="wait">Checking…</StatusPill>
            ) : d ? (
              <StatusPill tone={d.status === 'ok' ? 'ok' : 'bad'}>{d.status === 'ok' ? 'Online' : 'Degraded'}</StatusPill>
            ) : (
              <StatusPill tone="bad">Unreachable</StatusPill>
            )}
          </Row>
          <Row label="Database">
            {d ? <StatusPill tone={d.database === 'up' ? 'ok' : 'bad'}>{d.database === 'up' ? 'Connected' : 'Down'}</StatusPill> : <StatusPill tone="wait">—</StatusPill>}
          </Row>
          <Row label="Policy config">
            {d ? <StatusPill tone={d.policyConfig === 'loaded' ? 'ok' : 'bad'}>{d.policyConfig === 'loaded' ? 'Loaded' : 'Unavailable'}</StatusPill> : <StatusPill tone="wait">—</StatusPill>}
          </Row>
        </dl>
        {health.isError && (
          <p className="mt-4 text-sm text-red-600">
            Can't reach the API. Make sure the server is running (<code>npm run dev</code>).
          </p>
        )}
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
