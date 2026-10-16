'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface UnpaidBill {
  id: string;
  number: string;
  date: string;
  balance: number;
}

// Unpaid sales bills for a customer, or unpaid purchase bills for a supplier, oldest first.
export function useUnpaidBills(kind: 'customer' | 'supplier', partyId: string | null | undefined) {
  return useQuery({
    queryKey: ['unpaid-bills', kind, partyId],
    enabled: !!partyId,
    queryFn: async (): Promise<UnpaidBill[]> => {
      if (kind === 'customer') {
        const r = await api.invoices.outstanding(partyId!);
        return (r.data.data || []).map((i: any) => ({ id: i.id, number: i.invoiceNumber, date: i.invoiceDate, balance: Number(i.balanceAmount) }));
      }
      const r = await api.purchases.list({ supplierId: partyId, limit: 200, sortBy: 'purchaseDate', sortOrder: 'asc' });
      return (r.data.data?.purchases || [])
        .filter((p: any) => p.status !== 'CANCELLED' && Number(p.balanceAmount) > 0)
        .map((p: any) => ({ id: p.id, number: p.billNumber || p.purchaseNumber, date: p.purchaseDate, balance: Number(p.balanceAmount) }));
    },
    select: bills => [...bills].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
  });
}

// Settle the oldest bills first. Anything beyond the total due is left unallocated (an advance).
export function allocateOldestFirst(bills: UnpaidBill[], amount: number) {
  const out: { id: string; amount: number }[] = [];
  let left = Math.round(amount * 100) / 100;
  for (const b of bills) {
    if (left <= 0) break;
    const take = Math.min(left, b.balance);
    out.push({ id: b.id, amount: Math.round(take * 100) / 100 });
    left = Math.round((left - take) * 100) / 100;
  }
  return { allocations: out, advance: left };
}
