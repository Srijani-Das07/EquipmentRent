import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { inventoryApi, type Equipment } from '../api/inventory';

const input =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';
const primaryBtn =
  'rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50';
const ghostBtn = 'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50';

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');

/** Admin button that removes equipment that was never rented (F7). */
export function DeleteEquipmentButton({ equipment, onDone }: { equipment: Equipment; onDone: () => void }) {
  const remove = useMutation({
    mutationFn: () => inventoryApi.remove(equipment.id),
    onSuccess: onDone,
    onError: (err) => window.alert(errorText(err)),
  });

  return (
    <button
      type="button"
      className={`${ghostBtn} text-red-700`}
      disabled={remove.isPending}
      onClick={() => {
        if (window.confirm(`Delete "${equipment.name}" and its units? This cannot be undone.`)) remove.mutate();
      }}
    >
      Delete
    </button>
  );
}

/** Admin panel to add, rename and remove categories (F9). */
export function CategoryManager({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const categories = useQuery({ queryKey: ['inventory', 'categories'], queryFn: inventoryApi.categories });

  const create = useMutation({
    mutationFn: () => inventoryApi.createCategory({ name, description: description || undefined }),
    onSuccess: () => {
      setName('');
      setDescription('');
      onChanged();
    },
  });
  const rename = useMutation({
    mutationFn: (v: { id: string; name: string }) => inventoryApi.updateCategory(v.id, { name: v.name }),
    onSuccess: () => {
      setRenamingId(null);
      onChanged();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => inventoryApi.deleteCategory(id),
    onSuccess: onChanged,
  });

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  if (!open) {
    return (
      <button type="button" className="mt-4 text-sm text-brand-700 hover:underline" onClick={() => setOpen(true)}>
        Manage categories
      </button>
    );
  }

  const error = create.error ?? rename.error ?? remove.error;

  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Categories</h2>
        <button type="button" className={ghostBtn} onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      <ul className="mt-3 divide-y divide-slate-100">
        {categories.data?.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            {renamingId === c.id ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  rename.mutate({ id: c.id, name: renameValue });
                }}
              >
                <input className={`${input} w-56`} value={renameValue} onChange={(e) => setRenameValue(e.target.value)} minLength={2} maxLength={60} required />
                <button type="submit" className={primaryBtn} disabled={rename.isPending}>
                  Save
                </button>
                <button type="button" className={ghostBtn} onClick={() => setRenamingId(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <span>
                <span className="font-medium">{c.name}</span>
                <span className="ml-2 text-slate-500">{c.equipmentCount ?? 0} active item(s)</span>
              </span>
            )}
            {renamingId !== c.id && (
              <span className="flex gap-2">
                <button
                  type="button"
                  className={ghostBtn}
                  onClick={() => {
                    setRenamingId(c.id);
                    setRenameValue(c.name);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className={`${ghostBtn} text-red-700`}
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete the category "${c.name}"?`)) remove.mutate(c.id);
                  }}
                >
                  Delete
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={onAdd} className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">New category name</span>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-slate-600">Description (optional)</span>
          <input className={input} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
        </label>
        <div className="sm:col-span-3">
          <button type="submit" className={primaryBtn} disabled={create.isPending}>
            Add category
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {errorText(error)}
        </p>
      )}
    </section>
  );
}
