import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { fieldErrors, roleLabel, usersApi, type Role, type UpdateUserInput } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import Field from '../components/Field';
import UpcomingCard from '../components/UpcomingCard';

const ROLES: Role[] = ['CUSTOMER', 'STAFF', 'ADMIN'];

export default function AdminDashboard() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const users = useQuery({ queryKey: ['users'], queryFn: async () => (await usersApi.list()).users });

  const update = useMutation({
    mutationFn: (v: { id: string; patch: UpdateUserInput }) => usersApi.update(v.id, v.patch),
    onSuccess: () => {
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Update failed. Try again.'),
  });

  const list = users.data ?? [];
  const activeCount = (r: Role) => list.filter((u) => u.role === r && u.isActive).length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-slate-600">Manage users and roles.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {ROLES.map((r) => (
          <div key={r} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-sm text-slate-500">Active {roleLabel[r].toLowerCase()}s</div>
            <div className="mt-1 text-2xl font-semibold">{activeCount(r)}</div>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="font-semibold">Users</h2>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            {showForm ? 'Close' : 'Add user'}
          </button>
        </div>

        {showForm && <CreateUserForm onDone={() => setShowForm(false)} />}

        {actionError && (
          <div role="alert" className="mx-5 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {actionError}
          </div>
        )}

        {users.isLoading ? (
          <p className="p-5 text-sm text-slate-500">Loading users…</p>
        ) : users.isError ? (
          <p className="p-5 text-sm text-red-600">Could not load users.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Email</th>
                  <th className="px-5 py-3">Role</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Joined</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((u) => {
                  const isMe = u.id === me?.id;
                  return (
                    <tr key={u.id}>
                      <td className="px-5 py-3 font-medium">
                        {u.name}
                        {isMe && <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">You</span>}
                      </td>
                      <td className="px-5 py-3 text-slate-600">{u.email}</td>
                      <td className="px-5 py-3">
                        <select
                          value={u.role}
                          disabled={isMe || update.isPending}
                          onChange={(e) => update.mutate({ id: u.id, patch: { role: e.target.value as Role } })}
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm disabled:opacity-60"
                          aria-label={`Role for ${u.name}`}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {roleLabel[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            u.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {u.isActive ? 'Active' : 'Deactivated'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{new Date(u.createdAt).toLocaleDateString()}</td>
                      <td className="px-5 py-3 text-right">
                        <button
                          disabled={isMe || update.isPending}
                          onClick={() => update.mutate({ id: u.id, patch: { isActive: !u.isActive } })}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {u.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <UpcomingCard title="Inventory" description="Add, edit, retire equipment and manage categories." module="Module 2" />
        <UpcomingCard title="Policy configuration" description="Edit fees, penalties and maintenance intervals." module="Module 7" />
        <UpcomingCard title="Reports" description="Bookings, revenue, utilization and maintenance reports." module="Module 8" />
      </div>
    </div>
  );
}

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'STAFF' as Role });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => usersApi.create(form),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      onDone();
    },
    onError: (err) => {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length) {
        setErrors(fe);
        setError(null);
      } else {
        setErrors({});
        setError(err instanceof ApiError ? err.message : 'Could not create user');
      }
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setErrors({});
    create.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 border-b border-slate-200 bg-slate-50 p-5 sm:grid-cols-2">
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">
          {error}
        </div>
      )}
      <Field label="Full name" name="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
      <Field label="Email" name="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
      <Field
        label="Temporary password"
        name="password"
        type="password"
        autoComplete="new-password"
        value={form.password}
        onChange={(e) => setForm({ ...form, password: e.target.value })}
        error={errors.password}
      />
      <div>
        <label htmlFor="new-role" className="block text-sm font-medium text-slate-700">
          Role
        </label>
        <select
          id="new-role"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
          className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {roleLabel[r]}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {create.isPending ? 'Creating…' : 'Create user'}
        </button>
      </div>
    </form>
  );
}