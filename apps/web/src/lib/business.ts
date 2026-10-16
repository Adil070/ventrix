// Shared business vocabulary: experience levels and payment modes.
// Keeping these in one place stops each form from inventing its own enum values.

export type Experience = 'simple' | 'growing' | 'warehouse';

export const EXPERIENCES: { key: Experience; title: string; description: string; example: string }[] = [
  {
    key: 'simple',
    title: 'Small shop or service',
    description: 'Sell, buy, track who owes you. Nothing else in the way.',
    example: 'Kirana store, salon, repair shop, freelancer',
  },
  {
    key: 'growing',
    title: 'Growing business',
    description: 'Adds quotations, orders, returns, stock, banking and GST filing.',
    example: 'Distributor, wholesaler, multi-person team',
  },
  {
    key: 'warehouse',
    title: 'Warehouse or factory',
    description: 'Everything: multiple warehouses, manufacturing, staff, accounting.',
    example: 'Manufacturer, large warehouse, multi-branch business',
  },
];

export const EXPERIENCE_RANK: Record<Experience, number> = { simple: 0, growing: 1, warehouse: 2 };

// Values accepted by every money endpoint (invoice payment, payments, purchases, expenses).
export const PAYMENT_MODES = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Card' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
] as const;

export type PaymentMode = (typeof PAYMENT_MODES)[number]['value'];

export function paymentModeLabel(mode?: string | null) {
  if (!mode) return '-';
  return PAYMENT_MODES.find(m => m.value === mode)?.label ?? mode.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
}

// The API rejects '' for optional fields with formats (email, mobile, GSTIN), so drop blanks before sending.
export function dropEmpty<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === '' || v === null || v === undefined) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const nested = dropEmpty(v);
      if (Object.keys(nested).length) out[k] = nested;
    } else out[k] = v;
  }
  return out as Partial<T>;
}

// Plain words for bill statuses (the API's CONFIRMED just means "final, not yet paid").
export const BILL_STATUS_TEXT: Record<string, string> = {
  DRAFT: 'Draft',
  CONFIRMED: 'Unpaid',
  PARTIALLY_PAID: 'Part paid',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
  CANCELLED: 'Cancelled',
};

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function today() {
  return new Date().toISOString().split('T')[0];
}
