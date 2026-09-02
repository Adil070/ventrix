'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatDate, cn } from '@/lib/utils';
import { PageHeader, Button, Card, StatusBadge, EmptyState } from '@/components/shared';
import { Plus, X, CheckCircle, Clock, AlertCircle } from 'lucide-react';

const TaskSchema = z.object({
  title: z.string().min(1, 'Required'),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  status: z.enum(['TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).default('TODO'),
});

type TaskForm = z.infer<typeof TaskSchema>;

const priorityColors: Record<string, string> = {
  LOW: 'text-gray-500 bg-gray-100',
  MEDIUM: 'text-blue-600 bg-blue-50',
  HIGH: 'text-orange-600 bg-orange-50',
  URGENT: 'text-red-600 bg-red-50',
};

export default function CRMTasksPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['crm-tasks', statusFilter], queryFn: () => api.crm.tasks.list({ status: statusFilter || undefined }), select: r => r.data.data });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<TaskForm>({
    resolver: zodResolver(TaskSchema),
    defaultValues: { priority: 'MEDIUM', status: 'TODO' },
  });

  const createMut = useMutation({
    mutationFn: (d: TaskForm) => api.crm.tasks.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm-tasks'] }); toast.success('Task created'); setShowForm(false); reset(); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.crm.tasks.update(id, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm-tasks'] }); toast.success('Task updated'); },
  });

  const inputCls = "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none";

  const tasks = data?.tasks || [];
  const counts = { TODO: tasks.filter((t: any) => t.status === 'TODO').length, IN_PROGRESS: tasks.filter((t: any) => t.status === 'IN_PROGRESS').length, COMPLETED: tasks.filter((t: any) => t.status === 'COMPLETED').length };

  return (
    <div className="space-y-6">
      <PageHeader title="CRM Tasks" subtitle="Manage your follow-ups and activities" actions={<Button size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Add Task</Button>} />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[{ label: 'To Do', count: counts.TODO, icon: Clock, color: 'text-gray-500' }, { label: 'In Progress', count: counts.IN_PROGRESS, icon: AlertCircle, color: 'text-blue-500' }, { label: 'Completed', count: counts.COMPLETED, icon: CheckCircle, color: 'text-green-500' }].map(s => (
          <Card key={s.label} className="p-4 flex items-center gap-3">
            <s.icon className={`w-8 h-8 ${s.color}`} />
            <div><p className="text-2xl font-bold text-gray-900 dark:text-white">{s.count}</p><p className="text-sm text-gray-500">{s.label}</p></div>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="p-4">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={`${inputCls} w-48`}>
          <option value="">All Status</option>
          {['TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </Card>

      {/* Task List */}
      <div className="space-y-3">
        {isLoading && <div className="text-center py-8 text-gray-500">Loading...</div>}
        {tasks.map((task: any) => (
          <Card key={task.id} className={`p-4 ${task.status === 'COMPLETED' ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <button onClick={() => updateMut.mutate({ id: task.id, status: task.status === 'COMPLETED' ? 'TODO' : 'COMPLETED' })} className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${task.status === 'COMPLETED' ? 'border-green-500 bg-green-500' : 'border-gray-300 hover:border-green-400'}`}>
                  {task.status === 'COMPLETED' && <CheckCircle className="w-4 h-4 text-white" />}
                </button>
                <div>
                  <p className={`font-medium text-gray-900 dark:text-white ${task.status === 'COMPLETED' ? 'line-through' : ''}`}>{task.title}</p>
                  {task.description && <p className="text-sm text-gray-500 mt-0.5">{task.description}</p>}
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityColors[task.priority] || 'text-gray-500 bg-gray-100'}`}>{task.priority}</span>
                    {task.dueDate && <span className={`text-xs ${new Date(task.dueDate) < new Date() && task.status !== 'COMPLETED' ? 'text-red-500 font-medium' : 'text-gray-400'}`}>Due: {formatDate(task.dueDate)}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {task.status === 'TODO' && <button onClick={() => updateMut.mutate({ id: task.id, status: 'IN_PROGRESS' })} className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">Start</button>}
                <StatusBadge status={task.status} />
              </div>
            </div>
          </Card>
        ))}
        {!isLoading && !tasks.length && <EmptyState title="No tasks" description="Create tasks to track follow-ups and activities" action={<Button size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Add Task</Button>} />}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Add Task</h2>
              <button onClick={() => { setShowForm(false); reset(); }}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleSubmit(d => createMut.mutate(d))} className="p-6 space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title *</label><input {...register('title')} className={inputCls} placeholder="Follow up with customer" /></div>
              <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label><textarea {...register('description')} rows={2} className={inputCls} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Priority</label>
                  <select {...register('priority')} className={inputCls}>{['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map(p => <option key={p} value={p}>{p}</option>)}</select>
                </div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Due Date</label><input type="date" {...register('dueDate')} className={inputCls} /></div>
              </div>
              <div className="flex gap-3 justify-end">
                <Button variant="secondary" type="button" onClick={() => { setShowForm(false); reset(); }}>Cancel</Button>
                <Button type="submit" loading={createMut.isPending}>Add Task</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
