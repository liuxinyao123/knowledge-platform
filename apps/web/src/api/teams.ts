/**
 * api/teams.ts —— Permissions V2 Teams client
 */
import axios from 'axios'

const client = axios.create({ baseURL: '/api/iam/teams' })

export interface TeamSummary {
  id: number
  name: string
  description: string | null
  created_by: string | null
  created_at_ms: number
  updated_at_ms: number
  member_count: number
}

export interface TeamMember {
  user_email: string
  role: 'owner' | 'member'
  added_by: string | null
  joined_at_ms: number
}

export async function listTeams(): Promise<TeamSummary[]> {
  const { data } = await client.get<{ items: TeamSummary[] }>('/')
  return data.items
}

export async function createTeam(input: { name: string; description?: string }): Promise<TeamSummary> {
  const { data } = await client.post<TeamSummary>('/', input)
  return data
}

export async function getTeam(id: number): Promise<{ team: TeamSummary; members: TeamMember[] }> {
  const { data } = await client.get(`/${id}`)
  return data
}

export async function updateTeam(id: number, input: { name?: string; description?: string }): Promise<void> {
  await client.patch(`/${id}`, input)
}

export async function deleteTeam(id: number): Promise<void> {
  await client.delete(`/${id}`)
}

export async function addMember(teamId: number, user_email: string, role: 'owner' | 'member' = 'member'): Promise<void> {
  await client.post(`/${teamId}/members`, { user_email, role })
}

export async function removeMember(teamId: number, email: string): Promise<void> {
  await client.delete(`/${teamId}/members/${encodeURIComponent(email)}`)
}
