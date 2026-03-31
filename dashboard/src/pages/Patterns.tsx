import { useState, useMemo } from 'react'
import {
  Box, Typography, Paper, Chip, Collapse, IconButton,
  FormControl, Select, MenuItem, InputLabel, Pagination,
  Link, Table, TableBody, TableCell, TableRow,
  type SelectChangeEvent,
} from '@mui/material'
import {
  ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material'
import { useNavigate } from 'react-router-dom'
import { useTeam } from '../App'
import { api, type PatternData } from '../api'
import { useFetch } from '../hooks'
import { Loading, ErrorAlert } from '../components'
import { colors, categoryColors } from '../theme'

const ITEMS_PER_PAGE = 12

const signatureLabel: Record<string, string> = {
  bugfix: 'Error Signature',
  feature: 'Pattern',
  refactor: 'Pattern',
  config_change: 'Pattern',
}

function formatDate(d: string | null): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return d }
}

export default function PatternsPage() {
  const { team } = useTeam()
  const navigate = useNavigate()
  const [sortBy, setSortBy] = useState('occurrences')
  const [sortOrder] = useState<'desc'>('desc')
  const [filterCategory, setFilterCategory] = useState<string>('')
  const { data, loading, error } = useFetch<PatternData[]>(
    () => api.getPatterns({ team, sort: sortBy, order: sortOrder }),
    [team, sortBy, sortOrder],
  )

  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const sorted = useMemo(() => {
    if (!data) return []
    let arr = [...data]
    if (filterCategory) arr = arr.filter((p) => p.category === filterCategory)
    arr.sort((a, b) => {
      if (sortBy === 'success_rate') return (b.success_rate ?? 0) - (a.success_rate ?? 0)
      return (b.occurrences ?? 0) - (a.occurrences ?? 0)
    })
    return arr
  }, [data, sortBy, filterCategory])

  const totalPages = Math.ceil(sorted.length / ITEMS_PER_PAGE)
  const paginated = sorted.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  if (loading) return <Loading />
  if (error) return <ErrorAlert message={error} />

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>Patterns</Typography>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Category</InputLabel>
            <Select
              value={filterCategory}
              label="Category"
              onChange={(e: SelectChangeEvent) => { setFilterCategory(e.target.value); setPage(1) }}
              sx={{ bgcolor: colors.surface2 }}
            >
              <MenuItem value="">All</MenuItem>
              <MenuItem value="bugfix">Bugfix</MenuItem>
              <MenuItem value="feature">Feature</MenuItem>
              <MenuItem value="refactor">Refactor</MenuItem>
              <MenuItem value="config_change">Config Change</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Sort by</InputLabel>
            <Select
              value={sortBy}
              label="Sort by"
              onChange={(e: SelectChangeEvent) => { setSortBy(e.target.value); setPage(1) }}
              sx={{ bgcolor: colors.surface2 }}
            >
              <MenuItem value="occurrences">Occurrences</MenuItem>
              <MenuItem value="success_rate">Success Rate</MenuItem>
            </Select>
          </FormControl>
        </Box>
      </Box>

      {sorted.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center', bgcolor: colors.surface }}>
          <Typography sx={{ color: colors.text2 }}>No patterns found</Typography>
        </Paper>
      ) : (
        <>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 3 }}>
            {paginated.map((pattern, idx) => {
              const patternId = pattern.id || `pattern-${(page - 1) * ITEMS_PER_PAGE + idx}`
              const isExpanded = expandedId === patternId
              const resolutions = pattern.resolutions ?? []
              const firstSeen = resolutions.length > 0
                ? formatDate(resolutions[resolutions.length - 1]?.created_at)
                : '—'
              const lastSeen = resolutions.length > 0
                ? formatDate(resolutions[0]?.created_at)
                : '—'

              return (
                <Paper
                  key={patternId}
                  sx={{
                    p: 2.5, bgcolor: colors.surface,
                    cursor: 'pointer',
                    transition: 'border-color 0.2s',
                    '&:hover': { borderColor: colors.purple },
                  }}
                  onClick={() => setExpandedId(isExpanded ? null : patternId)}
                >
                  {/* Header */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
                    <Box sx={{ flex: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <Chip
                          label={pattern.category}
                          size="small"
                          sx={{
                            bgcolor: `${categoryColors[pattern.category] ?? colors.text2}20`,
                            color: categoryColors[pattern.category] ?? colors.text2,
                            fontSize: '0.65rem', height: 20, fontWeight: 600,
                          }}
                        />
                        <Typography variant="caption" sx={{ color: colors.text2, fontSize: '0.65rem', textTransform: 'uppercase' }}>
                          {signatureLabel[pattern.category] ?? 'Pattern'}
                        </Typography>
                      </Box>
                      <Typography variant="body2" sx={{
                        fontWeight: 600, mb: 0.5,
                        fontFamily: pattern.category === 'bugfix' ? 'monospace' : 'inherit',
                        color: categoryColors[pattern.category] ?? colors.text,
                        fontSize: '0.85rem',
                      }}>
                        {pattern.error_signature
                          ? (pattern.error_signature.length > 100
                            ? pattern.error_signature.slice(0, 98) + '..'
                            : pattern.error_signature)
                          : 'Unknown pattern'}
                      </Typography>
                      {pattern.root_cause && pattern.category === 'bugfix' && (
                        <Typography variant="body2" sx={{ color: colors.text2, fontSize: '0.8rem', mt: 0.5 }}>
                          {pattern.root_cause.length > 120
                            ? pattern.root_cause.slice(0, 118) + '..'
                            : pattern.root_cause}
                        </Typography>
                      )}
                    </Box>
                    <IconButton size="small" sx={{ color: colors.text2, ml: 1 }}>
                      {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    </IconButton>
                  </Box>

                  {/* Stats row */}
                  <Box sx={{ display: 'flex', gap: 3, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Chip
                      label={`${pattern.occurrences ?? resolutions.length} occurrence${(pattern.occurrences ?? resolutions.length) !== 1 ? 's' : ''}`}
                      size="small"
                      sx={{
                        bgcolor: `${colors.purple}20`,
                        color: colors.purple,
                        fontWeight: 600,
                      }}
                    />
                    {firstSeen !== '—' && (
                      <Typography variant="caption" sx={{ color: colors.text2, fontSize: '0.7rem' }}>
                        First: {firstSeen} &middot; Last: {lastSeen}
                      </Typography>
                    )}
                  </Box>

                  {/* Preview: show first 3 related tickets inline */}
                  {resolutions.length > 0 && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {resolutions.slice(0, 4).map((r, i) => (
                        <Chip
                          key={i}
                          label={r.ticket_id ?? r.pr_title ?? r.id?.slice(0, 8) ?? '?'}
                          size="small"
                          sx={{
                            bgcolor: `${categoryColors[r.category ?? ''] ?? colors.text2}15`,
                            color: categoryColors[r.category ?? ''] ?? colors.text2,
                            fontSize: '0.7rem',
                            fontWeight: 500,
                          }}
                        />
                      ))}
                      {resolutions.length > 4 && (
                        <Chip
                          label={`+${resolutions.length - 4} more`}
                          size="small"
                          sx={{ bgcolor: colors.surface2, color: colors.text2, fontSize: '0.7rem' }}
                        />
                      )}
                    </Box>
                  )}

                  {/* Expanded details */}
                  <Collapse in={isExpanded}>
                    <Box sx={{ pt: 2, borderTop: `1px solid ${colors.border}`, mt: 1.5 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Root cause & Fix */}
                      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 2 }}>
                        {pattern.root_cause && (
                          <Box>
                            <Typography variant="caption" sx={{ color: colors.text2, textTransform: 'uppercase', fontSize: '0.65rem', fontWeight: 600 }}>
                              Root Cause
                            </Typography>
                            <Typography variant="body2" sx={{ mt: 0.5, lineHeight: 1.6, fontSize: '0.8rem' }}>
                              {pattern.root_cause}
                            </Typography>
                          </Box>
                        )}
                        {pattern.fix_approach && (
                          <Box>
                            <Typography variant="caption" sx={{ color: colors.text2, textTransform: 'uppercase', fontSize: '0.65rem', fontWeight: 600 }}>
                              Fix Approach
                            </Typography>
                            <Typography variant="body2" sx={{ mt: 0.5, lineHeight: 1.6, fontSize: '0.8rem' }}>
                              {pattern.fix_approach}
                            </Typography>
                          </Box>
                        )}
                      </Box>

                      {/* Full error signature */}
                      {pattern.error_signature && (
                        <Box sx={{ mb: 2 }}>
                          <Typography variant="caption" sx={{ color: colors.text2, textTransform: 'uppercase', fontSize: '0.65rem', fontWeight: 600 }}>
                            Error Signature
                          </Typography>
                          <Typography variant="body2" sx={{
                            fontFamily: 'monospace', bgcolor: colors.surface2,
                            p: 1.5, borderRadius: 1, mt: 0.5, whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all', fontSize: '0.75rem',
                          }}>
                            {pattern.error_signature}
                          </Typography>
                        </Box>
                      )}

                      {/* Related Resolutions table */}
                      {resolutions.length > 0 && (
                        <Box sx={{ mb: 2 }}>
                          <Typography variant="caption" sx={{ color: colors.text2, textTransform: 'uppercase', fontSize: '0.65rem', fontWeight: 600, mb: 1, display: 'block' }}>
                            Related Tickets & PRs
                          </Typography>
                          <Table size="small" sx={{ '& td, & th': { py: 0.8, px: 1, border: 'none' } }}>
                            <TableBody>
                              {resolutions.map((r, i) => (
                                <TableRow
                                  key={i}
                                  sx={{
                                    '&:hover': { bgcolor: colors.surface2 },
                                    cursor: r.id ? 'pointer' : 'default',
                                    borderBottom: `1px solid ${colors.border}`,
                                  }}
                                  onClick={() => r.id && navigate(`/resolutions/${r.id}`)}
                                >
                                  <TableCell sx={{ width: 90 }}>
                                    {r.ticket_id ? (
                                      <Typography variant="body2" sx={{ fontWeight: 600, color: colors.lavender, fontSize: '0.78rem' }}>
                                        {r.ticket_id}
                                      </Typography>
                                    ) : (
                                      <Typography variant="body2" sx={{ color: colors.text2, fontSize: '0.75rem' }}>—</Typography>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Typography variant="body2" sx={{ fontSize: '0.78rem', lineHeight: 1.4 }}>
                                      {r.summary ?? r.pr_title ?? '—'}
                                    </Typography>
                                  </TableCell>
                                  <TableCell sx={{ width: 80 }}>
                                    {r.category && (
                                      <Chip
                                        label={r.category}
                                        size="small"
                                        sx={{
                                          bgcolor: `${categoryColors[r.category] ?? colors.text2}20`,
                                          color: categoryColors[r.category] ?? colors.text2,
                                          fontSize: '0.65rem', height: 20,
                                        }}
                                      />
                                    )}
                                  </TableCell>
                                  <TableCell sx={{ width: 100 }}>
                                    <Typography variant="caption" sx={{ color: colors.text2, fontSize: '0.7rem' }}>
                                      {formatDate(r.created_at)}
                                    </Typography>
                                  </TableCell>
                                  <TableCell sx={{ width: 80 }}>
                                    {r.pr_author && (
                                      <Typography variant="caption" sx={{ color: colors.text2, fontSize: '0.7rem' }}>
                                        {r.pr_author}
                                      </Typography>
                                    )}
                                  </TableCell>
                                  <TableCell sx={{ width: 30 }}>
                                    {r.pr_url && (
                                      <Link href={r.pr_url} target="_blank" rel="noopener"
                                        onClick={(e) => e.stopPropagation()}
                                        sx={{ color: colors.text2, '&:hover': { color: colors.blue } }}
                                      >
                                        <OpenInNewIcon sx={{ fontSize: 14 }} />
                                      </Link>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </Box>
                      )}

                      {/* Files */}
                      {pattern.files && pattern.files.length > 0 && (
                        <Box>
                          <Typography variant="caption" sx={{ color: colors.text2, textTransform: 'uppercase', fontSize: '0.65rem', fontWeight: 600 }}>
                            Affected Files
                          </Typography>
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                            {pattern.files.map((f, i) => (
                              <Chip
                                key={i}
                                label={f.length > 40 ? '..' + f.slice(-38) : f}
                                size="small"
                                sx={{
                                  bgcolor: `${colors.yellow}12`,
                                  color: colors.yellow,
                                  fontFamily: 'monospace',
                                  fontSize: '0.65rem',
                                }}
                              />
                            ))}
                          </Box>
                        </Box>
                      )}
                    </Box>
                  </Collapse>
                </Paper>
              )
            })}
          </Box>

          {totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <Pagination
                count={totalPages}
                page={page}
                onChange={(_, p) => setPage(p)}
                sx={{
                  '& .MuiPaginationItem-root': { color: colors.text2 },
                  '& .Mui-selected': { bgcolor: `${colors.purple}30 !important`, color: colors.purple },
                }}
              />
            </Box>
          )}
        </>
      )}
    </Box>
  )
}
