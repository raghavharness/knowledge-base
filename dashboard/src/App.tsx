import { useState, useEffect, createContext, useContext } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import {
  Box, List, ListItemButton, ListItemIcon, ListItemText,
  Typography, Select, MenuItem, FormControl, Divider,
  type SelectChangeEvent,
} from '@mui/material'
import {
  Hub as HubIcon,
  Dashboard as DashboardIcon,
  ListAlt as ListAltIcon,
  Psychology as InsightsIcon,
  Pattern as PatternIcon,
  Folder as FolderIcon,
  Timeline as TimelineIcon,
} from '@mui/icons-material'
import { colors } from './theme'
import { api, type TeamInfo } from './api'

import OverviewPage from './pages/Overview'
import ResolutionsPage from './pages/Resolutions'
import ResolutionDetailPage from './pages/ResolutionDetail'
import InsightsPage from './pages/Insights'
import PatternsPage from './pages/Patterns'
import ReposPage from './pages/Repos'
import RepoDetailPage from './pages/RepoDetail'
import TimelinePage from './pages/Timeline'

/* ─── Team Context ─── */
interface TeamCtx { team: string; setTeam: (t: string) => void }
const TeamContext = createContext<TeamCtx>({ team: '', setTeam: () => {} })
export const useTeam = () => useContext(TeamContext)

const SIDEBAR_WIDTH = 220

const navItems = [
  { label: 'Overview', icon: <DashboardIcon />, path: '/' },
  { label: 'Resolutions', icon: <ListAltIcon />, path: '/resolutions' },
  { label: 'Insights', icon: <InsightsIcon />, path: '/insights' },
  { label: 'Patterns', icon: <PatternIcon />, path: '/patterns' },
  { label: 'Repositories', icon: <FolderIcon />, path: '/repos' },
  { label: 'Timeline', icon: <TimelineIcon />, path: '/timeline' },
]

function App() {
  const [team, setTeam] = useState('')
  const [teams, setTeams] = useState<TeamInfo[]>([])
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    api.getTeams().then(setTeams).catch(() => setTeams([]))
  }, [])

  const currentPath = location.pathname === '' ? '/' : location.pathname

  return (
    <TeamContext.Provider value={{ team, setTeam }}>
      <Box sx={{ display: 'flex', minHeight: '100vh', width: '100%' }}>
        {/* Sidebar */}
        <Box
          sx={{
            width: SIDEBAR_WIDTH,
            minWidth: SIDEBAR_WIDTH,
            bgcolor: colors.surface,
            borderRight: `1px solid ${colors.border}`,
            display: 'flex',
            flexDirection: 'column',
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
            zIndex: 100,
          }}
        >
          {/* Logo */}
          <Box sx={{ px: 2, py: 2.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <HubIcon sx={{ color: colors.purple, fontSize: 28 }} />
            <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1.1rem' }}>
              Ship
            </Typography>
          </Box>

          <Divider sx={{ borderColor: colors.border }} />

          {/* Team Selector */}
          <Box sx={{ px: 1.5, py: 1.5 }}>
            <FormControl fullWidth size="small">
              <Select
                value={team}
                displayEmpty
                onChange={(e: SelectChangeEvent) => setTeam(e.target.value)}
                sx={{
                  bgcolor: colors.surface2,
                  fontSize: '0.85rem',
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: colors.border },
                }}
              >
                <MenuItem value="">All Teams</MenuItem>
                {teams.map((t) => (
                  <MenuItem key={t.id} value={t.id}>{t.name || t.id}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Divider sx={{ borderColor: colors.border }} />

          {/* Nav */}
          <List sx={{ px: 1, py: 1, flex: 1 }}>
            {navItems.map((item) => {
              const active = currentPath === item.path ||
                (item.path !== '/' && currentPath.startsWith(item.path))
              return (
                <ListItemButton
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  sx={{
                    borderRadius: 1.5,
                    mb: 0.5,
                    py: 1,
                    bgcolor: active ? `${colors.purple}15` : 'transparent',
                    '&:hover': { bgcolor: `${colors.purple}10` },
                  }}
                >
                  <ListItemIcon sx={{
                    minWidth: 36,
                    color: active ? colors.purple : colors.text2,
                  }}>
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{
                      fontSize: '0.85rem',
                      fontWeight: active ? 600 : 400,
                      color: active ? colors.text : colors.text2,
                    }}
                  />
                </ListItemButton>
              )
            })}
          </List>

          <Box sx={{ p: 2 }}>
            <Typography variant="caption" sx={{ color: colors.text2, fontSize: '0.7rem' }}>
              Ship Knowledge Graph
            </Typography>
          </Box>
        </Box>

        {/* Main Content */}
        <Box
          component="main"
          sx={{
            ml: `${SIDEBAR_WIDTH}px`,
            flex: 1,
            p: 3,
            maxWidth: `calc(100vw - ${SIDEBAR_WIDTH}px)`,
            overflow: 'auto',
          }}
        >
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/resolutions" element={<ResolutionsPage />} />
            <Route path="/resolutions/:id" element={<ResolutionDetailPage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/patterns" element={<PatternsPage />} />
            <Route path="/repos" element={<ReposPage />} />
            <Route path="/repos/:repo" element={<RepoDetailPage />} />
            <Route path="/timeline" element={<TimelinePage />} />
          </Routes>
        </Box>
      </Box>
    </TeamContext.Provider>
  )
}

export default App
