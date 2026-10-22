const styles = {
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  bad: 'bg-red-50 text-red-700 ring-red-600/20',
  wait: 'bg-slate-100 text-slate-600 ring-slate-500/20',
} as const;

export default function StatusPill({ tone, children }: { tone: keyof typeof styles; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${styles[tone]}`}>
      {children}
    </span>
  );
}
