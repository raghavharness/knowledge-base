import { useState } from 'react'
import {
  Box, Typography, Paper, Chip, Collapse,
  Pagination, Link, Stepper, Step, StepLabel, StepContent,
} from '@mui/material'
import {
  ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon,
  OpenInNew as OpenInNewIcon, Psychology as PsychologyIcon,
  AccessTime as TimeIcon, Repeat as RepeatIcon,
  AccountTree as PatternIcon, Person as PersonIcon,
} from '@mui/icons-material'
import { useTeam } from '../App'
import { api, type InsightData, type KnowledgeRef } from '../api'
import { useFetch } from '../hooks'
import { Loading, ErrorAlert } from '../components'
import { colors } from '../theme'

const ITEMS_PER_PAGE = 8

const typeLabels: Record<string, string> = {
  code_fix: 'Code Fix',
  config_change: 'Config Change',
  knowledge_gap: 'Knowledge Gap',
  expected_behavior: 'Expected Behavior',
  documentation: 'Documentation',
  environment: 'Environment',
}

const typeColors: Record<string, string> = {
  code_fix: colors.green,
  config_change: colors.cyan,
  knowledge_gap: colors.yellow,
  expected_behavior: colors.blue,
  documentation: colors.lavender,
  environment: colors.pink,
}

const inputLabels: Record<string, string> = {
  jira_ticket: 'JIRA Ticket',
  pr: 'Pull Request',
  gcp_log: 'GCP Log',
  direct: 'Direct Input',
  no_input: 'Auto-detect',
}

function formatDate(d: string | null): string {
  if (!d) return '--'
  try {
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch { return d }
}

function formatDateTime(d: string | null): string {
  if (!d) return '--'
  try {
    return new Date(d).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return d }
}

function timeAgo(d: string | null): string {
  if (!d) return ''
  try {
    const diff = Date.now() - new Date(d).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    if (days < 30) return `${days}d ago`
    return formatDate(d)
  } catch { return '' }
}

function StatChip({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string | number; color: string
}) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 0.5,
      bgcolor: `${color}12`, px: 1.5, py: 0.5, borderRadius: 2,
      border: `1px solid ${color}25`,
    }}>
      <Box sx={{ color, display: 'flex', alignItems: 'center', '& svg': { fontSize: 14 } }}>{icon}</Box>
      <Typography variant="caption" sx={{ color: colors.text2, fontSize: '0.65rem' }}>{label}</Typography>
      <Typography variant="caption" sx={{ color, fontWeight: 600, fontSize: '0.7rem' }}>{value}</Typography>
    </Box>
  )
}

