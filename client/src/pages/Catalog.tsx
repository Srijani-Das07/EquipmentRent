import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { inventoryApi, formatPaise } from '../api/inventory';
import StatusPill from '../components/StatusPill';

export default function Catalog() {
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [page, setPage] = useState(1);

  // Wait for a short pause in typing before querying the API.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchText]);

  const categories = useQuery({ queryKey: ['inventory', 'categories'], queryFn: inventoryApi.categories });
  const list = useQuery({
    queryKey: ['inventory', 'catalog', { search, categoryId, availableOnly, page }],
    queryFn: () => inventoryApi.list({ search, categoryId, availableOnly, page, pageSize: 12 }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Equipment catalog</h1>
      <p className="mt-1 text-sm text-slate-600">Browse equipment available to rent.</p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search equipment"
          aria-label="Search equipment"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 sm:max-w-sm"
        />
        <select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by category"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
        >
          <option value="">All categories</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.equipmentCount ?? 0})
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={availableOnly}
            onChange={(e) => {
              setAvailableOnly(e.target.checked);
              setPage(1);
            }}
          />
          Available only
        </label>
      </div>

      {list.isError && (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          The catalog could not be loaded. Please try again.
        </p>
      )}

      {list.isLoading && <p className="mt-8 text-sm text-slate-500">Loading equipment...</p>}

      {list.data && list.data.items.length === 0 && (
        <p className="mt-8 rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No equipment matches your search.
        </p>
      )}

      {list.data && list.data.items.length > 0 && (
        <>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.data.items.map((e) => (
              <li key={e.id}>
                <Link
                  to={`/catalog/${e.id}`}
                  className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-500 hover:shadow"
                >
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{e.category.name}</span>
                  <span className="mt-1 text-lg font-semibold">{e.name}</span>
                  <span className="mt-2 line-clamp-2 flex-1 text-sm text-slate-600">{e.description}</span>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="font-semibold text-brand-700">{formatPaise(e.dailyRatePaise)} / day</span>
                    {e.availableUnits > 0 ? (
                      <StatusPill tone="ok">{e.availableUnits} available</StatusPill>
                    ) : (
                      <StatusPill tone="bad">Unavailable</StatusPill>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <nav className="mt-8 flex items-center justify-between text-sm" aria-label="Pagination">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-slate-600">
              Page {list.data.page} of {list.data.totalPages} ({list.data.total} items)
            </span>
            <button
              type="button"
              disabled={page >= list.data.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40"
            >
              Next
            </button>
          </nav>
        </>
      )}
    </div>
  );
}