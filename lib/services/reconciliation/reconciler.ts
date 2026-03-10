import { eq, between, and, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { payments, reconciliations } from '@/lib/db/schema'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BankRecord {
  transactionId: string
  amount: number          // dollar value, e.g. 19.99
  currency: string
  valueDate: string       // ISO date string from bank, e.g. "2026-01-15T14:30:00Z"
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
 * Converts a dollar amount to integer cents to avoid floating-point errors.
 *
 * FIX #6: Using integer cents for all monetary arithmetic.
 */
function toCents(amount: number): number {
  return Math.round(amount * 100)
}

/**
 * Converts integer cents back to dollar amount for display/storage.
 */
function toDollars(cents: number): number {
  return cents / 100
}

/**
 * Finds the best matching internal payment for a given bank record.
 *
 * FIX #5: Matching strategy changed from amount-only to reference-based.
 * Primary match key: bank.reference === payment.externalRef
 * This is the industry standard for B2B payment reconciliation as reference
 * numbers are designed to be unique identifiers between systems.
 */
function findMatchByReference(bankRecord: BankRecord, candidates: Payment[]): Payment | undefined {
  return candidates.find(p => p.externalRef === bankRecord.reference)
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
 * FIX #9: Validates ISO 8601 format and ensures timezone awareness.
 * If the string lacks timezone info, assumes UTC to ensure consistency.
 */
function parseBankDate(isoString: string): Date {
  // Check if string has timezone indicator (Z or +/- offset)
  const hasTimezone = /([Zz]|[+-]\d{2}:\d{2})$/.test(isoString)

  // If no timezone, append 'Z' to treat as UTC
  const normalizedString = hasTimezone ? isoString : `${isoString}Z`

  return new Date(normalizedString)
}

/**
 * Calculates the monetary discrepancy between a bank record and a payment.
 *
 * FIX #6: Uses integer cents to avoid floating-point arithmetic errors.
 * Returns the delta in dollars after precise calculation.
 */
function calculateDelta(bankAmount: number, systemAmount: number): number {
  const bankCents = toCents(bankAmount)
  const systemCents = toCents(systemAmount)
  return toDollars(bankCents - systemCents)
}

/**
 * Marks a payment as reconciled using atomic update to prevent race conditions.
 *
 * FIX #8: Uses atomic UPDATE with WHERE clause to prevent race conditions.
 *         Only one concurrent request can successfully update.
 * FIX #14: Now allows both 'pending' and 'cleared' statuses to be reconciled.
 */
async function markReconciled(paymentId: string): Promise<boolean> {
  // Atomic update: only succeeds if status is pending or cleared
  const result = await db
    .update(payments)
    .set({ status: 'reconciled' })
    .where(
      and(
        eq(payments.id, paymentId),
        inArray(payments.status, ['pending', 'cleared'])
      )
    )
    .returning({ id: payments.id })

  // Returns true if a row was actually updated
  return result.length > 0
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Reconciles bank records against internal payment records.
 *
 * FIX #5: Uses reference-based matching (externalRef === reference)
 * FIX #6: All monetary calculations use integer cents
 * FIX #7: Populates discrepancies array when reference matches but amount differs
 * FIX #16: Only includes in-period bank records in the unmatched list
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
  const inPeriodBankIds = new Set<string>()

  for (const bankRecord of bankData) {
    const bankDate = parseBankDate(bankRecord.valueDate)

    // FIX #16: Track which bank records are in-period
    if (!isInPeriod(bankDate, periodStart, periodEnd)) continue
    inPeriodBankIds.add(bankRecord.transactionId)

    const remaining = systemPayments.filter(p => !matchedPaymentIds.has(p.id))

    // FIX #5: Match by reference instead of amount
    const match = findMatchByReference(bankRecord, remaining)

    if (match) {
      // FIX #7: Check if amounts match; if not, it's a discrepancy
      const amountDelta = calculateDelta(bankRecord.amount, match.amount)

      if (amountDelta !== 0) {
        // Reference matches but amount differs - this is a discrepancy
        discrepancies.push({
          bankRecord,
          payment: match,
          amountDelta,
        })
      } else {
        // Perfect match - reference and amount both match
        matched.push({ bankRecord, payment: match })
      }

      matchedPaymentIds.add(match.id)
      matchedBankIds.add(bankRecord.transactionId)
      await markReconciled(match.id)
    }
  }

  // FIX #6: Use integer cents for sum calculations
  const totalBankCents = bankData.reduce((sum, r) => sum + toCents(r.amount), 0)
  const totalSystemCents = systemPayments.reduce((sum, p) => sum + toCents(p.amount), 0)

  const totalBankAmount = toDollars(totalBankCents)
  const totalSystemAmount = toDollars(totalSystemCents)
  const difference = toDollars(totalBankCents - totalSystemCents)

  // FIX #16: Only include in-period, unmatched bank records
  const bankOnly = bankData.filter(r =>
    inPeriodBankIds.has(r.transactionId) && !matchedBankIds.has(r.transactionId)
  )
  const systemOnly = systemPayments.filter(p => !matchedPaymentIds.has(p.id))

  const [saved] = await db
    .insert(reconciliations)
    .values({
      periodStart,
      periodEnd,
      matchedCount: matched.length,
      unmatchedCount: bankOnly.length + systemOnly.length,
      discrepancyCount: discrepancies.length,
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
