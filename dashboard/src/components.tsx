import React from 'react'
import {
  Box, Paper, Typography, Chip, CircularProgress, Alert, Skeleton,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TablePagination, TableSortLabel, TextField, MenuItem, Select,
  FormControl, InputLabel, type SelectChangeEvent,
} from '@mui/material'
import { colors, categoryColors, tierColors } from './theme'

/* ─── Loading / Error ─── */
export function Loading() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
      <CircularProgress sx={{ color: colors.purple }} />
    </Box>
  )
}

export function ErrorAlert({ message }: { message: string }) {
  return <Alert severity="error" sx={{ mb: 2 }}>{message}</Alert>
}

export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Box>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} variant="rectangular" height={48} sx={{ mb: 1, borderRadius: 1, bgcolor: colors.surface2 }} />
      ))}
    </Box>
  )
}

/* ─── KPI Card ─── */
export function KpiCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <Paper sx={{
      p: 2.5, flex: '1 1 160px', minWidth: 160,
      background: colors.surface,
      borderLeft: `3px solid ${color}`,
    }}>
      <Typography variant="body2" sx={{ color: colors.text2, mb: 0.5, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </Typography>
      <Typography variant="h4" sx={{ color, fontWeight: 700, fontSize: '1.75rem' }}>
        {value}
      </Typography>
    </Paper>
  )
}

/* ─── Category / Tier Badge ─── */
export function CategoryBadge({ category }: { category?: string | null }) {
  if (!category) return null
  const color = categoryColors[category] || colors.text2
  return (
    <Chip
      label={category}
      size="small"
      sx={{
        bgcolor: `${color}18`,
        color,
        border: `1px solid ${color}40`,
        fontWeight: 500,
        fontSize: '0.7rem',
      }}
    />
  )
}

export function TierBadge({ tier }: { tier?: string | number | null }) {
  if (tier === null || tier === undefined) return null
  const tierStr = String(tier)
  const label = tier === 1 || tierStr === '1' ? 'Tier 1' : tier === 2 || tierStr === '2' ? 'Tier 2' : tier === 3 || tierStr === '3' ? 'Tier 3' : `Tier ${tier}`
  const color = tierColors[tierStr] || colors.text2
  return (
    <Chip
      label={label}
      size="small"
      sx={{
        bgcolor: `${color}18`,
        color,
        border: `1px solid ${color}40`,
        fontWeight: 500,
        fontSize: '0.7rem',
      }}
    />
  )
}

/* ─── Horizontal bar ─── */
export function HorizontalBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="body2" sx={{ color: colors.text }}>{label}</Typography>
        <Typography variant="body2" sx={{ color: colors.text2 }}>{value}</Typography>
      </Box>
      <Box sx={{ height: 8, borderRadius: 4, bgcolor: colors.surface2, overflow: 'hidden' }}>
        <Box sx={{ height: '100%', width: `${pct}%`, bgcolor: color, borderRadius: 4, transition: 'width 0.5s ease' }} />
      </Box>
    </Box>
  )
}

/* ─── Section wrapper ─── */
export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Paper sx={{ p: 3, mb: 3, background: colors.surface }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">{title}</Typography>
        {action}
      </Box>
      {children}
    </Paper>
  )
}

/* ─── Resolutions Table (shared) ─── */
interface ResolutionsTableProps {
  resolutions: Array<{
    id: string; ticket_id?: string | null; summary?: string | null;
    category?: string | null; quality_tier?: string | number | null;
    tier?: number | null;
    ticket_type?: string | null;
    ticket_priority?: string | null;
    assignee?: string | null;
    pr_repo?: string | null;
    pr_author?: string | null;
    created_at?: string | null
  }>
  total: number
  page: number
  rowsPerPage: number
  onPageChange: (page: number) => void
  onRowsPerPageChange: (rpp: number) => void
  onRowClick: (id: string) => void
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  onSort?: (field: string) => void
  search?: string
  onSearchChange?: (v: string) => void
  categoryFilter?: string
  onCategoryFilterChange?: (v: string) => void
  tierFilter?: string
  onTierFilterChange?: (v: string) => void
  categories?: string[]
  tiers?: string[]
  showFilters?: boolean
}

