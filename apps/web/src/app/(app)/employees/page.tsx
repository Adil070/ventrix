'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { dropEmpty, plural, today } from '@/lib/business';
import { PageHeader, Button, Card, EmptyState, StatusBadge } from '@/components/shared';
import { Plus, X, UserCheck, Calendar } from 'lucide-react';

const EmployeeSchema = z.object({
  firstName: z.string().min(1, 'Required'),
  lastName: z.string().min(1, 'Required'),
  email: z.string().email('Enter a valid email').optional().or(z.literal('')),
  phone: z.string().optional(),
  department: z.string().optional(),
  designation: z.string().optional(),
  joiningDate: z.string().optional(),
  salary: z.coerce.number().min(0).default(0),
  salaryType: z.enum(['MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY']).default('MONTHLY'),
});

type EmployeeForm = z.infer<typeof EmployeeSchema>;

const emptyForm = (): EmployeeForm => ({ firstName: '', lastName: '', email: '', phone: '', department: '', designation: '', joiningDate: today(), salary: 0, salaryType: 'MONTHLY' });

// Employee row from the API -> form values (salary is a Decimal string, joiningDate an ISO date).
function toForm(e: any): EmployeeForm {
  return {
    firstName: e.firstName ?? '',
    lastName: e.lastName ?? '',
    email: e.email ?? '',
    phone: e.phone ?? '',
    department: e.department ?? '',
    designation: e.designation ?? '',
    joiningDate: e.joiningDate ? String(e.joiningDate).slice(0, 10) : '',
    salary: Number(e.salary ?? 0),
    salaryType: e.salaryType ?? 'MONTHLY',
  };
}

function apiError(e: any, fallback: string) {
  const data = e?.response?.data;
  const first = (data?.details ?? data?.errors)?.[0];
  return first ? `${first.field}: ${first.message}` : data?.message || data?.error || fallback;
}

const SALARY_PERIOD: Record<string, string> = { MONTHLY: 'month', WEEKLY: 'week', DAILY: 'day', HOURLY: 'hour' };

const AttendanceStatusSchema = z.enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'HOLIDAY']);

