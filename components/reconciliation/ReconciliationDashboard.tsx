'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
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
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /**
   * FIX #12: Added cleanup function to clear interval on unmount.
   * FIX #13: API endpoint now works correctly (route.ts was fixed to return all runs).
   */
  useEffect(() => {
    // Initial fetch
    const fetchRuns = async () => {
      try {
        setIsLoading(true)
        const res = await fetch('/api/v1/reconcile')
        if (!res.ok) {
          throw new Error('Failed to fetch reconciliation runs')
        }
        const data = await res.json()
        setRuns(data.runs ?? [])
        setError(null)
      } catch (err) {
        setError('Failed to load reconciliation data')
        console.error('Fetch error:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchRuns()

    // Set up polling interval
    const interval = setInterval(fetchRuns, 3000)

    // FIX #12: Cleanup function to prevent memory leak
    return () => clearInterval(interval)
  }, [])

  const formatAmount = useCallback((amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount),
    []
  )

  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }, [])

  const badgeClass: Record<ReconciliationRun['status'], string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    running: 'bg-blue-100 text-blue-800',
    complete: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  }

  /**
   * TASK 3c: Calculate summary statistics
   * - Total runs this month
   * - Total discrepancy amount (sum of all difference values)
   */
  const summaryStats = useMemo(() => {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const runsThisMonth = runs.filter(run => {
      const runDate = new Date(run.createdAt)
      return runDate >= startOfMonth
    })

    // Use integer cents for accurate summation, then convert back
    const totalDiscrepancyCents = runs.reduce(
      (sum, run) => sum + Math.round(run.difference * 100),
      0
    )

    return {
      totalRunsThisMonth: runsThisMonth.length,
      totalDiscrepancy: totalDiscrepancyCents / 100,
    }
  }, [runs])

  return (
    <TooltipProvider>
      <div className="p-6 space-y-6">
        {/* TASK 3c: Summary Card */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Runs This Month
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {summaryStats.totalRunsThisMonth}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Discrepancy
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${
                summaryStats.totalDiscrepancy !== 0 ? 'text-amber-600' : 'text-green-600'
              }`}>
                {formatAmount(summaryStats.totalDiscrepancy)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Actions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button disabled className="w-full">
                    Trigger New Reconciliation
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Upload bank records to start a new reconciliation run</p>
                </TooltipContent>
              </Tooltip>
            </CardContent>
          </Card>
        </div>

        {/* Error State */}
        {error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <p className="text-red-800">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Reconciliation Runs Table */}
        <Card>
          <CardHeader>
            <CardTitle>Reconciliation Runs</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && runs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading reconciliation data...
              </div>
            ) : runs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No reconciliation runs found. Trigger a new reconciliation to get started.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Matched</TableHead>
                    <TableHead className="text-right">Unmatched</TableHead>
                    <TableHead className="text-right">Discrepancy</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map(run => (
                    <TableRow key={run.id}>
                      <TableCell>
                        {formatDate(run.periodStart)} – {formatDate(run.periodEnd)}
                      </TableCell>
                      <TableCell className="text-right">{run.matchedCount}</TableCell>
                      <TableCell className="text-right">{run.unmatchedCount}</TableCell>
                      <TableCell className={`text-right ${
                        run.difference !== 0 ? 'text-amber-600 font-medium' : ''
                      }`}>
                        {formatAmount(run.difference)}
                      </TableCell>
                      <TableCell>
                        <Badge className={badgeClass[run.status]}>{run.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  )
}
