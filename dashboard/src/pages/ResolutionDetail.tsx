import React from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Box, Typography, Paper, Chip, Button, Link,
} from '@mui/material'
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material'
import { api, type ResolutionDetail } from '../api'
import { useFetch } from '../hooks'
import { Loading, ErrorAlert, CategoryBadge, TierBadge } from '../components'
import { colors } from '../theme'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="subtitle2" sx={{ color: colors.text2, mb: 1, textTransform: 'uppercase', letterSpacing: 1, fontSize: '0.7rem' }}>
        {title}
      </Typography>
      {children}
    </Box>
  )
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  if (value === null || value === undefined || value === '' || value === '--') return null
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', py: 0.5 }}>
      <Typography variant="body2" sx={{ color: colors.text2, fontSize: '0.8rem', minWidth: 120, flexShrink: 0 }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontSize: '0.85rem', textAlign: 'right', fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-word', ml: 2 }}>
        {value}
      </Typography>
    </Box>
  )
}

function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return null
  const colorMap: Record<string, string> = {
    Critical: colors.red, Highest: colors.red, High: '#ff8a65',
    Medium: colors.yellow, Low: colors.green, Lowest: colors.green,
  }
  const c = colorMap[priority] ?? colors.text2
  return <Chip label={priority} size="small" sx={{ bgcolor: `${c}18`, color: c, border: `1px solid ${c}30`, fontSize: '0.7rem', height: 22 }} />
}

function formatDate(d: string | null): string {
  if (!d) return '--'
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return d }
}

function formatDateTime(d: string | null): string {
  if (!d) return '--'
  try { return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return d }
}

function daysBetween(start: string | null, end: string | null): string | null {
  if (!start || !end) return null
  try {
    const diff = Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86400000)
    return diff === 0 ? 'Same day' : diff === 1 ? '1 day' : `${diff} days`
  } catch { return null }
}

