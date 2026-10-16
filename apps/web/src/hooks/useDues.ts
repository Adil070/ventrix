'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

// Amount each customer owes you (or you owe each supplier), keyed by id.
// The party list endpoints don't include balances, so this comes from the outstanding report.
export function useDues(kind: 'customer' | 'supplier') {
  const { data } = useQuery({
    queryKey: ['dues', kind],
    queryFn: () => (kind === 'customer' ? api.reports.outstanding.receivables() : api.reports.outstanding.payables()),
    select: r => {
      const rows: any[] = r.data.data?.[`${kind}s`] || [];
      return new Map<string, number>(rows.map(row => [row.id, Number(row.outstandingAmount || 0)]));
    },
    staleTime: 30_000,
  });
  return data ?? new Map<string, number>();
}
