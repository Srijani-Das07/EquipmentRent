import { Link } from 'react-router-dom';

/** A dashboard card. Without `to` it is a placeholder for a feature that is not built yet. */
export default function UpcomingCard({
  title,
  description,
  to,
}: {
  title: string;
  description: string;
  to?: string;
  module?: string;
}) {
  const body = (
    <>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
    </>
  );

  if (to) {
    return (
      <Link
        to={to}
        className="block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-500 hover:shadow"
      >
        {body}
      </Link>
    );
  }
  return <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5">{body}</div>;
}