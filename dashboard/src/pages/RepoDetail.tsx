import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Box, Typography, Button } from '@mui/material'
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material'
import { useTeam } from '../App'
import { api, type RepoDetailResolution } from '../api'
import { useFetch } from '../hooks'
import { Loading, ErrorAlert, ResolutionsTable, Section } from '../components'
import { colors } from '../theme'

export default function RepoDetailPage() {
  const { repo } = useParams<{ repo: string }>()
  const { team } = useTeam()
  const navigate = useNavigate()
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(20)

  const { data, loading, error } = useFetch<RepoDetailResolution[]>(
    () => api.getRepoDetail(repo!, team),
    [repo, team],
  )

  if (loading) return <Loading />
  if (error) return <ErrorAlert message={error} />
  if (!data) return null

  // Client-side pagination since the repo endpoint returns all resolutions
  const resolutions = data
  const total = resolutions.length
  const paged = resolutions.slice(page * rowsPerPage, (page + 1) * rowsPerPage)

  return (
    <Box>
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate('/repos')}
        sx={{ mb: 2, color: colors.text2 }}
      >
        Back to Repositories
      </Button>

      <Typography variant="h4" sx={{ mb: 3, fontWeight: 700 }}>
        {repo}
      </Typography>

      <Section title={`Resolutions (${total})`}>
        <ResolutionsTable
          resolutions={paged}
          total={total}
          page={page}
          rowsPerPage={rowsPerPage}
          onPageChange={setPage}
          onRowsPerPageChange={(rpp) => { setRowsPerPage(rpp); setPage(0) }}
          onRowClick={(id) => navigate(`/resolutions/${encodeURIComponent(id)}`)}
        />
      </Section>
    </Box>
  )
}
