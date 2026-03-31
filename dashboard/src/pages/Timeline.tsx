import { useState, useMemo } from 'react'
import {
  Box, Typography, Paper, ToggleButtonGroup, ToggleButton,
  Chip, Collapse,
} from '@mui/material'
import { useTeam } from '../App'
import { api, type TimelineEntry } from '../api'
import { useFetch } from '../hooks'
import { Loading, ErrorAlert } from '../components'
import { colors, categoryColors } from '../theme'

const DAY_OPTIONS = [7, 14, 30, 90]

interface AggregatedDay {
  date: string
  total: number
  categories: Record<string, number>
}

export default function TimelinePage() {
  const { team } = useTeam()
  const [days, setDays] = useState(30)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  const { data, loading, error } = useFetch<TimelineEntry[]>(
    () => api.getTimeline({ team, days }),
    [team, days],
  )

  // Aggregate flat entries by date
  const entries: AggregatedDay[] = useMemo(() => {
    if (!data) return []
    const byDate = new Map<string, AggregatedDay>()
    for (const entry of data) {
      let agg = byDate.get(entry.date)
      if (!agg) {
        agg = { date: entry.date, total: 0, categories: {} }
        byDate.set(entry.date, agg)
      }
      agg.total += entry.count
      if (entry.category) {
        agg.categories[entry.category] = (agg.categories[entry.category] || 0) + entry.count
      }
    }
    // Sort by date ascending
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [data])

  if (loading) return <Loading />
  if (error) return <ErrorAlert message={error} />

  const maxTotal = Math.max(...entries.map((e) => e.total), 1)

  const allCategories = Array.from(
    new Set(entries.flatMap((e) => Object.keys(e.categories)))
  )

  const selectedEntry = selectedDay
    ? entries.find((e) => e.date === selectedDay)
    : null

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>Timeline</Typography>
        <ToggleButtonGroup
          value={days}
          exclusive
          onChange={(_, v) => v && setDays(v)}
          size="small"
        >
          {DAY_OPTIONS.map((d) => (
            <ToggleButton
              key={d}
              value={d}
              sx={{
                color: colors.text2,
                borderColor: colors.border,
                '&.Mui-selected': {
                  bgcolor: `${colors.purple}20`,
                  color: colors.purple,
                  borderColor: colors.purple,
                },
              }}
            >
              {d}d
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      {/* Legend */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        {allCategories.map((cat) => (
          <Chip
            key={cat}
            label={cat}
            size="small"
            sx={{
              bgcolor: `${categoryColors[cat] || colors.text2}18`,
              color: categoryColors[cat] || colors.text2,
              fontSize: '0.7rem',
            }}
          />
        ))}
      </Box>

      {/* Chart */}
      <Paper sx={{ p: 3, mb: 3, bgcolor: colors.surface }}>
        {entries.length === 0 ? (
          <Box sx={{ py: 8, textAlign: 'center' }}>
            <Typography sx={{ color: colors.text2 }}>No timeline data available</Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: 280, width: '100%' }}>
            {entries.map((entry) => {
              const isSelected = selectedDay === entry.date
              const barHeight = (entry.total / maxTotal) * 240
              const cats = Object.entries(entry.categories)
              const totalCat = cats.reduce((s, [, v]) => s + v, 0) || 1

              return (
                <Box
                  key={entry.date}
                  onClick={() => setSelectedDay(isSelected ? null : entry.date)}
                  sx={{
                    flex: 1,
                    minWidth: 16,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    transition: 'all 0.2s',
                    '&:hover .bar': { opacity: 0.9 },
                  }}
                >
                  {/* Stacked bar */}
                  <Box
                    className="bar"
                    sx={{
                      width: '80%',
                      height: barHeight || 2,
                      borderRadius: '3px 3px 0 0',
                      display: 'flex',
                      flexDirection: 'column-reverse',
                      overflow: 'hidden',
                      opacity: isSelected ? 1 : 0.7,
                      border: isSelected ? `2px solid ${colors.purple}` : 'none',
                      transition: 'opacity 0.2s',
                    }}
                  >
                    {cats.map(([cat, count]) => (
                      <Box
                        key={cat}
                        sx={{
                          height: `${(count / totalCat) * 100}%`,
                          bgcolor: categoryColors[cat] || colors.text2,
                          minHeight: count > 0 ? 2 : 0,
                        }}
                      />
                    ))}
                    {cats.length === 0 && (
                      <Box sx={{ height: '100%', bgcolor: colors.purple }} />
                    )}
                  </Box>

                  {/* Date label */}
                  <Typography
                    variant="caption"
                    sx={{
                      color: isSelected ? colors.text : colors.text2,
                      fontSize: '0.55rem',
                      mt: 0.5,
                      whiteSpace: 'nowrap',
                      transform: 'rotate(-45deg)',
                      transformOrigin: 'top left',
                      width: 40,
                    }}
                  >
                    {new Date(entry.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </Typography>
                </Box>
              )
            })}
          </Box>
        )}
      </Paper>

      {/* Selected day detail */}
      <Collapse in={!!selectedEntry}>
        {selectedEntry && (
          <Paper sx={{ p: 3, bgcolor: colors.surface }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Resolutions on {new Date(selectedEntry.date).toLocaleDateString(undefined, {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
              })}
            </Typography>

            <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
              {Object.entries(selectedEntry.categories).map(([cat, count]) => (
                <Chip
                  key={cat}
                  label={`${cat}: ${count}`}
                  size="small"
                  sx={{
                    bgcolor: `${categoryColors[cat] || colors.text2}18`,
                    color: categoryColors[cat] || colors.text2,
                  }}
                />
              ))}
            </Box>

            <Typography sx={{ color: colors.text2 }}>
              Total: {selectedEntry.total} resolution(s)
            </Typography>
          </Paper>
        )}
      </Collapse>
    </Box>
  )
}
