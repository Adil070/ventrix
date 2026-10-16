'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { plural } from '@/lib/business';
import { PageHeader, Button, Card, EmptyState } from '@/components/shared';
import { Upload, Download, Trash2, FileText, Image, File, Search } from 'lucide-react';

const getFileIcon = (mimeType?: string | null) => {
  if (mimeType?.startsWith('image/')) return Image;
  if (mimeType?.includes('pdf')) return FileText;
  return File;
};

// The API replies with { message } for most errors but { error } for 400/404 here; a 5xx usually means file storage is unreachable.
function uploadError(e: any, fileName: string) {
  const status = e?.response?.status;
  const data = e?.response?.data;
  if (!e?.response) return `Could not reach the server to upload ${fileName}.`;
  if (status === 413) return `${fileName} is too large (max 25 MB).`;
  if (status >= 500) return `Could not upload ${fileName}: file storage is not available right now. Please try again later.`;
  return `Could not upload ${fileName}: ${data?.message || data?.error || 'upload failed'}`;
}

export default function DocumentsPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);

  // paginatedResponse: rows are r.data.data (array), count is r.data.pagination.total.
  // Search is done here: the API's ?search= filter queries a `tags` column Document doesn't have and returns 500.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['documents'],
    queryFn: () => api.documents.list({ limit: 100 }),
    select: r => ({ documents: (r.data.data ?? []) as any[], total: Number(r.data.pagination?.total ?? 0) }),
  });
  const term = search.trim().toLowerCase();
  const documents = (data?.documents ?? []).filter(d => !term || `${d.name} ${d.fileName}`.toLowerCase().includes(term));

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.documents.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents'] }); toast.success('Document deleted'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.response?.data?.error || 'Could not delete document'),
  });

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    let done = 0;
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('file', file);
        form.append('name', file.name);
        try {
          await api.documents.upload(form);
          done++;
        } catch (e: any) {
          toast.error(uploadError(e, file.name), { duration: 6000 });
        }
      }
      if (done) {
        qc.invalidateQueries({ queryKey: ['documents'] });
        toast.success(`${plural(done, 'file')} uploaded`);
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDownload = async (doc: any) => {
    try {
      const res = await api.documents.getDownloadUrl(doc.id);
      const url = res.data?.data?.url;
      if (!url) throw new Error('no url');
      window.open(url, '_blank');
    } catch {
      toast.error('Could not get download link');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Documents" subtitle={plural(data?.total ?? 0, 'document')}
        actions={
          <>
            <input ref={fileRef} type="file" className="hidden" multiple onChange={e => uploadFiles(e.target.files)} />
            <Button size="sm" loading={uploading} onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4" /> Upload Files</Button>
          </>
        }
      />

      <Card className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none bg-white dark:bg-gray-700" placeholder="Search documents..." />
        </div>
      </Card>

      {/* Upload Drop Zone */}
      <div onClick={() => fileRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); uploadFiles(e.dataTransfer.files); }} className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center cursor-pointer hover:border-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/10 transition">
        <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Click or drag files to upload</p>
        <p className="text-xs text-gray-400 mt-1">PDF, Images, Word, Excel — up to 25MB each</p>
      </div>

      {/* Documents Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {isLoading && Array(8).fill(0).map((_, i) => <div key={i} className="h-36 bg-gray-100 dark:bg-gray-700 animate-pulse rounded-xl" />)}
        {!isLoading && documents.map((doc: any) => {
          const Icon = getFileIcon(doc.mimeType);
          return (
            <Card key={doc.id} className="p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-orange-50 dark:bg-orange-900/20 rounded-lg flex items-center justify-center"><Icon className="w-5 h-5 text-orange-500" /></div>
                <div className="flex gap-1">
                  <button onClick={() => handleDownload(doc)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition"><Download className="w-4 h-4" /></button>
                  <button onClick={() => { if (confirm('Delete?')) deleteMut.mutate(doc.id); }} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate" title={doc.name}>{doc.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{formatDate(doc.createdAt)}</p>
              {doc.fileSize != null && <p className="text-xs text-gray-400">{doc.fileSize < 1024 * 1024 ? `${Math.max(1, Math.round(doc.fileSize / 1024))} KB` : `${(doc.fileSize / 1024 / 1024).toFixed(2)} MB`}</p>}
            </Card>
          );
        })}
        {isError && <div className="col-span-full"><EmptyState title="Could not load documents" description="Please refresh the page to try again." /></div>}
        {!isLoading && !isError && !documents.length && <div className="col-span-full"><EmptyState title={term ? 'No matching documents' : 'No documents'} description={term ? 'Try a different search' : 'Upload your first document'} action={<Button size="sm" onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4" /> Upload</Button>} /></div>}
      </div>
    </div>
  );
}