export default function ResolutionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data, loading, error } = useFetch<ResolutionDetail>(
    () => api.getResolution(id!),
    [id],
  )

  if (loading) return <Loading />
  if (error) return <ErrorAlert message={error} />
  if (!data) return null

  const ttResolve = daysBetween(data.ticket?.created_at, data.ticket?.resolved_at)

  return (
    <Box>
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate('/resolutions')}
        sx={{ mb: 2, color: colors.text2 }}
      >
        Back to Resolutions
      </Button>

      {/* Header */}
      <Paper sx={{ p: 3, mb: 3, bgcolor: colors.surface }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5, flexWrap: 'wrap' }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {data.ticket?.id || data.id}
          </Typography>
          <CategoryBadge category={data.category} />
          <TierBadge tier={data.tier} />
          <PriorityBadge priority={data.ticket?.priority} />
          {data.ticket?.type && (
            <Chip label={data.ticket.type} size="small" sx={{ bgcolor: `${colors.purple}18`, color: colors.purple, border: `1px solid ${colors.purple}30`, fontSize: '0.7rem', height: 22 }} />
          )}
        </Box>
        {data.ticket?.summary && (
          <Typography variant="body1" sx={{ mb: 1.5, fontWeight: 500 }}>
            {data.ticket.summary}
          </Typography>
        )}
        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', color: colors.text2, fontSize: '0.8rem' }}>
          {data.ticket?.assignee && <Typography variant="caption">Assignee: <strong style={{ color: colors.text }}>{data.ticket.assignee}</strong></Typography>}
          {data.ticket?.reporter && <Typography variant="caption">Reporter: <strong style={{ color: colors.text }}>{data.ticket.reporter}</strong></Typography>}
          {data.ticket?.sprint && <Typography variant="caption">Sprint: <strong style={{ color: colors.text }}>{data.ticket.sprint}</strong></Typography>}
          {ttResolve && <Typography variant="caption">Time to resolve: <strong style={{ color: colors.green }}>{ttResolve}</strong></Typography>}
        </Box>
      </Paper>

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {/* LEFT COLUMN: Problem, Analysis, Resolution */}
        <Box sx={{ flex: '1 1 550px' }}>

          {/* Problem Statement */}
          {data.ticket?.description && (
            <Paper sx={{ p: 3, mb: 3, bgcolor: colors.surface }}>
              <Section title="Problem Statement">
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                  {data.ticket.description}
                </Typography>
              </Section>
            </Paper>
          )}

          {/* Error Signature */}
          {data.error_signature && (
            <Paper sx={{ p: 3, mb: 3, bgcolor: colors.surface }}>
              <Section title="Error Signature">
                <Typography
                  variant="body2"
                  sx={{
                    fontFamily: 'monospace', bgcolor: colors.surface2,
                    p: 2, borderRadius: 1, whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all', fontSize: '0.85rem',
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  {data.error_signature}
                </Typography>
              </Section>
            </Paper>
          )}

          {/* Root Cause */}
          {data.root_cause && (
            <Paper sx={{ p: 3, mb: 3, bgcolor: colors.surface }}>
              <Section title="Root Cause">
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                  {data.root_cause}
                </Typography>
              </Section>
            </Paper>
          )}

          {/* Fix Approach */}
          {data.fix_approach && (
            <Paper sx={{ p: 3, mb: 3, bgcolor: colors.surface }}>
              <Section title="Fix / Solution">
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                  {data.fix_approach}
                </Typography>
              </Section>
            </Paper>
          )}

          {/* Conclusion */}
          {data.ticket?.conclusion && (
            <Paper sx={{ p: 3, mb: 3, bgcolor: colors.surface }}>
              <Section title="Conclusion">
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                  {data.ticket.conclusion}
                </Typography>
              </Section>
            </Paper>
          )}

          {/* Discussion Summary (JIRA comments) */}
          {data.ticket?.comments_summary && (
            <Paper sx={{ p: 3, mb: 3, bgcolor: colors.surface }}>
              <Section title="Discussion Summary (from JIRA)">
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontStyle: 'italic' }}>
                  {data.ticket.comments_summary}
                </Typography>
              </Section>
            </Paper>
          )}

          {/* PR Descriptions & Review Comments */}
          {data.prs?.map((pr, idx) => (
            <React.Fragment key={idx}>
              {pr.description && (
                <Paper sx={{ p: 3, mb: 3, bgcolor: colors.surface }}>
                  <Section title={data.prs.length > 1 ? `PR Description — ${pr.title || pr.repo || `#${idx + 1}`}` : 'PR Description'}>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                      {pr.description}
                    </Typography>
                  </Section>
                </Paper>
              )}
              {pr.comments_summary && (
                <Paper sx={{ p: 3, mb: 3, bgcolor: colors.surface }}>
                  <Section title={data.prs.length > 1 ? `Code Review Comments — ${pr.title || pr.repo || `#${idx + 1}`}` : 'Code Review Comments'}>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontStyle: 'italic' }}>
                      {pr.comments_summary}
                    </Typography>
                  </Section>
                </Paper>
              )}
            </React.Fragment>
          ))}
        </Box>

        {/* RIGHT COLUMN: Metadata */}
        <Box sx={{ flex: '1 1 320px', maxWidth: 420 }}>

          {/* Ticket Info */}
          <Paper sx={{ p: 3, mb: 3, bgcolor: colors.surface }}>
            <Section title="Ticket Details">
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Row label="Ticket" value={data.ticket?.id} mono />
                <Row label="Status" value={data.ticket?.status} />
                <Row label="Resolution" value={data.ticket?.resolution} />
                <Row label="Created" value={formatDate(data.ticket?.created_at)} />
                <Row label="Resolved" value={formatDate(data.ticket?.resolved_at)} />
                {data.ticket?.feature_flag && <Row label="Feature Flag" value={data.ticket.feature_flag} mono />}
              </Box>
              {data.ticket?.labels && data.ticket.labels.length > 0 && (
                <Box sx={{ mt: 1.5 }}>
                  <Typography variant="caption" sx={{ color: colors.text2 }}>Labels</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                    {data.ticket.labels.map((l, i) => (
                      <Chip key={i} label={l} size="small" sx={{ bgcolor: `${colors.cyan}18`, color: colors.cyan, fontSize: '0.7rem', height: 22, border: `1px solid ${colors.cyan}30` }} />
                    ))}
                  </Box>
                </Box>
              )}
              {data.ticket?.components && data.ticket.components.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="caption" sx={{ color: colors.text2 }}>Components</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                    {data.ticket.components.map((c, i) => (
                      <Chip key={i} label={c} size="small" sx={{ bgcolor: `${colors.lavender}18`, color: colors.lavender, fontSize: '0.7rem', height: 22, border: `1px solid ${colors.lavender}30` }} />
                    ))}
                  </Box>
                </Box>
              )}
            </Section>
          </Paper>

          {/* PR Info — show all linked PRs */}
          {data.prs?.filter(pr => pr.url || pr.title || pr.repo).map((pr, idx) => (
          <Paper key={idx} sx={{ p: 3, mb: 3, bgcolor: colors.surface }}>
            <Section title={data.prs.length > 1 ? `Pull Request ${idx + 1} of ${data.prs.length}` : 'Pull Request'}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Row label="Repo" value={pr.repo} mono />
                <Row label="Title" value={pr.title} />
                <Row label="State" value={pr.state} />
                <Row label="Author" value={pr.author} />
                <Row label="Created" value={formatDate(pr.created_at)} />
                <Row label="Merged" value={formatDate(pr.merged_at)} />
                <Row label="Review" value={pr.review_decision} />
                {pr.additions != null && pr.deletions != null && (
                  <Row label="Changes" value={
                    <span>
                      <span style={{ color: colors.green }}>+{pr.additions}</span>{' / '}
                      <span style={{ color: colors.red }}>-{pr.deletions}</span>
                    </span>
                  } />
                )}
                {pr.url && (
                  <Row label="Link" value={
                    <Link href={pr.url} target="_blank" sx={{ color: colors.purple, fontSize: '0.85rem' }}>
                      View PR
                    </Link>
                  } />
                )}
              </Box>
              {pr.reviewers && pr.reviewers.length > 0 && (
                <Box sx={{ mt: 1.5 }}>
                  <Typography variant="caption" sx={{ color: colors.text2 }}>Reviewers</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                    {pr.reviewers.map((r, i) => (
                      <Chip key={i} label={r} size="small" sx={{ bgcolor: `${colors.pink}18`, color: colors.pink, fontSize: '0.7rem', height: 22, border: `1px solid ${colors.pink}30` }} />
                    ))}
                  </Box>
                </Box>
              )}
              {pr.diff_summary && (
                <Box sx={{ mt: 1.5 }}>
                  <Typography variant="caption" sx={{ color: colors.text2 }}>Diff Summary</Typography>
                  <Typography variant="body2" sx={{ mt: 0.5, fontSize: '0.8rem', lineHeight: 1.6 }}>
                    {pr.diff_summary}
                  </Typography>
                </Box>
              )}
            </Section>
          </Paper>
          ))}

          {/* Files Changed */}
          {data.files_changed && data.files_changed.length > 0 && (
            <Paper sx={{ p: 3, mb: 3, bgcolor: colors.surface }}>
              <Section title={`Files Changed (${data.files_changed.length})`}>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {data.files_changed.map((f, i) => (
                    <Chip
                      key={i}
                      label={f}
                      size="small"
                      sx={{
                        bgcolor: `${colors.yellow}18`,
                        color: colors.yellow,
                        fontFamily: 'monospace',
                        fontSize: '0.7rem',
                        border: `1px solid ${colors.yellow}30`,
                      }}
                    />
                  ))}
                </Box>
              </Section>
            </Paper>
          )}

          {/* Modules */}
          {data.modules && data.modules.length > 0 && (
            <Paper sx={{ p: 3, mb: 3, bgcolor: colors.surface }}>
              <Section title="Modules">
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {data.modules.map((m, i) => (
                    <Chip key={i} label={m} size="small" sx={{ bgcolor: `${colors.blue}18`, color: colors.blue, fontSize: '0.75rem', border: `1px solid ${colors.blue}30` }} />
                  ))}
                </Box>
              </Section>
            </Paper>
          )}

          {/* Metadata */}
          <Paper sx={{ p: 3, mb: 3, bgcolor: colors.surface }}>
            <Section title="Metadata">
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Row label="Source" value={data.source} />
                <Row label="Confidence" value={data.confidence != null ? `${(data.confidence * 100).toFixed(0)}%` : null} />
                <Row label="Team" value={data.team?.name} />
                <Row label="Created" value={formatDateTime(data.created_at)} />
              </Box>
            </Section>
          </Paper>

          {/* Similar Resolutions */}
          {data.similar_ids && data.similar_ids.length > 0 && (
            <Paper sx={{ p: 3, mb: 3, bgcolor: colors.surface }}>
              <Section title="Similar Resolutions">
                {data.similar_ids.map((sid, i) => (
                  <Box
                    key={i}
                    onClick={() => navigate(`/resolutions/${encodeURIComponent(sid)}`)}
                    sx={{
                      p: 1.5, mb: 1, borderRadius: 1,
                      bgcolor: colors.surface2, cursor: 'pointer',
                      border: `1px solid ${colors.border}`,
                      '&:hover': { borderColor: colors.purple },
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 500, fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {sid}
                    </Typography>
                  </Box>
                ))}
              </Section>
            </Paper>
          )}
        </Box>
      </Box>
    </Box>
  )
}
