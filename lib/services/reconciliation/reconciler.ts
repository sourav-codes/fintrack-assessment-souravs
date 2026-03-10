import { eq, between } from 'drizzle-orm'
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
 * Matching strategy: find by amount.
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
 */
function parseBankDate(isoString: string): Date {
  return new Date(isoString)
}

/**
 * Calculates the monetary discrepancy between a bank record and a payment.
 */
function calculateDelta(bankAmount: number, systemAmount: number): number {
  return bankAmount - systemAmount
}

/**
 * Marks a payment as reconciled.
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