function InsightCard({ insight }: { insight: InsightData }) {
  const [expanded, setExpanded] = useState(false)
  const typeColor = typeColors[insight.resolution_type ?? ''] ?? colors.text2
  const typeLabel = typeLabels[insight.resolution_type ?? ''] ?? insight.resolution_type ?? 'Unknown'

  return (
    <Paper
      sx={{
        bgcolor: colors.surface, overflow: 'hidden',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        '&:hover': { borderColor: colors.purple, boxShadow: `0 0 20px ${colors.purple}10` },
      }}
    >
      {/* Top accent bar */}
      <Box sx={{ height: 3, background: `linear-gradient(90deg, ${typeColor}, ${colors.purple})` }} />

      <Box
        sx={{ p: 2.5, cursor: 'pointer', userSelect: 'text' }}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Header row */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, flexWrap: 'wrap' }}>
              <Chip
                label={typeLabel}
                size="small"
                sx={{
                  bgcolor: `${typeColor}20`, color: typeColor,
                  fontSize: '0.65rem', height: 22, fontWeight: 600,
                  border: `1px solid ${typeColor}30`,
                }}
              />
              {insight.input_type && (
                <Chip
                  label={inputLabels[insight.input_type] ?? insight.input_type}
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: '0.6rem', height: 20, color: colors.text2, borderColor: colors.border }}
                />
              )}
              {insight.ticket_id && (
                <Chip
                  label={insight.ticket_id}
                  size="small"
                  sx={{
                    bgcolor: `${colors.lavender}18`, color: colors.lavender,
                    fontWeight: 600, fontSize: '0.7rem', height: 22,
                    border: `1px solid ${colors.lavender}30`,
                  }}
                />
              )}
              <Typography variant="caption" sx={{ color: colors.text2, fontSize: '0.65rem', ml: 'auto' }}>
                {timeAgo(insight.created_at)}
              </Typography>
            </Box>

            {/* Title: ticket summary or error signature */}
            <Typography variant="body1" sx={{ fontWeight: 600, fontSize: '0.95rem', mb: 0.5, lineHeight: 1.4 }}>
              {insight.ticket_summary || insight.error_signature || 'Investigation'}
            </Typography>

            {/* Root cause preview */}
            {insight.root_cause && (
              <Typography variant="body2" sx={{ color: colors.text2, fontSize: '0.8rem', lineHeight: 1.5 }}>
                {insight.root_cause.length > 150 ? insight.root_cause.slice(0, 148) + '..' : insight.root_cause}
              </Typography>
            )}
          </Box>
          <Box sx={{ color: colors.text2, ml: 1, display: 'flex', alignItems: 'center' }}>
            {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </Box>
        </Box>

        {/* Stats row */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
          {insight.user?.name && (
            <StatChip icon={<PersonIcon />} label="" value={insight.user.name} color={colors.purple} />
          )}
          {insight.time_to_root_cause != null && insight.time_to_root_cause > 0 && (
            <StatChip icon={<TimeIcon />} label="Root cause in" value={`${insight.time_to_root_cause}m`} color={colors.green} />
          )}
          {insight.ci_attempts != null && insight.ci_attempts > 0 && (
            <StatChip icon={<RepeatIcon />} label="CI attempts" value={insight.ci_attempts} color={colors.yellow} />
          )}
          {insight.knowledge_used && insight.knowledge_used.length > 0 ? (
            <StatChip
              icon={<PsychologyIcon />}
              label="KB refs"
              value={`${insight.knowledge_used.filter((k: KnowledgeRef) => k.was_helpful).length}/${insight.knowledge_used.length} helpful`}
              color={colors.cyan}
            />
          ) : insight.similar_count > 0 ? (
            <StatChip icon={<PsychologyIcon />} label="Similar found" value={insight.similar_count} color={colors.cyan} />
          ) : null}
          {insight.matched_pattern && (
            <StatChip icon={<PatternIcon />} label="Pattern matched" value="" color={colors.pink} />
          )}
        </Box>

        {/* Quick links row */}
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          {insight.pr_url && (
            <Link
              href={insight.pr_url} target="_blank" rel="noopener"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.5,
                color: colors.text2, fontSize: '0.75rem', textDecoration: 'none',
                '&:hover': { color: colors.purple },
              }}
            >
              <OpenInNewIcon sx={{ fontSize: 12 }} />
              {insight.pr_repo || 'View PR'}
            </Link>
          )}
          {insight.investigation_path.length > 0 && (
            <Typography variant="caption" sx={{ color: colors.text2, fontSize: '0.7rem' }}>
              {insight.investigation_path.length} investigation steps
            </Typography>
          )}
        </Box>
      </Box>

      {/* Expanded detail */}
      <Collapse in={expanded}>
        <Box sx={{ px: 2.5, pb: 2.5, borderTop: `1px solid ${colors.border}` }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3, pt: 2 }}>
            {/* Left: Investigation Lifecycle */}
            <Box>
              {insight.investigation_path.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" sx={{
                    color: colors.text2, textTransform: 'uppercase',
                    fontSize: '0.65rem', fontWeight: 600, mb: 1.5, display: 'block',
                  }}>
                    Investigation Lifecycle
                  </Typography>
                  <Stepper orientation="vertical" sx={{
                    '& .MuiStepConnector-line': { borderColor: colors.border, minHeight: 16 },
                    '& .MuiStepLabel-iconContainer': { pr: 1.5 },
                  }}>
                    {insight.investigation_path.map((step, i) => {
                      const isEffective = insight.effective_step && step.toLowerCase().includes(insight.effective_step.toLowerCase())
                      return (
                        <Step key={i} active expanded>
                          <StepLabel
                            StepIconProps={{
                              sx: {
                                color: isEffective ? colors.green : colors.purple,
                                '&.Mui-active': { color: isEffective ? colors.green : colors.purple },
                                fontSize: 18,
                              },
                            }}
                          >
                            <Typography variant="body2" sx={{
                              fontSize: '0.78rem', lineHeight: 1.5,
                              color: isEffective ? colors.green : colors.text,
                              fontWeight: isEffective ? 600 : 400,
                            }}>
                              {step}
                              {isEffective && (
                                <Chip
                                  label="Root cause found"
                                  size="small"
                                  sx={{
                                    ml: 1, height: 16, fontSize: '0.55rem',
                                    bgcolor: `${colors.green}20`, color: colors.green,
                                    border: `1px solid ${colors.green}30`,
                                  }}
                                />
                              )}
                            </Typography>
                          </StepLabel>
                          <StepContent />
                        </Step>
                      )
                    })}
                  </Stepper>
                </Box>
              )}

              {/* Error Signature */}
              {insight.error_signature && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" sx={{
                    color: colors.text2, textTransform: 'uppercase',
                    fontSize: '0.65rem', fontWeight: 600,
                  }}>
                    Error Signature
                  </Typography>
                  <Typography variant="body2" sx={{
                    fontFamily: 'monospace', bgcolor: colors.surface2,
                    p: 1.5, borderRadius: 1, mt: 0.5, whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all', fontSize: '0.75rem',
                    border: `1px solid ${colors.border}`,
                  }}>
                    {insight.error_signature}
                  </Typography>
                </Box>
              )}
            </Box>

            {/* Right: Resolution Details */}
            <Box>
              {insight.root_cause && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" sx={{
                    color: colors.text2, textTransform: 'uppercase',
                    fontSize: '0.65rem', fontWeight: 600,
                  }}>
                    Root Cause
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5, lineHeight: 1.6, fontSize: '0.8rem' }}>
                    {insight.root_cause}
                  </Typography>
                </Box>
              )}

              {insight.fix_approach && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" sx={{
                    color: colors.text2, textTransform: 'uppercase',
                    fontSize: '0.65rem', fontWeight: 600,
                  }}>
                    Fix / Resolution
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5, lineHeight: 1.6, fontSize: '0.8rem' }}>
                    {insight.fix_approach}
                  </Typography>
                </Box>
              )}

              {/* Metadata grid */}
              <Box sx={{
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1,
                bgcolor: colors.surface2, p: 1.5, borderRadius: 1,
                border: `1px solid ${colors.border}`,
              }}>
                {insight.user?.name && (
                  <Box>
                    <Typography variant="caption" sx={{ color: colors.text2, fontSize: '0.6rem' }}>User</Typography>
                    <Typography variant="body2" sx={{ fontSize: '0.78rem', fontWeight: 500 }}>{insight.user.name}</Typography>
                  </Box>
                )}
                {insight.team?.name && (
                  <Box>
                    <Typography variant="caption" sx={{ color: colors.text2, fontSize: '0.6rem' }}>Team</Typography>
                    <Typography variant="body2" sx={{ fontSize: '0.78rem', fontWeight: 500 }}>{insight.team.name}</Typography>
                  </Box>
                )}
                <Box>
                  <Typography variant="caption" sx={{ color: colors.text2, fontSize: '0.6rem' }}>Date</Typography>
                  <Typography variant="body2" sx={{ fontSize: '0.78rem' }}>{formatDateTime(insight.created_at)}</Typography>
                </Box>
                {insight.pr_repo && (
                  <Box>
                    <Typography variant="caption" sx={{ color: colors.text2, fontSize: '0.6rem' }}>Repository</Typography>
                    <Typography variant="body2" sx={{ fontSize: '0.78rem', fontFamily: 'monospace' }}>{insight.pr_repo}</Typography>
                  </Box>
                )}
              </Box>

              {/* Knowledge References */}
              {insight.knowledge_used && insight.knowledge_used.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption" sx={{
                    color: colors.text2, textTransform: 'uppercase',
                    fontSize: '0.65rem', fontWeight: 600, mb: 1, display: 'block',
                  }}>
                    Knowledge Base References ({insight.knowledge_used.filter((k: KnowledgeRef) => k.was_helpful).length} helpful / {insight.knowledge_used.length} consulted)
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {insight.knowledge_used.map((ref: KnowledgeRef, i: number) => (
                      <Box
                        key={i}
                        sx={{
                          p: 1.5, borderRadius: 1,
                          bgcolor: ref.was_helpful ? `${colors.green}08` : colors.surface2,
                          border: `1px solid ${ref.was_helpful ? colors.green + '30' : colors.border}`,
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                          <Chip
                            label={ref.was_helpful ? 'Helpful' : 'Not relevant'}
                            size="small"
                            sx={{
                              height: 18, fontSize: '0.55rem', fontWeight: 600,
                              bgcolor: ref.was_helpful ? `${colors.green}20` : `${colors.text2}15`,
                              color: ref.was_helpful ? colors.green : colors.text2,
                              border: `1px solid ${ref.was_helpful ? colors.green + '30' : colors.border}`,
                            }}
                          />
                          <Chip
                            label={ref.source === 'ship_context' ? 'Context' : 'Search'}
                            size="small"
                            variant="outlined"
                            sx={{ height: 18, fontSize: '0.55rem', color: colors.text2, borderColor: colors.border }}
                          />
                          {ref.ticket_id && (
                            <Typography variant="caption" sx={{ color: colors.lavender, fontWeight: 600, fontSize: '0.7rem' }}>
                              {ref.ticket_id}
                            </Typography>
                          )}
                          {ref.confidence != null && (
                            <Typography variant="caption" sx={{ color: colors.text2, fontSize: '0.6rem', ml: 'auto' }}>
                              {(ref.confidence * 100).toFixed(0)}% match
                            </Typography>
                          )}
                        </Box>
                        {ref.error_signature && (
                          <Typography variant="body2" sx={{
                            fontSize: '0.72rem', fontFamily: 'monospace', color: colors.text2,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {ref.error_signature}
                          </Typography>
                        )}
                        {ref.root_cause && (
                          <Typography variant="body2" sx={{ fontSize: '0.72rem', color: colors.text2, mt: 0.25 }}>
                            {ref.root_cause.length > 100 ? ref.root_cause.slice(0, 98) + '..' : ref.root_cause}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      </Collapse>
    </Paper>
  )
}

export default function InsightsPage() {
  const { team } = useTeam()
  const [page, setPage] = useState(1)
  const { data, loading, error } = useFetch(
    () => api.getInsights({ team, page, limit: ITEMS_PER_PAGE }),
    [team, page],
  )

  if (loading) return <Loading />
  if (error) return <ErrorAlert message={error} />

  const totalPages = data ? Math.ceil(data.total / ITEMS_PER_PAGE) : 0

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>Insights</Typography>
          <Typography variant="body2" sx={{ color: colors.text2, mt: 0.5 }}>
            How Ship guided users to solutions using the knowledge graph
          </Typography>
        </Box>
        {data && data.total > 0 && (
          <Chip
            label={`${data.total} agent interaction${data.total !== 1 ? 's' : ''}`}
            sx={{
              bgcolor: `${colors.purple}18`, color: colors.purple,
              fontWeight: 600, border: `1px solid ${colors.purple}30`,
            }}
          />
        )}
      </Box>

      {!data || data.data.length === 0 ? (
        <Paper sx={{
          p: 6, textAlign: 'center', bgcolor: colors.surface,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        }}>
          <PsychologyIcon sx={{ fontSize: 48, color: colors.text2, opacity: 0.4 }} />
          <Typography variant="h6" sx={{ color: colors.text2, fontWeight: 500 }}>
            No agent insights yet
          </Typography>
          <Typography variant="body2" sx={{ color: colors.text2, maxWidth: 400 }}>
            When users investigate issues using the Ship agent (via the <code>ship</code> or <code>ship_debug</code> prompts),
            their investigation lifecycle and outcomes will appear here.
          </Typography>
        </Paper>
      ) : (
        <>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 3 }}>
            {data.data.map((insight) => (
              <InsightCard key={insight.id} insight={insight} />
            ))}
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
