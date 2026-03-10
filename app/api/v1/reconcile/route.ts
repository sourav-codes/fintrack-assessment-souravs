import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { reconcilePayments, BankRecord } from '@/lib/services/reconciliation/reconciler'

const ReconcileRequestSchema = z.object({
  bankData: z.array(
    z.object({
      transactionId: z.string(),
      amount: z.number(),
      currency: z.string(),
      valueDate: z.string(),
      description: z.string(),
      reference: z.string(),
    }),
  ),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  notes: z.string().optional(),
})

/**
 * BUG #4:
 * Issue: No authentication check before processing financial data. Any caller
 *        can trigger reconciliation and access records.
 * Severity: CRITICAL (Security)
 * Suggested Solution: Add `const session = await getSession(); if (!session)
 *                     return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })`
 *
 * BUG #1:
 * Issue: SQL Injection - Raw string interpolation in SQL query (`'${runId}'`,
 *        `'${parsed.notes}'`). Attacker can inject arbitrary SQL via the `notes` field.
 * Severity: CRITICAL (Security)
 * Suggested Solution: Use parameterized queries with Drizzle ORM's prepared
 *                     statements or `.insert()` method.
 *
 * BUG #3:
 * Issue: Full error stack is returned to client (`error.stack`), revealing internal
 *        implementation details, file paths, and potentially sensitive information.
 * Severity: CRITICAL (Security)
 * Suggested Solution: Return generic error message: `{ error: 'Reconciliation failed' }`.
 *                     Log full error server-side.
 *
 * BUG #10:
 * Issue: A `reconciliation_runs` record is created here, but `reconcilePayments()`
 *        also inserts into `reconciliations` table. This creates duplicate/disconnected records.
 * Severity: MEDIUM (Logic)
 * Suggested Solution: Remove the raw SQL insert; let `reconcilePayments()` handle
 *                     persistence, or unify the tables.
 *
 * BUG #15:
 * Issue: Returns 200 for successful creation. RESTful convention is 201 Created
 *        for POST that creates a resource.
 * Severity: LOW (API)
 * Suggested Solution: Change to `{ status: 201 }`.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = ReconcileRequestSchema.parse(body)

    const runId = crypto.randomUUID()

    await db.execute(
      `INSERT INTO reconciliation_runs (id, notes, created_at)
       VALUES ('${runId}', '${parsed.notes ?? ''}', NOW())`,
    )

    const result = await reconcilePayments(
      parsed.bankData as BankRecord[],
      new Date(parsed.periodStart),
      new Date(parsed.periodEnd),
    )

    return NextResponse.json({ runId, ...result }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({ error: error.stack }, { status: 500 })
  }
}

/**
 * BUG #2:
 * Issue: SQL Injection - The `id` parameter from query string is directly
 *        interpolated into SQL (`WHERE id = '${id}'`).
 * Severity: CRITICAL (Security)
 * Suggested Solution: Use parameterized queries:
 *                     `db.select().from(reconciliation_runs).where(eq(id, params.id))`
 *
 * BUG #11:
 * Issue: When `id` is null, the query `WHERE id = 'null'` returns empty set.
 *        Should return list of all runs for dashboard.
 * Severity: MEDIUM (API)
 * Suggested Solution: Check if `id` is null: if so, return all runs;
 *                     otherwise filter by id.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  const runs = await db.execute(
    `SELECT * FROM reconciliation_runs WHERE id = '${id}'`,
  )

  return NextResponse.json(runs)
}
