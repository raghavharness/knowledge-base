import { createTheme } from '@mui/material/styles'

export const colors = {
  bg: '#0f0f13',
  surface: '#1a1a24',
  surface2: '#22222e',
  border: '#2a2a3a',
  text: '#e8e8f0',
  text2: '#8888a0',
  purple: '#7c6cf0',
  red: '#e06050',
  green: '#40c090',
  blue: '#4090e0',
  yellow: '#e0c050',
  cyan: '#40c8e0',
  pink: '#d070a0',
  lavender: '#a070d0',
}

export const categoryColors: Record<string, string> = {
  bugfix: colors.red,
  feature: colors.blue,
  refactor: colors.yellow,
  config_change: colors.cyan,
}

export const tierColors: Record<string, string> = {
  tier1: colors.green,
  tier2: colors.yellow,
  tier3: colors.red,
}

export const nodeColors: Record<string, string> = {
  resolution: colors.purple,
  error: colors.red,
  pattern: colors.green,
  module: colors.blue,
  file: colors.yellow,
  team: colors.cyan,
  ticket: colors.lavender,
  pr: colors.pink,
}

export const theme = createTheme({
  palette: {
    mode: 'dark',
    background: {
      default: colors.bg,
      paper: colors.surface,
    },
    primary: { main: colors.purple },
    secondary: { main: colors.cyan },
    error: { main: colors.red },
    success: { main: colors.green },
    warning: { main: colors.yellow },
    info: { main: colors.blue },
    text: {
      primary: colors.text,
      secondary: colors.text2,
    },
    divider: colors.border,
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h4: { fontWeight: 700 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: `1px solid ${colors.border}`,
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: `1px solid ${colors.border}`,
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 500,
        },
      },
    },
  },
})
