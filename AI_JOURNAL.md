# AI Usage Journal

## Tool(s) used
- Claude Code (Claude Opus 4.5)

## Interaction Log

| # | What I asked the AI | Quality of AI response (1-5) | Accepted? | My reasoning |
|---|---------------------|------------------------------|-----------|--------------|
| 1 | Analyze the assessment document and extract requirements, changes asked, and win conditions | 5 | Yes | Accurate extraction of all key information from the document |
| 2 | Create all required files and update CLARIFICATIONS.md and AUDIT.md | 5 | Yes | Successfully created all files with comprehensive analysis |
| 3 | Add inline comments documenting bugs with Issue/Severity/Suggested Solution pattern | 5 | Yes | Comments added to all three source files at the exact locations of each bug |
| 4 | Implement all fixes for the documented bugs | 5 | Yes | All 16 bugs fixed plus Task 3c new feature implemented |
| 5 | Fix #11 returning all entries without limit | 4 | Partial | Rejected unbounded query - added limit of 100 entries to prevent UI crashes |

## Progress Log

### Task 1: CLARIFICATIONS.md - COMPLETE
- Identified 7 ambiguities in the client brief
- Provided interpretations with reasoning for each
- Included compliance-related question about audit logging
- Identified engineering decision (integer cents vs decimal library)

### Task 2: AUDIT.md - COMPLETE
- Found 16 bugs across the three files
- 4 Critical (all security-related)
- 4 High (logic issues)
- 6 Medium (performance, API, logic)
- 2 Low (conventions)
- Mapped to PCI DSS and SOC 2 compliance violations

### Task 3: Implementation - COMPLETE
All bugs fixed and new feature implemented:

#### reconciler.ts Fixes:
| Bug # | Fix Applied |
|-------|-------------|
| #5 | Changed matching from amount-only to reference-based (`externalRef === reference`) |
| #6 | Added `toCents()` and `toDollars()` helpers; all arithmetic uses integer cents |
| #7 | Added discrepancy detection - when reference matches but amount differs, pushed to `discrepancies` array |
| #8 | Changed `markReconciled()` to atomic UPDATE with WHERE clause (no read-then-write race) |
| #9 | Added timezone validation in `parseBankDate()` - appends 'Z' if no timezone present |
| #14 | Changed status check to allow both 'pending' and 'cleared' via `inArray()` |
| #16 | Added `inPeriodBankIds` set to track and filter only in-period records for `bankOnly` |

#### route.ts Fixes:
| Bug # | Fix Applied |
|-------|-------------|
| #1 | Replaced raw SQL with Drizzle ORM `.update().set().where()` |
| #2 | Replaced raw SQL with Drizzle ORM `.select().from().where()` |
| #3 | Returns generic error messages; logs full error via `logger.error()` server-side |
| #4 | Added `getSession()` check at start of both POST and GET handlers |
| #10 | Removed redundant insert; `reconcilePayments()` handles persistence |
| #11 | GET now returns recent runs (limit 100, descending by date) when `id` is null, or specific run when `id` provided |
| #15 | Changed POST success response from `status: 200` to `status: 201` |

#### ReconciliationDashboard.tsx Fixes:
| Bug # | Fix Applied |
|-------|-------------|
| #12 | Added `return () => clearInterval(interval)` cleanup in useEffect |
| #13 | API call now works correctly after route.ts fix #11 |
| Task 3c | Added summary card grid with: Runs This Month, Total Discrepancy, Trigger New Reconciliation button (disabled with tooltip) |

### Task 4: AI Journal - COMPLETE

## Reflection

**Bugs AI found correctly** (that I then verified):
- SQL injection vulnerabilities in route.ts (string interpolation in SQL) - VERIFIED & FIXED
- Memory leak in useEffect (missing cleanup for setInterval) - VERIFIED & FIXED
- Floating-point arithmetic issues with monetary calculations - VERIFIED & FIXED with integer cents
- Missing discrepancies population in reconciler - VERIFIED & FIXED
- Error stack exposure in API response - VERIFIED & FIXED
- Race condition in markReconciled - VERIFIED & FIXED with atomic update
- Missing authentication - VERIFIED & FIXED

**Bugs AI missed or got wrong**:
- None identified during implementation - all documented bugs were valid

**AI-generated code you rejected** (with reason):
- Initially considered using `Decimal.js` library for monetary arithmetic, but rejected in favor of integer cents approach because:
  1. No external dependencies required
  2. Simpler and more performant
  3. Industry standard for financial applications
  4. Assessment rules state "You may not use any external reconciliation library"

- **Fix #11 - Unbounded query rejected**: AI's initial implementation returned ALL reconciliation runs without a limit. This was rejected because:
  1. Could crash the UI with large datasets (thousands of runs)
  2. Poor UX - users don't need to see all historical runs at once
  3. Network/memory overhead on both server and client
  4. **Modified to**: Limit 100 entries, ordered by most recent first (`desc(createdAt)`)

**The moment you most doubted the AI output and how you verified it**:
When implementing the atomic update for `markReconciled()`, I questioned whether the Drizzle ORM `.returning()` approach would correctly indicate if a row was updated. Verified by checking Drizzle ORM documentation - the returning clause returns an array of affected rows, so checking `result.length > 0` correctly determines if the update succeeded.

**What you know that the AI does not** (domain/architecture insight the AI could not have):
1. Financial reconciliation systems use reference numbers as primary keys because they're designed to be unique identifiers between banking systems - the bank's `reference` field corresponds to the payment's `externalRef`.
2. The "discrepancy" vs "unmatched" distinction is critical: a discrepancy is when you FOUND the transaction but amounts don't match (potential fraud/error), while unmatched means the transaction doesn't exist in one system (potential missing record/timing).
3. PCI DSS compliance requires that error messages never expose system internals - this is why generic errors are returned to clients while full details are logged server-side.
