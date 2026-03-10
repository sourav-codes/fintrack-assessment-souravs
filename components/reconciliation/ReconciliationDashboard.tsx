'use client'

import { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface ReconciliationRun {
  id: string
  periodStart: string
  periodEnd: string
  matchedCount: number
  unmatchedCount: number
  difference: number
  status: 'pending' | 'running' | 'complete' | 'failed'
  createdAt: string
}

export function ReconciliationDashboard() {
  const [runs, setRuns] = useState<ReconciliationRun[]>([])

  /**
   * BUG #12:
   * Issue: `setInterval` is created but never cleared. Missing return statement
   *        with `clearInterval(interval)` in useEffect cleanup. This causes a
   *        memory leak and multiple intervals running simultaneously.
   * Severity: MEDIUM (Performance)
   * Suggested Solution: Add `return () => clearInterval(interval)` to useEffect.
   *
   * BUG #13:
   * Issue: Calls `GET /api/v1/reconcile` without an `id` parameter, but the API
   *        requires `id` to return data. Dashboard will always show empty.
   * Severity: MEDIUM (API)
   * Suggested Solution: Fix API to support listing all runs (see route.ts BUG #11),
   *                     or call correct endpoint.
   */
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/v1/reconcile')
        const data = await res.json()
        setRuns(data.runs ?? [])
      } catch {
        // silent
      }
    }, 3000)
  }, [])

  const formatAmount = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)

  const badgeClass: Record<ReconciliationRun['status'], string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    running: 'bg-blue-100 text-blue-800',
    complete: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  }

  return (
    <div className="p-6 space-y-6">
      {/*
        TASK 3c REQUIREMENT:
        Issue: Missing summary card above the table.
        Severity: N/A (New Feature)
        Suggested Solution: Add a summary card showing:
          - Total runs this month
          - Total discrepancy amount (sum of all `difference` values)
          - A "Trigger New Reconciliation" button (disabled with tooltip is acceptable)
      */}
      <Card>
        <CardHeader>
          <CardTitle>Reconciliation Runs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Matched</TableHead>
                <TableHead>Unmatched</TableHead>
                <TableHead>Discrepancy</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map(run => (
                <TableRow key={run.id}>
                  <TableCell>
                    {run.periodStart} – {run.periodEnd}
                  </TableCell>
                  <TableCell>{run.matchedCount}</TableCell>
                  <TableCell>{run.unmatchedCount}</TableCell>
                  <TableCell>{formatAmount(run.difference)}</TableCell>
                  <TableCell>
                    <Badge className={badgeClass[run.status]}>{run.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