export default function EmployeesPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'employees' | 'attendance'>('employees');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [attendanceDate, setAttendanceDate] = useState(today());
  // Statuses marked in this session, keyed by `${date}:${employeeId}`, so the chosen button stays highlighted.
  const [marked, setMarked] = useState<Record<string, string>>({});

  // paginatedResponse: rows are r.data.data (array), count is r.data.pagination.total
  const { data, isLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: () => api.employees.list({ limit: 100 }),
    select: r => ({ employees: (r.data.data ?? []) as any[], total: Number(r.data.pagination?.total ?? 0) }),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<EmployeeForm>({ resolver: zodResolver(EmployeeSchema), defaultValues: emptyForm() });

  const saveMut = useMutation({
    // Prisma names are phone / joiningDate; blanks are dropped because the API rejects '' for email and dates.
    mutationFn: (d: EmployeeForm) => editId ? api.employees.update(editId, dropEmpty(d)) : api.employees.create(dropEmpty(d)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      toast.success(editId ? 'Employee updated' : 'Employee added');
      setShowForm(false); reset(emptyForm()); setEditId(null);
    },
    onError: (e: any) => toast.error(apiError(e, 'Could not save employee')),
  });

  const markAttendanceMut = useMutation({
    // POST /employees/attendance { employeeId, date, status } (upserts one row per employee per day)
    mutationFn: ({ employeeId, status }: { employeeId: string; status: string }) => api.employees.attendance.record({ employeeId, date: attendanceDate, status }),
    onSuccess: (_res, v) => { setMarked(m => ({ ...m, [`${attendanceDate}:${v.employeeId}`]: v.status })); toast.success('Attendance saved'); },
    onError: (e: any) => toast.error(apiError(e, 'Could not save attendance')),
  });

  const inputCls = "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none";

  return (
    <div className="space-y-6">
      <PageHeader title="Employees" subtitle={plural(data?.total ?? 0, 'employee')}
        actions={<Button size="sm" onClick={() => { reset(emptyForm()); setEditId(null); setShowForm(true); }}><Plus className="w-4 h-4" /> Add Employee</Button>}
      />

      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        {[['employees', 'All Employees'], ['attendance', 'Attendance']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key as any)} className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === key ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{label}</button>
        ))}
      </div>

      {tab === 'employees' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700">{['Employee', 'Code', 'Department', 'Designation', 'Salary', 'Joined', 'Actions'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}</tr></thead>
              <tbody>
                {isLoading && Array(5).fill(0).map((_, i) => <tr key={i}><td colSpan={7}><div className="h-10 bg-gray-100 dark:bg-gray-700 animate-pulse m-3 rounded" /></td></tr>)}
                {!isLoading && data?.employees?.map((e: any) => (
                  <tr key={e.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3"><p className="font-medium text-gray-900 dark:text-white">{e.firstName} {e.lastName}</p>{(e.email || e.phone) && <p className="text-xs text-gray-400">{e.email || e.phone}</p>}</td>
                    <td className="px-4 py-3 text-sm font-mono text-orange-600">{e.employeeCode}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{e.department || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{e.designation || '-'}</td>
                    <td className="px-4 py-3 font-semibold text-sm">{e.salary != null ? `${formatCurrency(Number(e.salary))} / ${SALARY_PERIOD[e.salaryType] ?? 'month'}` : '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{formatDate(e.joiningDate)}</td>
                    <td className="px-4 py-3"><Button variant="ghost" size="sm" onClick={() => { setEditId(e.id); reset(toForm(e)); setShowForm(true); }}>Edit</Button></td>
                  </tr>
                ))}
                {!isLoading && !data?.employees?.length && <tr><td colSpan={7}><EmptyState title="No employees" description="Add your first employee" action={<Button size="sm" onClick={() => { reset(emptyForm()); setEditId(null); setShowForm(true); }}><Plus className="w-4 h-4" /> Add Employee</Button>} /></td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'attendance' && (
        <Card className="p-6">
          <div className="flex items-center gap-4 mb-6">
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label><input type="date" value={attendanceDate} onChange={e => setAttendanceDate(e.target.value)} className={inputCls + ' w-auto'} /></div>
          </div>
          <div className="space-y-3">
            {(data?.employees || []).map((e: any) => (
              <div key={e.id} className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{e.firstName} {e.lastName}</p>
                  <p className="text-xs text-gray-400">{[e.employeeCode, e.department].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex gap-2">
                  {['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE'].map(status => (
                    <button key={status} disabled={markAttendanceMut.isPending} onClick={() => markAttendanceMut.mutate({ employeeId: e.id, status })}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition disabled:opacity-60 ${marked[`${attendanceDate}:${e.id}`] === status ? 'ring-2 ring-offset-1 ring-orange-400 font-bold ' : ''}${status === 'PRESENT' ? 'border-green-300 text-green-700 hover:bg-green-50' : status === 'ABSENT' ? 'border-red-300 text-red-700 hover:bg-red-50' : status === 'HALF_DAY' ? 'border-yellow-300 text-yellow-700 hover:bg-yellow-50' : 'border-blue-300 text-blue-700 hover:bg-blue-50'}`}>
                      {status.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!data?.employees?.length && <EmptyState title="No employees" description="Add employees first" />}
          </div>
        </Card>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{editId ? 'Edit' : 'Add'} Employee</h2>
              <button onClick={() => { setShowForm(false); setEditId(null); reset(emptyForm()); }}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleSubmit(d => saveMut.mutate(d))} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">First Name *</label><input {...register('firstName')} className={inputCls} />{errors.firstName && <p className="text-red-500 text-xs mt-1">{errors.firstName.message}</p>}</div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Last Name *</label><input {...register('lastName')} className={inputCls} />{errors.lastName && <p className="text-red-500 text-xs mt-1">{errors.lastName.message}</p>}</div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label><input {...register('email')} type="email" className={inputCls} />{errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}</div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone</label><input {...register('phone')} className={inputCls} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Department</label><input {...register('department')} className={inputCls} placeholder="Sales, HR, Operations..." /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Designation</label><input {...register('designation')} className={inputCls} placeholder="Manager, Executive..." /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date of Joining</label><input {...register('joiningDate')} type="date" className={inputCls} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Salary Type</label><select {...register('salaryType')} className={inputCls}>{['MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY'].map(t => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}</select></div>
                <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Salary Amount (₹)</label><input {...register('salary')} type="number" min="0" step="0.01" className={inputCls} />{errors.salary && <p className="text-red-500 text-xs mt-1">{errors.salary.message}</p>}</div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <Button variant="secondary" type="button" onClick={() => { setShowForm(false); setEditId(null); reset(emptyForm()); }}>Cancel</Button>
                <Button type="submit" loading={saveMut.isPending}>{editId ? 'Update' : 'Add'} Employee</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
