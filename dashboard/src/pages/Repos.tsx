import { useNavigate } from 'react-router-dom'
import { Box, Typography, Paper, Chip } from '@mui/material'
import { Folder as FolderIcon } from '@mui/icons-material'
import { useTeam } from '../App'
import { api, type RepoData } from '../api'
import { useFetch } from '../hooks'
import { Loading, ErrorAlert } from '../components'
import { colors, categoryColors } from '../theme'

export default function ReposPage() {
  const { team } = useTeam()
  const navigate = useNavigate()
  const { data, loading, error } = useFetch<RepoData[]>(
    () => api.getRepos(team),
    [team],
  )

  if (loading) return <Loading />
  if (error) return <ErrorAlert message={error} />

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 700 }}>Repositories</Typography>

      {(!data || data.length === 0) ? (
        <Paper sx={{ p: 4, textAlign: 'center', bgcolor: colors.surface }}>
          <Typography sx={{ color: colors.text2 }}>No repositories found</Typography>
        </Paper>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 400px), 1fr))', gap: 2 }}>
          {data.map((repo) => (
            <Paper
              key={repo.repo}
              onClick={() => navigate(`/repos/${encodeURIComponent(repo.repo)}`)}
              sx={{
                p: 2.5, bgcolor: colors.surface,
                cursor: 'pointer',
                transition: 'all 0.2s',
                '&:hover': { borderColor: colors.cyan, transform: 'translateY(-2px)' },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                <FolderIcon sx={{ color: colors.cyan, fontSize: 24 }} />
                <Typography variant="body1" sx={{ fontWeight: 600, flex: 1 }}>
                  {repo.repo}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <Typography variant="caption" sx={{ color: colors.text2 }}>
                  Resolutions:
                </Typography>
                <Typography variant="body2" sx={{ color: colors.purple, fontWeight: 700 }}>
                  {repo.resolution_count}
                </Typography>
              </Box>

              {repo.categories && repo.categories.length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {repo.categories.map((cat) => (
                    <Chip
                      key={cat}
                      label={cat}
                      size="small"
                      sx={{
                        bgcolor: `${categoryColors[cat] || colors.text2}15`,
                        color: categoryColors[cat] || colors.text2,
                        fontSize: '0.65rem',
                        border: `1px solid ${categoryColors[cat] || colors.text2}30`,
                      }}
                    />
                  ))}
                </Box>
              )}
            </Paper>
          ))}
        </Box>
      )}
    </Box>
  )
}
