import { useNavigate } from 'react-router-dom'
import {
  Box, Typography, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow,
} from '@mui/material'
import { useTeam } from '../App'
import { api, type StatsResponse } from '../api'
import { useFetch } from '../hooks'
import {
  Loading, ErrorAlert, KpiCard, HorizontalBar, Section,
  CategoryBadge, TierBadge,
} from '../components'
import { colors, categoryColors, tierColors } from '../theme'

export default function OverviewPage() {
  const { team } = useTeam()
  const { data, loading, error } = useFetch<StatsResponse>(() => api.getStats(team), [team])
  const navigate = useNavigate()

  if (loading) return <Loading />
  if (error) return <ErrorAlert message={error} />
  if (!data) return null

  const kpis = [
    { label: 'Resolutions', value: data.counts.resolutions, color: colors.purple },
    { label: 'Patterns', value: data.counts.patterns, color: colors.green },
    { label: 'Errors', value: data.counts.errors, color: colors.red },
    { label: 'Modules', value: data.counts.modules, color: colors.blue },
    { label: 'Files', value: data.counts.files, color: colors.yellow },
    { label: 'Repos', value: data.counts.repos, color: colors.cyan },
  ]

  const maxCat = data.categories.length > 0 ? Math.max(...data.categories.map(c => c.count)) : 0
  const maxTier = data.tiers.length > 0 ? Math.max(...data.tiers.map(t => t.count)) : 0

  const tierLabels: Record<number, string> = { 1: 'Tier 1 (High)', 2: 'Tier 2 (Medium)', 3: 'Tier 3 (Low)' }

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 700 }}>Overview</Typography>

      {/* KPI Cards */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        {kpis.map((k) => (
          <KpiCard key={k.label} {...k} />
        ))}
      </Box>

      <Box sx={{ display: 'flex', gap: 3, mb: 3, flexWrap: 'wrap' }}>
        {/* Category Breakdown */}
        <Box sx={{ flex: '1 1 400px', minWidth: 300 }}>
          <Section title="Category Breakdown">
            {data.categories.length === 0 ? (
              <Typography sx={{ color: colors.text2 }}>No data</Typography>
            ) : (
              data.categories.map((c) => (
                <HorizontalBar
                  key={c.category}
                  label={c.category}
                  value={c.count}
                  max={maxCat}
                  color={categoryColors[c.category] || colors.purple}
                />
              ))
            )}
          </Section>
        </Box>

        {/* Tier Distribution */}
        <Box sx={{ flex: '1 1 400px', minWidth: 300 }}>
          <Section title="Quality Tier Distribution">
            {data.tiers.length === 0 ? (
              <Typography sx={{ color: colors.text2 }}>No data</Typography>
            ) : (
              data.tiers.map((t) => (
                <HorizontalBar
                  key={t.tier}
                  label={tierLabels[t.tier] || `Tier ${t.tier}`}
                  value={t.count}
                  max={maxTier}
                  color={tierColors[String(t.tier)] || colors.purple}
                />
              ))
            )}
          </Section>
        </Box>
      </Box>

      {/* Recent Resolutions */}
      <Section title="Recent Resolutions">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ color: colors.text2, fontWeight: 600 }}>Ticket</TableCell>
                <TableCell sx={{ color: colors.text2, fontWeight: 600 }}>Summary</TableCell>
                <TableCell sx={{ color: colors.text2, fontWeight: 600 }}>Category</TableCell>
                <TableCell sx={{ color: colors.text2, fontWeight: 600 }}>Tier</TableCell>
                <TableCell sx={{ color: colors.text2, fontWeight: 600 }}>Created</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(!data.recent || data.recent.length === 0) ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                    <Typography sx={{ color: colors.text2 }}>No recent resolutions</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                data.recent.map((r) => (
                  <TableRow
                    key={r.id}
                    hover
                    onClick={() => navigate(`/resolutions/${encodeURIComponent(r.id)}`)}
                    sx={{ cursor: 'pointer', '&:hover': { bgcolor: `${colors.surface2} !important` } }}
                  >
                    <TableCell>
                      <Typography variant="body2" sx={{ color: colors.purple, fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        {r.ticket_id || r.id.slice(0, 12)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 350 }}>
                        {r.summary || r.error || '--'}
                      </Typography>
                    </TableCell>
                    <TableCell><CategoryBadge category={r.category} /></TableCell>
                    <TableCell><TierBadge tier={r.tier} /></TableCell>
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
      </Section>
    </Box>
  )
}
