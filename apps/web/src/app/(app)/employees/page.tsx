'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { PageHeader, Button, Card, EmptyState, StatusBadge } from '@/components/shared';
import { Plus, X, UserCheck, Calendar } from 'lucide-react';

const EmployeeSchema = z.object({
  firstName: z.string().min(1, 'Required'),
  lastName: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  department: z.string().optional(),
  designation: z.string().optional(),
  dateOfJoining: z.string().min(1, 'Required'),
  salary: z.coerce.number().min(0).default(0),
  salaryType: z.enum(['MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY']).default('MONTHLY'),
});

type EmployeeForm = z.infer<typeof EmployeeSchema>;

const AttendanceStatusSchema = z.enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'HOLIDAY']);

export default function EmployeesPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'employees' | 'attendance'>('employees');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().split('T')[0]);

  const { data, isLoading } = useQuery({ queryKey: ['employees'], queryFn: () => api.employees.list(), select: r => r.data.data });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<EmployeeForm>({ resolver: zodResolver(EmployeeSchema), defaultValues: { salaryType: 'MONTHLY', salary: 0, dateOfJoining: new Date().toISOString().split('T')[0] } });

  const saveMut = useMutation({
    mutationFn: (d: EmployeeForm) => editId ? api.employees.update(editId, d) : api.employees.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); toast.success(editId ? 'Updated' : 'Employee added'); setShowForm(false); reset(); setEditId(null); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const markAttendanceMut = useMutation({
    mutationFn: ({ employeeId, status }: { employeeId: string; status: string }) => api.employees.markAttendance(employeeId, { date: attendanceDate, status }),
    onSuccess: () => toast.success('Attendance marked'),
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const inputCls = "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none";

  return (
    <div className="space-y-6">
      <PageHeader title="Employees" subtitle={`${data?.total || 0} employees`}
        actions={<Button size="sm" onClick={() => { reset({ salaryType: 'MONTHLY', salary: 0, dateOfJoining: new Date().toISOString().split('T')[0] }); setEditId(null); setShowForm(true); }}><Plus className="w-4 h-4" /> Add Employee</Button>}
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
                    <td className="px-4 py-3"><p className="font-medium text-gray-900 dark:text-white">{e.firstName} {e.lastName}</p>{e.email && <p className="text-xs text-gray-400">{e.email}</p>}</td>
                    <td className="px-4 py-3 text-sm font-mono text-orange-600">{e.employeeCode}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{e.department || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{e.designation || '-'}</td>
                    <td className="px-4 py-3 font-semibold text-sm">{formatCurrency(e.salary || 0)}/{e.salaryType === 'MONTHLY' ? 'mo' : e.salaryType.toLowerCase()}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{formatDate(e.dateOfJoining)}</td>
                    <td className="px-4 py-3"><Button variant="ghost" size="sm" onClick={() => { setEditId(e.id); reset(e); setShowForm(true); }}>Edit</Button></td>
                  </tr>
                ))}
                {!isLoading && !data?.employees?.length && <tr><td colSpan={7}><EmptyState title="No employees" description="Add your first employee" action={<Button size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Add Employee</Button>} /></td></tr>}
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
                  <p className="text-xs text-gray-400">{e.employeeCode} · {e.department}</p>
                </div>
                <div className="flex gap-2">
                  {['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE'].map(status => (
                    <button key={status} onClick={() => markAttendanceMut.mutate({ employeeId: e.id, status })}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition ${status === 'PRESENT' ? 'border-green-300 text-green-700 hover:bg-green-50' : status === 'ABSENT' ? 'border-red-300 text-red-700 hover:bg-red-50' : status === 'HALF_DAY' ? 'border-yellow-300 text-yellow-700 hover:bg-yellow-50' : 'border-blue-300 text-blue-700 hover:bg-blue-50'}`}>
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
              <button onClick={() => { setShowForm(false); setEditId(null); reset(); }}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleSubmit(d => saveMut.mutate(d))} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">First Name *</label><input {...register('firstName')} className={inputCls} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Last Name</label><input {...register('lastName')} className={inputCls} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label><input {...register('email')} type="email" className={inputCls} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone</label><input {...register('phone')} className={inputCls} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Department</label><input {...register('department')} className={inputCls} placeholder="Sales, HR, Operations..." /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Designation</label><input {...register('designation')} className={inputCls} placeholder="Manager, Executive..." /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date of Joining *</label><input {...register('dateOfJoining')} type="date" className={inputCls} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Salary Type</label><select {...register('salaryType')} className={inputCls}>{['MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY'].map(t => <option key={t}>{t}</option>)}</select></div>
                <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Salary Amount (₹)</label><input {...register('salary')} type="number" step="0.01" className={inputCls} /></div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <Button variant="secondary" type="button" onClick={() => { setShowForm(false); reset(); }}>Cancel</Button>
                <Button type="submit" loading={saveMut.isPending}>{editId ? 'Update' : 'Add'} Employee</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
