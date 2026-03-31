const BASE = '/api'

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export function apiUrl(path: string, params: Record<string, string | number | undefined> = {}) {
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
  return `${BASE}${path}${query ? '?' + query : ''}`
}

/* ─── Backend response shapes ─── */

export interface TeamInfo {
  id: string
  name: string
}

export interface StatsResponse {
  counts: {
    resolutions: number
    patterns: number
    errors: number
    modules: number
    files: number
    repos: number
  }
  categories: { category: string; count: number }[]
  tiers: { tier: number; count: number }[]
  recent: {
    id: string
    category: string | null
    tier: number
    created_at: string | null
    error: string | null
    ticket_id: string | null
    summary: string | null
    fix: string | null
    root_cause: string | null
  }[]
}

export interface Resolution {
  id: string
  category: string | null
  tier: number
  created_at: string | null
  confidence: number | null
  error: string | null
  ticket_id: string | null
  summary: string | null
  ticket_type: string | null
  ticket_priority: string | null
  assignee: string | null
  fix: string | null
  root_cause: string | null
  pr_url: string | null
  pr_title: string | null
  pr_repo: string | null
  pr_author: string | null
  pr_merged_at: string | null
}

export interface ResolutionDetail {
  id: string
  category: string | null
  tier: number
  confidence: number | null
  search_weight: number | null
  created_at: string | null
  ingested_by: string | null
  source: string | null
  team: { id: string | null; name: string | null }
  error_signature: string | null
  ticket: {
    id: string | null
    summary: string | null
    status: string | null
    resolution: string | null
    type: string | null
    priority: string | null
    assignee: string | null
    reporter: string | null
    created_at: string | null
    resolved_at: string | null
    labels: string[]
    components: string[]
    description: string | null
    conclusion: string | null
    comments_summary: string | null
    feature_flag: string | null
    sprint: string | null
  }
  fix_approach: string | null
  root_cause: string | null
  pr: {
    url: string | null
    title: string | null
    repo: string | null
    state: string | null
    diff_summary: string | null
    author: string | null
    reviewers: string[]
    merged_at: string | null
    created_at: string | null
    description: string | null
    comments_summary: string | null
    additions: number | null
    deletions: number | null
    review_decision: string | null
  }
  files_changed: string[]
  modules: string[]
  similar_ids: string[]
}

export interface ResolutionsResponse {
  data: Resolution[]
  total: number
  page: number
  limit: number
}

export interface PatternResolution {
  id: string | null
  category: string | null
  created_at: string | null
  ticket_id: string | null
  summary: string | null
  pr_url: string | null
  pr_repo: string | null
  pr_title: string | null
  pr_author: string | null
}

export interface PatternData {
  id: string
  error_signature: string | null
  root_cause: string | null
  fix_approach: string | null
  category: string
  occurrences: number
  success_rate: number | null
  team_id: string | null
  files: string[]
  resolutions: PatternResolution[]
}

export interface KnowledgeRef {
  ticket_id?: string
  error_signature?: string
  root_cause?: string
  confidence?: number
  source: 'ship_context' | 'ship_search'
  was_helpful: boolean
}

export interface InsightData {
  id: string
  resolution_type: string | null
  created_at: string | null
  investigation_path: string[]
  effective_step: string | null
  time_to_root_cause: number | null
  ci_attempts: number | null
  input_type: string | null
  user: { name: string | null; email: string | null }
  team: { id: string | null; name: string | null }
  error_signature: string | null
  ticket_id: string | null
  ticket_summary: string | null
  root_cause: string | null
  fix_approach: string | null
  pr_url: string | null
  pr_title: string | null
  pr_repo: string | null
  pr_author: string | null
  similar_count: number
  matched_pattern: string | null
  knowledge_used: KnowledgeRef[]
}

export interface InsightsResponse {
  data: InsightData[]
  total: number
  page: number
  limit: number
}

export interface RepoData {
  repo: string
  team: string | null
  resolution_count: number
  categories: string[]
}

export interface RepoDetailResolution {
  id: string
  category: string | null
  tier: number
  created_at: string | null
  error: string | null
  ticket_id: string | null
  summary: string | null
  pr_title: string | null
  pr_url: string | null
  files: string[]
}

export interface TimelineEntry {
  date: string
  category: string | null
  count: number
}

export const api = {
  getTeams: () => fetchJson<TeamInfo[]>(apiUrl('/teams')),

  getStats: (team?: string) =>
    fetchJson<StatsResponse>(apiUrl('/stats', { team })),

  getResolutions: (params: {
    team?: string; page?: number; limit?: number;
    category?: string; tier?: string; search?: string;
  }) => fetchJson<ResolutionsResponse>(apiUrl('/resolutions', params as Record<string, string | number | undefined>)),

  getResolution: (id: string) =>
    fetchJson<ResolutionDetail>(apiUrl(`/resolutions/${encodeURIComponent(id)}`)),

  getInsights: (params: { team?: string; page?: number; limit?: number }) =>
    fetchJson<InsightsResponse>(apiUrl('/insights', params as Record<string, string | number | undefined>)),

  getPatterns: (params: { team?: string; sort?: string; order?: string }) =>
    fetchJson<PatternData[]>(apiUrl('/patterns', params as Record<string, string | number | undefined>)),

  getRepos: (team?: string) =>
    fetchJson<RepoData[]>(apiUrl('/repos', { team })),

  getRepoDetail: (repo: string, team?: string) =>
    fetchJson<RepoDetailResolution[]>(apiUrl(`/repos/${encodeURIComponent(repo)}`, { team })),

  getTimeline: (params: { team?: string; days?: number }) =>
    fetchJson<TimelineEntry[]>(apiUrl('/timeline', params as Record<string, string | number | undefined>)),
}
