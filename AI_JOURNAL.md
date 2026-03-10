# AI Usage Journal

## Tool(s) used
- Claude Code (Claude Opus 4.5)

## Interaction Log

| # | What I asked the AI | Quality of AI response (1-5) | Accepted? | My reasoning |
|---|---------------------|------------------------------|-----------|--------------|
| 1 | Analyze the assessment document and extract requirements, changes asked, and win conditions | 5 | Yes | Accurate extraction of all key information from the document |
| 2 | Create all required files and update CLARIFICATIONS.md and AUDIT.md | 5 | Yes | Successfully created all files with comprehensive analysis |
| 3 | Add inline comments documenting bugs with Issue/Severity/Suggested Solution pattern | 5 | Yes | Comments added to all three source files at the exact locations of each bug |

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

### Task 3: Implementation - IN PROGRESS
- Source files created with inline bug documentation
- Bug comments added with pattern: Issue, Severity, Suggested Solution
- Ready to implement fixes

### Task 4: AI Journal - IN PROGRESS
- Maintaining this log throughout

## Files Modified with Bug Comments

| File | Bugs Documented |
|------|-----------------|
| `reconciler.ts` | #5 (matching), #6 (floating-point), #7 (discrepancies), #8 (race condition), #9 (timezone), #14 (status check), #16 (unmatched filter) |
| `route.ts` | #1 (SQL injection POST), #2 (SQL injection GET), #3 (stack exposure), #4 (no auth), #10 (duplicate insert), #11 (GET without ID), #15 (HTTP status) |
| `ReconciliationDashboard.tsx` | #12 (memory leak), #13 (incorrect API call), Task 3c requirement (summary card) |

## Reflection

**Bugs AI found correctly** (that I then verified):
- SQL injection vulnerabilities in route.ts (string interpolation in SQL) - VERIFIED: lines 250-253 and 271-273
- Memory leak in useEffect (missing cleanup for setInterval) - VERIFIED: lines 311-319
- Floating-point arithmetic issues with monetary calculations - VERIFIED: standard JavaScript floating-point behavior
- Missing discrepancies population in reconciler - VERIFIED: array declared line 96, never populated
- Error stack exposure in API response - VERIFIED: line 263 returns error.stack
- Race condition in markReconciled - VERIFIED: separate read then write without transaction

**Bugs AI missed or got wrong**:
- (To be updated after implementation and testing)

**AI-generated code you rejected** (with reason):
- (To be updated as implementation progresses)

**The moment you most doubted the AI output and how you verified it**:
When analyzing the matching strategy issue, I considered whether amount-only matching might be intentional for some use cases. Verified it's incorrect by reasoning: in B2B payments, multiple invoices commonly share amounts (e.g., monthly subscription fees). Reference-based matching is the industry standard.

**What you know that the AI does not** (domain/architecture insight the AI could not have):
Financial reconciliation systems typically use reference numbers as primary keys because they're designed to be unique identifiers between systems. The bank's `reference` field corresponds to the payment's `externalRef` - this is domain knowledge from understanding how payment systems communicate.
