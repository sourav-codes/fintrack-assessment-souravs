# Requirements Clarifications

## Ambiguities and Unanswered Questions

### 1. Matching Strategy Definition

**Quote**: *"Payments need to be properly matched against the bank records"*

**Ambiguity**: What constitutes a "proper match"? The current code only matches by amount, which is insufficient.

**My Interpretation**: Match using a combination of:
- `externalRef` (payment) === `reference` (bank record) as primary key
- Amount must match exactly
- Date must be within reasonable tolerance (same day or T+1 for settlement delays)

**Why this interpretation**: In financial reconciliation, reference numbers are the standard primary matching key. Amount-only matching would create false positives when multiple payments share the same value. Reference-based matching is industry standard for B2B payment reconciliation.

---

### 2. Discrepancy Definition and Threshold

**Quote**: *"Any discrepancies should be flagged so the team can review them"*

**Ambiguity**: What counts as a discrepancy? Is it only amount differences, or also timing differences? Is there a tolerance threshold (e.g., ignore differences under $0.01)?

**My Interpretation**: A discrepancy occurs when:
- Reference matches but amounts differ (regardless of magnitude)
- All amount differences are flagged, including sub-cent differences

**Why this interpretation**: For a PCI DSS Level 1 / SOC 2 compliant system, financial accuracy is paramount. Even small discrepancies could indicate systemic issues (rounding errors, fee miscalculations). The finance team should decide what to ignore, not the system.

---

### 3. "Real-time" Definition

**Quote**: *"The system should do reconciliation in real-time — we can't wait for a nightly job"*

**Ambiguity**: Does "real-time" mean:
- (a) Synchronous API response (user uploads, waits, gets result)
- (b) Near-real-time streaming (webhook/SSE as matches are found)
- (c) On-demand (triggered manually, but completes immediately)

**My Interpretation**: Option (c) — on-demand synchronous processing. User triggers reconciliation via upload, receives complete results in the same HTTP response.

**Why this interpretation**: The existing API design is synchronous (POST returns result). The dashboard polls for history, not live updates. "Real-time" in the client's context means "not batch/nightly" rather than "streaming."

---

### 4. Handling Duplicate Transactions

**Quote**: (No explicit mention)

**Ambiguity**: How should the system handle:
- Duplicate bank records (same transactionId uploaded twice)
- Re-reconciling an already-reconciled payment
- Overlapping reconciliation periods

**My Interpretation**:
- Reject duplicate bank transactionIds within the same upload
- Skip payments already in 'reconciled' status (don't re-reconcile)
- Allow overlapping periods but warn in the response

**Why this interpretation**: Idempotency is critical for financial systems. Re-reconciling already-processed records could corrupt audit trails. The current code already checks for 'pending' status before marking reconciled, suggesting this was intended behavior.

---

### 5. Settlement Date vs. Transaction Date

**Quote**: Bank records have `valueDate`, payments have `createdAt`

**Ambiguity**: Should matching consider settlement delays? Bank `valueDate` (when funds moved) may differ from payment `createdAt` (when initiated) by 1-3 business days.

**My Interpretation**: Allow a configurable tolerance window (default: 3 business days). A bank record dated Jan 15 can match a payment created Jan 12-15.

**Why this interpretation**: ACH and wire transfers typically have T+1 to T+3 settlement. Strict date matching would cause false negatives for legitimate transactions.

---

### 6. Compliance Question: Audit Trail Requirements

**Quote**: *"We're PCI DSS Level 1 and SOC 2 certified"*

**Ambiguity**: What audit logging is required?
- Who initiated each reconciliation?
- What was the exact input data?
- What matches/decisions were made?
- How long must records be retained?

**My Interpretation**: Implement comprehensive audit logging:
- Log user ID, timestamp, input hash for each reconciliation
- Store full match reasoning (why each pair was matched)
- Retain reconciliation records for 7 years (PCI DSS requirement)

**Why this interpretation**: PCI DSS requires logging of all access to cardholder data and maintaining audit trails. SOC 2 requires demonstrable access controls and change tracking. The current code stores minimal metadata — this needs enhancement.

---

### 7. Error Handling for Partial Failures

**Quote**: (No explicit mention)

**Ambiguity**: If reconciliation partially completes (e.g., 50/100 records processed, then DB error), should the system:
- Roll back entirely
- Save partial results
- Mark run as 'failed' with partial data

**My Interpretation**: Use database transactions — all or nothing. A partial reconciliation would leave data in an inconsistent state.

**Why this interpretation**: Financial data integrity requires atomicity. Partial reconciliations could lead to double-processing on retry.

---

## Question I Would NOT Ask the Client

**Question**: "Should we use integer cents or a decimal library for monetary arithmetic?"

**Why this is an engineering decision**: This is an implementation detail the client neither knows nor cares about. What matters to them is accuracy. The correct answer (use integer cents or a library like `decimal.js`) is a technical best practice that any senior engineer should know. Asking this would waste the client's time and reduce their confidence in our expertise.

The client's requirement is "accurate financial calculations." How we achieve that is our job.
