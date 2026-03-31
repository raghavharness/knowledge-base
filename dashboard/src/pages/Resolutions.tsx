import { useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Typography } from '@mui/material'
import { useTeam } from '../App'
import { api, type ResolutionsResponse } from '../api'
import { useFetch } from '../hooks'
import { Loading, ErrorAlert, ResolutionsTable, Section } from '../components'

const ALL_CATEGORIES = ['bugfix', 'feature', 'refactor', 'config_change']
const ALL_TIERS = ['tier1', 'tier2', 'tier3']

export default function ResolutionsPage() {
  const { team } = useTeam()
  const navigate = useNavigate()
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(20)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [tier, setTier] = useState('')
  const [sortBy, setSortBy] = useState('created_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // Debounce search
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

  const handleSearchChange = useCallback((v: string) => {
    setSearch(v)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(v)
      setPage(0)
    }, 400)
  }, [])

  const { data, loading, error } = useFetch<ResolutionsResponse>(
    () => api.getResolutions({
      team, page: page + 1, limit: rowsPerPage,
      category, tier, search: debouncedSearch,
    }),
    [team, page, rowsPerPage, category, tier, debouncedSearch],
  )

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('asc')
    }
    setPage(0)
  }

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 700 }}>Resolutions</Typography>

      <Section title="All Resolutions">
        {loading && !data ? <Loading /> : error ? <ErrorAlert message={error} /> : (
          <ResolutionsTable
            resolutions={data?.data || []}
            total={data?.total || 0}
            page={page}
            rowsPerPage={rowsPerPage}
            onPageChange={setPage}
            onRowsPerPageChange={(rpp) => { setRowsPerPage(rpp); setPage(0) }}
            onRowClick={(id) => navigate(`/resolutions/${encodeURIComponent(id)}`)}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSort={handleSort}
            search={search}
            onSearchChange={handleSearchChange}
            categoryFilter={category}
            onCategoryFilterChange={(v) => { setCategory(v); setPage(0) }}
            tierFilter={tier}
            onTierFilterChange={(v) => { setTier(v); setPage(0) }}
            categories={ALL_CATEGORIES}
            tiers={ALL_TIERS}
            showFilters
          />
        )}
      </Section>
    </Box>
  )
}
