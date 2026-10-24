import { useEffect, useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  inventoryApi,
  formatPaise,
  rupeesToPaise,
  statusLabel,
  type Equipment,
  type UnitStatus,
} from '../api/inventory';
import StatusPill from '../components/StatusPill';
import { CategoryManager, DeleteEquipmentButton } from './InventoryAdminParts';

type Mode = 'staff' | 'admin';

const input =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';
const primaryBtn =
  'rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50';
const ghostBtn = 'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50';

const errorText = (err: unknown) => {
  if (err instanceof ApiError) {
    const first = Array.isArray(err.details) ? (err.details[0] as { message?: string } | undefined)?.message : undefined;
    return first ?? err.message;
  }
  return 'Something went wrong. Please try again.';
};

export default function InventoryManager({ mode }: { mode: Mode }) {
  const isAdmin = mode === 'admin';
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['inventory'] });

  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [archived, setArchived] = useState<'active' | 'archived' | 'all'>('active');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Equipment | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchText]);

  const categories = useQuery({ queryKey: ['inventory', 'categories'], queryFn: inventoryApi.categories });
  const list = useQuery({
    queryKey: ['inventory', 'manage', { search, categoryId, archived, page }],
    queryFn: () => inventoryApi.manageList({ search, categoryId, archived, page, pageSize: 10 }),
    placeholderData: keepPreviousData,
  });

  const archive = useMutation({
    mutationFn: (e: Equipment) => inventoryApi.update(e.id, { archived: !e.archived }),
    onSuccess: refresh,
  });

  if (list.error instanceof ApiError && (list.error.status === 401 || list.error.status === 403)) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
          You do not have access to inventory management.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Inventory</h1>
          <p className="mt-1 text-sm text-slate-600">
            {isAdmin
              ? 'Manage categories, equipment and physical units.'
              : 'View equipment and update the status of physical units.'}
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            className={primaryBtn}
            onClick={() => {
              setEditing(null);
              setShowForm((s) => !s);
            }}
          >
            {showForm && !editing ? 'Close form' : 'Add equipment'}
          </button>
        )}
      </div>

      {isAdmin && <CategoryManager onChanged={refresh} />}

      {isAdmin && showForm && (
        <EquipmentForm
          key={editing?.id ?? 'new'}
          editing={editing}
          categories={categories.data ?? []}
          onDone={() => {
            setShowForm(false);
            setEditing(null);
            refresh();
          }}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search equipment"
          aria-label="Search equipment"
          className={`${input} sm:max-w-xs`}
        />
        <select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by category"
          className={`${input} sm:max-w-xs`}
        >
          <option value="">All categories</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={archived}
          onChange={(e) => {
            setArchived(e.target.value as typeof archived);
            setPage(1);
          }}
          aria-label="Filter by archived state"
          className={`${input} sm:max-w-[11rem]`}
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
      </div>

      {archive.isError && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {errorText(archive.error)}
        </p>
      )}
      {list.isLoading && <p className="mt-6 text-sm text-slate-500">Loading inventory...</p>}
      {list.isError && !list.isLoading && (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          The inventory could not be loaded.
        </p>
      )}

      {list.data && (
        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Equipment</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Rate / day</th>
                <th className="px-4 py-3">Units</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.data.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No equipment found.
                  </td>
                </tr>
              )}
              {list.data.items.map((e) => (
                <EquipmentRows
                  key={e.id}
                  equipment={e}
                  isAdmin={isAdmin}
                  open={openId === e.id}
                  onToggle={() => setOpenId(openId === e.id ? null : e.id)}
                  onEdit={() => {
                    setEditing(e);
                    setShowForm(true);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  onArchive={() => archive.mutate(e)}
                  archiving={archive.isPending}
                  onChanged={refresh}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {list.data && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
          <button type="button" className={ghostBtn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span className="text-slate-600">
            Page {list.data.page} of {list.data.totalPages} ({list.data.total} items)
          </span>
          <button
            type="button"
            className={ghostBtn}
            disabled={page >= list.data.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}

// ---- table rows with the expandable unit list ----------------------------------

function EquipmentRows(props: {
  equipment: Equipment;
  isAdmin: boolean;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onArchive: () => void;
  archiving: boolean;
  onChanged: () => void;
}) {
  const { equipment: e, isAdmin, open } = props;
  return (
    <>
      <tr className={e.archived ? 'bg-slate-50 text-slate-500' : ''}>
        <td className="px-4 py-3 font-medium">
          {e.name} {e.archived && <StatusPill tone="wait">Archived</StatusPill>}
        </td>
        <td className="px-4 py-3">{e.category.name}</td>
        <td className="px-4 py-3">{formatPaise(e.dailyRatePaise)}</td>
        <td className="px-4 py-3">
          {e.unitCounts.available} available / {e.unitCounts.total} in service
        </td>
        <td className="px-4 py-3">
          <div className="flex justify-end gap-2">
            <button type="button" className={ghostBtn} onClick={props.onToggle} aria-expanded={open}>
              {open ? 'Hide units' : 'Units'}
            </button>
            {isAdmin && (
              <>
                <button type="button" className={ghostBtn} onClick={props.onEdit}>
                  Edit
                </button>
                <button type="button" className={ghostBtn} disabled={props.archiving} onClick={props.onArchive}>
                  {e.archived ? 'Restore' : 'Archive'}
                </button>
                <DeleteEquipmentButton equipment={e} onDone={props.onChanged} />
              </>
            )}
          </div>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="bg-slate-50 px-4 py-4">
            <UnitPanel equipment={e} isAdmin={isAdmin} onChanged={props.onChanged} />
          </td>
        </tr>
      )}
    </>
  );
}

// ---- units of one equipment item ---------------------------------------------------

function UnitPanel({ equipment, isAdmin, onChanged }: { equipment: Equipment; isAdmin: boolean; onChanged: () => void }) {
  const qc = useQueryClient();
  const [tag, setTag] = useState('');
  const units = useQuery({
    queryKey: ['inventory', 'units', equipment.id],
    queryFn: () => inventoryApi.units(equipment.id),
  });

  const done = () => {
    qc.invalidateQueries({ queryKey: ['inventory', 'units', equipment.id] });
    onChanged();
  };

  const add = useMutation({
    mutationFn: () => inventoryApi.addUnit(equipment.id, tag),
    onSuccess: () => {
      setTag('');
      done();
    },
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: UnitStatus }) => inventoryApi.setUnitStatus(v.id, v.status),
    onSuccess: done,
  });

  const onAdd = (ev: FormEvent) => {
    ev.preventDefault();
    add.mutate();
  };

  return (
    <div>
      {units.isLoading && <p className="text-sm text-slate-500">Loading units...</p>}
      {units.data && units.data.length === 0 && <p className="text-sm text-slate-500">No units yet.</p>}
      {units.data && units.data.length > 0 && (
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-4">Tag</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Lifetime rentals</th>
              <th className="py-2 pr-4">Since maintenance</th>
              <th className="py-2">Change status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {units.data.map((u) => (
              <tr key={u.id}>
                <td className="py-2 pr-4 font-mono">{u.tag}</td>
                <td className="py-2 pr-4">
                  <StatusPill tone={u.status === 'AVAILABLE' ? 'ok' : u.status === 'RETIRED' ? 'wait' : 'bad'}>
                    {statusLabel[u.status]}
                  </StatusPill>
                  {u.maintenanceDue && u.status === 'AVAILABLE' && (
                    <span className="ml-2 text-xs text-amber-700">Maintenance due</span>
                  )}
                </td>
                <td className="py-2 pr-4">{u.lifetimeRentals}</td>
                <td className="py-2 pr-4">{u.rentalsSinceMaintenance}</td>
                <td className="py-2">
                  {u.status === 'RETIRED' ? (
                    <span className="text-slate-400">Final</span>
                  ) : (
                    <select
                      aria-label={`Change status of ${u.tag}`}
                      value={u.status}
                      disabled={setStatus.isPending}
                      onChange={(ev) => setStatus.mutate({ id: u.id, status: ev.target.value as UnitStatus })}
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                    >
                      <option value="AVAILABLE">Available</option>
                      <option value="UNDER_MAINTENANCE">Under maintenance</option>
                      <option value="RETIRED">Retired</option>
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {setStatus.isError && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {errorText(setStatus.error)}
        </p>
      )}

      {isAdmin && !equipment.archived && (
        <form onSubmit={onAdd} className="mt-4 flex flex-wrap items-start gap-2">
          <div>
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="New unit tag, e.g. DRL-005"
              aria-label="New unit tag"
              className={`${input} w-64`}
            />
          </div>
          <button type="submit" className={primaryBtn} disabled={add.isPending || tag.trim().length < 2}>
            Add unit
          </button>
          {add.isError && (
            <p role="alert" className="w-full text-sm text-red-700">
              {errorText(add.error)}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

// ---- admin forms ----------------------------------------------------------------------

function EquipmentForm(props: {
  editing: Equipment | null;
  categories: Array<{ id: string; name: string }>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { editing } = props;
  const [name, setName] = useState(editing?.name ?? '');
  const [categoryId, setCategoryId] = useState(editing?.category.id ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [rate, setRate] = useState(editing ? String(editing.dailyRatePaise / 100) : '');
  const [value, setValue] = useState(editing ? String(editing.itemValuePaise / 100) : '');

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        categoryId,
        description,
        dailyRatePaise: rupeesToPaise(Number(rate)),
        itemValuePaise: rupeesToPaise(Number(value)),
      };
      return editing ? inventoryApi.update(editing.id, body) : inventoryApi.create(body);
    },
    onSuccess: props.onDone,
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2"
    >
      <h2 className="text-lg font-semibold sm:col-span-2">{editing ? `Edit ${editing.name}` : 'Add equipment'}</h2>
      <label className="text-sm">
        <span className="mb-1 block text-slate-600">Name</span>
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-slate-600">Category</span>
        <select className={input} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
          <option value="" disabled>
            Select a category
          </option>
          {props.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm sm:col-span-2">
        <span className="mb-1 block text-slate-600">Description</span>
        <textarea className={input} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-slate-600">Daily rate (INR)</span>
        <input className={input} type="number" min="1" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} required />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-slate-600">Item value (INR)</span>
        <input className={input} type="number" min="1" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} required />
      </label>
      <div className="flex items-center gap-2 sm:col-span-2">
        <button type="submit" className={primaryBtn} disabled={save.isPending}>
          {editing ? 'Save changes' : 'Create equipment'}
        </button>
        <button type="button" className={ghostBtn} onClick={props.onCancel}>
          Cancel
        </button>
        {save.isError && (
          <span role="alert" className="text-sm text-red-700">
            {errorText(save.error)}
          </span>
        )}
      </div>
    </form>
  );
}
