export default function UpcomingCard({
  title,
  description,
}: {
  title: string;
  description: string;
  module?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
    </div>
  );
}