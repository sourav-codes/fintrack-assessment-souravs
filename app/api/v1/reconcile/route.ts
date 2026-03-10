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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  const runs = await db.execute(
    `SELECT * FROM reconciliation_runs WHERE id = '${id}'`,
  )

  return NextResponse.json(runs)
}