export function ResolutionsTable({
  resolutions, total, page, rowsPerPage,
  onPageChange, onRowsPerPageChange, onRowClick,
  sortBy, sortOrder = 'desc', onSort,
  search, onSearchChange,
  categoryFilter, onCategoryFilterChange,
  tierFilter, onTierFilterChange,
  categories = [], tiers = [],
  showFilters = false,
}: ResolutionsTableProps) {
  const sortableColumns = [
    { id: 'ticket_id', label: 'Ticket' },
    { id: 'summary', label: 'Summary' },
    { id: 'category', label: 'Category' },
    { id: 'quality_tier', label: 'Tier' },
    { id: 'assignee', label: 'Assignee' },
    { id: 'pr_repo', label: 'Repo' },
    { id: 'created_at', label: 'Created' },
  ]

  return (
    <Box>
      {showFilters && (
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder="Search ticket ID, summary, error..."
            value={search || ''}
            onChange={(e) => onSearchChange?.(e.target.value)}
            sx={{ minWidth: 280, '& .MuiOutlinedInput-root': { bgcolor: colors.surface2 } }}
          />
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Category</InputLabel>
            <Select
              value={categoryFilter || ''}
              label="Category"
              onChange={(e: SelectChangeEvent) => onCategoryFilterChange?.(e.target.value)}
              sx={{ bgcolor: colors.surface2 }}
            >
              <MenuItem value="">All</MenuItem>
              {categories.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Tier</InputLabel>
            <Select
              value={tierFilter || ''}
              label="Tier"
              onChange={(e: SelectChangeEvent) => onTierFilterChange?.(e.target.value)}
              sx={{ bgcolor: colors.surface2 }}
            >
              <MenuItem value="">All</MenuItem>
              {tiers.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
      )}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              {sortableColumns.map((col) => (
                <TableCell key={col.id}>
                  {onSort ? (
                    <TableSortLabel
                      active={sortBy === col.id}
                      direction={sortBy === col.id ? sortOrder : 'asc'}
                      onClick={() => onSort(col.id)}
                      sx={{ color: `${colors.text2} !important`, '& .MuiTableSortLabel-icon': { color: `${colors.text2} !important` } }}
                    >
                      {col.label}
                    </TableSortLabel>
                  ) : (
                    <Typography variant="body2" sx={{ color: colors.text2, fontWeight: 600 }}>{col.label}</Typography>
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {resolutions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                  <Typography sx={{ color: colors.text2 }}>No resolutions found</Typography>
                </TableCell>
              </TableRow>
            ) : (
              resolutions.map((r) => (
                <TableRow
                  key={r.id}
                  hover
                  onClick={() => onRowClick(r.id)}
                  sx={{ cursor: 'pointer', '&:hover': { bgcolor: `${colors.surface2} !important` } }}
                >
                  <TableCell>
                    <Typography variant="body2" sx={{ color: colors.purple, fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {r.ticket_id || r.id.slice(0, 12)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" noWrap sx={{ maxWidth: 280 }}>
                      {r.summary || '--'}
                    </Typography>
                  </TableCell>
                  <TableCell><CategoryBadge category={r.category} /></TableCell>
                  <TableCell><TierBadge tier={r.quality_tier ?? r.tier} /></TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ color: colors.text2, fontSize: '0.8rem' }}>
                      {r.assignee || '--'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ color: colors.text2, fontSize: '0.8rem' }}>
                      {r.pr_repo || '--'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ color: colors.text2, fontSize: '0.8rem' }}>
                      {r.created_at ? new Date(r.created_at).toLocaleDateString() : '--'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={total}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={(_, p) => onPageChange(p)}
        onRowsPerPageChange={(e) => onRowsPerPageChange(parseInt(e.target.value, 10))}
        rowsPerPageOptions={[10, 20, 50]}
        sx={{ color: colors.text2, borderTop: `1px solid ${colors.border}` }}
      />
    </Box>
  )
}
