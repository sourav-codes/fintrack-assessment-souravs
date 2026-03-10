# Code Audit Report

## Bug Summary

| # | File | Location | Severity | Category | Description | Correct Fix |
|---|------|----------|----------|----------|-------------|-------------|
| 1 | `route.ts` | Line 250-253 | **Critical** | Security | **SQL Injection**: Raw string interpolation in SQL query (`'${runId}'`, `'${parsed.notes}'`). Attacker can inject arbitrary SQL via the `notes` field. | Use parameterized queries with Drizzle ORM's prepared statements or `.insert()` method |
| 2 | `route.ts` | Line 271-273 | **Critical** | Security | **SQL Injection**: The `id` parameter from query string is directly interpolated into SQL (`WHERE id = '${id}'`). | Use parameterized queries: `db.select().from(reconciliation_runs).where(eq(id, params.id))` |
| 3 | `route.ts` | Line 263 | **Critical** | Security | **Stack Trace Exposure**: Full error stack is returned to client (`error.stack`), revealing internal implementation details, file paths, and potentially sensitive information. | Return generic error message: `{ error: 'Reconciliation failed' }`. Log full error server-side. |
| 4 | `route.ts` | Line 243-264 | **Critical** | Security | **Missing Authentication**: No authentication check before processing financial data. Any caller can trigger reconciliation and access records. | Add `const session = await getSession(); if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })` |
| 5 | `reconciler.ts` | Line 112-114 | **High** | Logic | **Incorrect Matching Strategy**: Matching only by amount will produce false positives. Multiple payments often share the same amount (e.g., subscription fees). | Match by `reference` === `externalRef` as primary key, with amount as validation |
| 6 | `reconciler.ts` | Line 186-188 | **High** | Logic | **Floating-Point Arithmetic**: Summing dollar amounts with `reduce()` accumulates floating-point errors (e.g., 0.1 + 0.2 = 0.30000000000000004). In financial reconciliation, this produces incorrect totals. | Convert to integer cents for arithmetic, or use a decimal library. `Math.round(sum * 100) / 100` at minimum. |
| 7 | `reconciler.ts` | Line 167-184 | **High** | Logic | **Discrepancies Never Populated**: The `discrepancies` array is declared but never filled. Records that match by reference but differ in amount should be flagged as discrepancies, not matches. | Add logic: if reference matches but amount differs, push to `discrepancies` instead of `matched` |
| 8 | `reconciler.ts` | Line 140-152 | **High** | Logic | **Race Condition in markReconciled**: Two concurrent requests could both read `status === 'pending'`, then both update. No transaction or optimistic locking. | Use a database transaction with row-level locking, or atomic update: `UPDATE ... WHERE id = ? AND status = 'pending'` |
| 9 | `reconciler.ts` | Line 126-128 | **Medium** | Logic | **Timezone-Naive Date Parsing**: `new Date(isoString)` parses in local timezone if string lacks offset. Bank dates might be in different timezone than server. | Use explicit timezone handling: `new Date(isoString)` is fine for ISO 8601 with offset; validate input format includes timezone |
| 10 | `route.ts` | Line 247-253 | **Medium** | Logic | **Redundant/Orphan Insert**: A `reconciliation_runs` record is created (line 250-253), but `reconcilePayments()` also inserts into `reconciliations` table (line 193-205). This creates duplicate/disconnected records. | Remove the raw SQL insert; let `reconcilePayments()` handle persistence, or unify the tables |
| 11 | `route.ts` | Line 267-275 | **Medium** | API | **GET Without ID Returns Nothing Useful**: When `id` is null, the query `WHERE id = 'null'` returns empty set. Should return list of runs for dashboard. | Check if `id` is null: if so, return recent runs (limit 100, desc by date); otherwise filter by id |
| 12 | `Dashboard.tsx` | Line 311-319 | **Medium** | Performance | **Memory Leak**: `setInterval` is created but never cleared. Missing return statement with `clearInterval(interval)` in useEffect cleanup. | Add `return () => clearInterval(interval)` to useEffect |
| 13 | `Dashboard.tsx` | Line 313-314 | **Medium** | API | **Incorrect API Call**: Calls `GET /api/v1/reconcile` without an `id` parameter, but the API requires `id` to return data (see bug #11). Dashboard will always show empty. | Fix API to support listing all runs, or call correct endpoint |
| 14 | `reconciler.ts` | Line 146-151 | **Medium** | Logic | **Status Check Too Restrictive**: Only updates if `status === 'pending'`, but `cleared` payments should also be reconcilable. | Allow status in `['pending', 'cleared']` to be marked as reconciled |
| 15 | `route.ts` | Line 261 | **Low** | API | **Incorrect HTTP Status**: Returns 200 for successful creation. RESTful convention is 201 Created for POST that creates a resource. | Change to `{ status: 201 }` |
| 16 | `reconciler.ts` | Line 190 | **Low** | Logic | **Unmatched Bank Records Include Out-of-Period**: `bankOnly` includes records filtered out by `isInPeriod()`, which weren't actually "unmatched" — they were excluded. | Track excluded-by-period separately, or filter `bankOnly` to only in-period records |

## Compliance Concerns

### PCI DSS Violations
- **Req 6.5.1**: SQL injection vulnerabilities (bugs #1, #2)
- **Req 8.1**: Missing authentication (bug #4)
- **Req 10.2**: No audit logging of who accessed/modified financial data

### SOC 2 Violations
- **CC6.1**: Access controls not enforced (bug #4)
- **CC7.2**: Error handling exposes system information (bug #3)

## Priority Order for Fixes

1. **Immediate** (Critical Security): Bugs #1, #2, #3, #4
2. **Before Production** (High Logic): Bugs #5, #6, #7, #8
3. **Should Fix** (Medium): Bugs #9, #10, #11, #12, #13, #14
4. **Nice to Have** (Low): Bugs #15, #16
