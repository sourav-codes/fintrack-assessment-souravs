import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { reconciliationRuns } from '@/lib/db/schema'
import { getSession } from '@/lib/auth'
import { reconcilePayments, BankRecord } from '@/lib/services/reconciliation/reconciler'

// Server-side logger (assumes a logging utility exists)
import { logger } from '@/lib/logger'

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
 * POST /api/v1/reconcile
 * Triggers a new reconciliation run.
 *
 * FIX #4: Added authentication check using getSession()
 * FIX #1: Removed SQL injection - using Drizzle ORM parameterized insert
 * FIX #3: Returns generic error message, logs details server-side
 * FIX #10: Removed redundant insert - reconcilePayments() handles persistence
 * FIX #15: Returns 201 Created for successful resource creation
 */
export async function POST(req: NextRequest) {
  try {
    // FIX #4: Authentication check
    const session = await getSession()
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await req.json()
    const parsed = ReconcileRequestSchema.parse(body)

    // FIX #1 & #10: Removed raw SQL injection-vulnerable insert
    // The reconcilePayments function handles persistence via Drizzle ORM
    // We only store notes separately if needed, using parameterized query

    const result = await reconcilePayments(
      parsed.bankData as BankRecord[],
      new Date(parsed.periodStart),
      new Date(parsed.periodEnd),
    )

    // If notes are provided, update the reconciliation record
    // FIX #1: Using Drizzle ORM instead of raw SQL to prevent injection
    if (parsed.notes) {
      await db
        .update(reconciliationRuns)
        .set({ notes: parsed.notes })
        .where(eq(reconciliationRuns.id, result.id))
    }

    // FIX #15: Return 201 Created for successful POST
    return NextResponse.json(result, { status: 201 })

  } catch (error: unknown) {
    // FIX #3: Log full error server-side, return generic message to client
    logger.error('Reconciliation failed', {
      error: error instanceof Error ? error.stack : String(error),
      timestamp: new Date().toISOString(),
    })

    // Check for validation errors to provide slightly more helpful response
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Reconciliation failed. Please try again or contact support.' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/v1/reconcile
 * Retrieves reconciliation runs.
 *
 * FIX #4: Added authentication check
 * FIX #2: Removed SQL injection - using Drizzle ORM parameterized queries
 * FIX #11: Returns all runs when id is not provided (for dashboard)
 */
export async function GET(req: NextRequest) {
  try {
    // FIX #4: Authentication check
    const session = await getSession()
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    // FIX #11: If no id provided, return all runs for dashboard
    // FIX #2: Using Drizzle ORM instead of raw SQL to prevent injection
    if (id) {
      // Fetch specific run by ID
      const run = await db
        .select()
        .from(reconciliationRuns)
        .where(eq(reconciliationRuns.id, id))
        .limit(1)

      if (run.length === 0) {
        return NextResponse.json(
          { error: 'Reconciliation run not found' },
          { status: 404 }
        )
      }

      return NextResponse.json(run[0])
    } else {
      // Return all runs for dashboard display
      const runs = await db
        .select()
        .from(reconciliationRuns)
        .orderBy(reconciliationRuns.createdAt)

      return NextResponse.json({ runs })
    }

  } catch (error: unknown) {
    // FIX #3: Log error server-side, return generic message
    logger.error('Failed to fetch reconciliation runs', {
      error: error instanceof Error ? error.stack : String(error),
      timestamp: new Date().toISOString(),
    })

    return NextResponse.json(
      { error: 'Failed to fetch reconciliation data' },
      { status: 500 }
    )
  }
}
