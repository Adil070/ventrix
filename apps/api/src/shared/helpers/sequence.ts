import { Prisma } from '@prisma/client';

/**
 * Collision-safe document numbering.
 *
 * Numbers are derived from the highest number already stored for the org + prefix (never from count(),
 * which repeats numbers after deletes and races between concurrent requests). Callers must run inside a
 * transaction: `lockSequence` takes a transaction-scoped Postgres advisory lock, so two requests numbering
 * the same sequence are serialised until the first one commits and the second one sees its row.
 */

type Tx = Prisma.TransactionClient;

// Tables/columns are fixed identifiers (never user input), so Prisma.raw is safe here.
const SEQUENCES = {
  invoice: { table: 'invoices', column: 'invoiceNumber' },
  quotation: { table: 'quotations', column: 'quotationNumber' },
  salesOrder: { table: 'sales_orders', column: 'orderNumber' },
  returnOrder: { table: 'return_orders', column: 'returnNumber' },
  // Legacy invoice payments were numbered PAY-<13-digit timestamp>; the digit cap keeps them out of the max.
  payment: { table: 'payments', column: 'paymentNumber', maxDigits: 9 },
  purchase: { table: 'purchases', column: 'purchaseNumber' },
  expense: { table: 'expenses', column: 'expenseNumber' },
} as const;

export type SequenceName = keyof typeof SEQUENCES | 'creditDebitNote';

export async function lockSequence(tx: Tx, organizationId: string, name: SequenceName, prefix: string): Promise<void> {
  const key = `seq:${name}:${organizationId}:${prefix}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/** Highest numeric suffix among `${prefix}NNN` numbers of the org (0 when none). */
export async function maxSequence(tx: Tx, organizationId: string, name: SequenceName, prefix: string): Promise<number> {
  let rows: Array<{ max: bigint | number | null }>;
  if (name === 'creditDebitNote') {
    // Notes have no organizationId column; they belong to the org through their return order.
    rows = await tx.$queryRaw`
      SELECT MAX(CAST(SUBSTRING(n."noteNumber" FROM ${prefix.length + 1}::int) AS BIGINT)) AS max
      FROM credit_debit_notes n JOIN return_orders r ON r.id = n."returnOrderId"
      WHERE r."organizationId" = ${organizationId}
        AND LEFT(n."noteNumber", ${prefix.length}::int) = ${prefix}
        AND SUBSTRING(n."noteNumber" FROM ${prefix.length + 1}::int) ~ '^[0-9]{1,18}$'`;
  } else {
    const seq = SEQUENCES[name];
    const { table, column } = seq;
    const maxDigits = 'maxDigits' in seq ? seq.maxDigits : 18;
    const col = Prisma.raw(`"${column}"`);
    const digits = Prisma.raw(`'^[0-9]{1,${maxDigits}}$'`);
    rows = await tx.$queryRaw`
      SELECT MAX(CAST(SUBSTRING(${col} FROM ${prefix.length + 1}::int) AS BIGINT)) AS max
      FROM ${Prisma.raw(table)}
      WHERE "organizationId" = ${organizationId}
        AND LEFT(${col}, ${prefix.length}::int) = ${prefix}
        AND SUBSTRING(${col} FROM ${prefix.length + 1}::int) ~ ${digits}`;
  }
  return Number(rows[0]?.max ?? 0);
}

/**
 * Locks the sequence and returns the next number, e.g. nextSequenceNumber(tx, org, 'invoice', 'INV-', 6) → 'INV-000015'.
 * The lock is held until the surrounding transaction ends, so create the row in the same transaction.
 */
export async function nextSequenceNumber(
  tx: Tx,
  organizationId: string,
  name: SequenceName,
  prefix: string,
  padTo = 6,
): Promise<string> {
  await lockSequence(tx, organizationId, name, prefix);
  const next = (await maxSequence(tx, organizationId, name, prefix)) + 1;
  return `${prefix}${String(next).padStart(padTo, '0')}`;
}

/** True for a unique-constraint violation on the given column (Prisma P2002). */
export function isUniqueViolation(err: unknown, column: string): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } };
  return e?.code === 'P2002' && String(e.meta?.target ?? '').includes(column);
}

/** Runs `fn` again (up to `attempts` times) when it fails with a unique violation on `column`. */
export async function retryOnUniqueViolation<T>(column: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts || !isUniqueViolation(err, column)) throw err;
    }
  }
}
