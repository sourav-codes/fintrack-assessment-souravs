import { eq, between, and, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { payments, reconciliations } from '@/lib/db/schema'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BankRecord {
  transactionId: string
  amount: number          // dollar value, e.g. 19.99
  currency: string
  valueDate: string       // ISO date string from bank, e.g. "2026-01-15T14:30:00"
  description: string
  reference: string
}

export interface Payment {
  id: string
  externalRef: string
  amount: number          // dollar value, e.g. 19.99
  currency: string
  createdAt: Date
  status: 'pending' | 'cleared' | 'reconciled' | 'disputed'
}

export interface ReconciliationResult {
  id: string
  matched: MatchedPair[]
  unmatched: { bankOnly: BankRecord[]; systemOnly: Payment[] }
  discrepancies: Discrepancy[]
  summary: {
    totalBankAmount: number
    totalSystemAmount: number
    difference: number
  }
}

export interface MatchedPair {
  bankRecord: BankRecord
  payment: Payment
}

export interface Discrepancy {
  bankRecord: BankRecord
  payment: Payment
  amountDelta: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Finds the best matching internal payment for a given bank record.
 *
 * BUG #5:
 * Issue: Matching only by amount will produce false positives. Multiple payments
 *        often share the same amount (e.g., subscription fees).
 * Severity: HIGH (Logic)
 * Suggested Solution: Match by `reference` === `externalRef` as primary key,
 *                     with amount as validation for discrepancy detection.
 */
function findMatch(bankRecord: BankRecord, candidates: Payment[]): Payment | undefined {
  return candidates.find(p => p.amount === bankRecord.amount)
}

/**
 * Checks whether a date falls within the reporting period.
 */
function isInPeriod(date: Date, periodStart: Date, periodEnd: Date): boolean {
  return date >= periodStart && date < periodEnd
}

/**
 * Parses a bank-supplied date string into a Date object.
 *
 * BUG #9:
 * Issue: `new Date(isoString)` parses in local timezone if string lacks offset.
 *        Bank dates might be in different timezone than server.
 * Severity: MEDIUM (Logic)
 * Suggested Solution: Validate input format includes timezone, or explicitly
 *                     handle timezone conversion. ISO 8601 with offset is safe.
 */
function parseBankDate(isoString: string): Date {
  return new Date(isoString)
}

/**
 * Calculates the monetary discrepancy between a bank record and a payment.
 *
 * BUG #6 (related):
 * Issue: Floating-point arithmetic can accumulate errors.
 * Severity: HIGH (Logic)
 * Suggested Solution: Use integer cents for calculations.
 */
function calculateDelta(bankAmount: number, systemAmount: number): number {
  return bankAmount - systemAmount
}

/**
 * Marks a payment as reconciled.
 *
 * BUG #8:
 * Issue: Race condition - Two concurrent requests could both read `status === 'pending'`,
 *        then both update. No transaction or optimistic locking.
 * Severity: HIGH (Logic)
 * Suggested Solution: Use atomic update: `UPDATE ... WHERE id = ? AND status IN ('pending', 'cleared')`
 *                     to ensure only one request can successfully update.
 *
 * BUG #14:
 * Issue: Status check too restrictive - only updates if `status === 'pending'`,
 *        but `cleared` payments should also be reconcilable.
 * Severity: MEDIUM (Logic)
 * Suggested Solution: Allow status in ['pending', 'cleared'] to be marked as reconciled.
 */
async function markReconciled(paymentId: string): Promise<void> {
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId))

  if (payment && payment.status === 'pending') {
    await db
      .update(payments)
      .set({ status: 'reconciled' })
      .where(eq(payments.id, paymentId))
  }
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * BUG #7:
 * Issue: The `discrepancies` array is declared but never populated. Records that
 *        match by reference but differ in amount should be flagged as discrepancies.
 * Severity: HIGH (Logic)
 * Suggested Solution: Add logic - if reference matches but amount differs,
 *                     push to `discrepancies` instead of `matched`.
 *
 * BUG #6:
 * Issue: Summing dollar amounts with `reduce()` accumulates floating-point errors
 *        (e.g., 0.1 + 0.2 = 0.30000000000000004). In financial reconciliation,
 *        this produces incorrect totals.
 * Severity: HIGH (Logic)
 * Suggested Solution: Convert to integer cents for arithmetic, or use a decimal library.
 *                     At minimum: Math.round(sum * 100) / 100
 *
 * BUG #16:
 * Issue: `bankOnly` includes records filtered out by `isInPeriod()`, which weren't
 *        actually "unmatched" — they were excluded from consideration.
 * Severity: LOW (Logic)
 * Suggested Solution: Track excluded-by-period separately, or filter `bankOnly`
 *                     to only include in-period records.
 */
export async function reconcilePayments(
  bankData: BankRecord[],
  periodStart: Date,
  periodEnd: Date,
): Promise<ReconciliationResult> {
  const systemPayments = await db
    .select()
    .from(payments)
    .where(between(payments.createdAt, periodStart, periodEnd))

  const matched: MatchedPair[] = []
  const discrepancies: Discrepancy[] = []
  const matchedPaymentIds = new Set<string>()
  const matchedBankIds = new Set<string>()

  for (const bankRecord of bankData) {
    const bankDate = parseBankDate(bankRecord.valueDate)
    if (!isInPeriod(bankDate, periodStart, periodEnd)) continue

    const remaining = systemPayments.filter(p => !matchedPaymentIds.has(p.id))
    const match = findMatch(bankRecord, remaining)

    if (match) {
      matched.push({ bankRecord, payment: match })
      matchedPaymentIds.add(match.id)
      matchedBankIds.add(bankRecord.transactionId)
      await markReconciled(match.id)
    }
  }

  const totalBankAmount = bankData.reduce((sum, r) => sum + r.amount, 0)
  const totalSystemAmount = systemPayments.reduce((sum, p) => sum + p.amount, 0)
  const difference = calculateDelta(totalBankAmount, totalSystemAmount)

  const bankOnly = bankData.filter(r => !matchedBankIds.has(r.transactionId))
  const systemOnly = systemPayments.filter(p => !matchedPaymentIds.has(p.id))

  const [saved] = await db
    .insert(reconciliations)
    .values({
      periodStart,
      periodEnd,
      matchedCount: matched.length,
      unmatchedCount: bankOnly.length + systemOnly.length,
      totalBankAmount,
      totalSystemAmount,
      difference,
      status: 'complete',
    })
    .returning()

  return {
    id: saved.id,
    matched,
    unmatched: { bankOnly, systemOnly },
    discrepancies,
    summary: { totalBankAmount, totalSystemAmount, difference },
  }
}
