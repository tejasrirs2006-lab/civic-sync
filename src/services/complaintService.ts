import { complaints as initialComplaints } from '../data/mockData'
import type { Complaint } from '../types'

const localKey = 'civic-sync-complaints'

export async function listComplaints() {
  try {
    const response = await fetch('/api/complaints')
    if (!response.ok) throw new Error('API failed')
    return (await response.json()) as Complaint[]
  } catch {
    const cached = localStorage.getItem(localKey)
    return cached ? (JSON.parse(cached) as Complaint[]) : initialComplaints
  }
}

export async function getComplaintById(id: string) {
  const list = await listComplaints()
  return list.find((item) => item.id === id) ?? null
}

export async function createComplaint(payload: Partial<Complaint>) {
  const list = await listComplaints()
  const newComplaint: Complaint = {
    id: payload.id ?? `CS${Math.floor(1000 + Math.random() * 9000)}`,
    citizenId: payload.citizenId ?? 'citizen-1',
    title: payload.title ?? 'Civic complaint',
    description: payload.description ?? '',
    category: payload.category ?? 'Other',
    severity: payload.severity ?? 'MEDIUM',
    status: 'SUBMITTED',
    departmentId: payload.departmentId ?? 'dept-road',
    officerId: payload.officerId,
    latitude: payload.latitude ?? 13.0875,
    longitude: payload.longitude ?? 80.2096,
    address: payload.address ?? 'Chennai',
    imageUrl: payload.imageUrl,
    resolutionImageUrl: payload.resolutionImageUrl,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    slaDeadline: payload.slaDeadline ?? new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    isDuplicate: false,
    duplicateCount: 0,
    aiConfidence: payload.aiConfidence ?? 80,
    aiSummary: payload.aiSummary ?? 'Complaint submitted',
    timeline: [
      {
        id: `timeline-${Date.now()}`,
        complaintId: payload.id ?? 'new',
        status: 'Complaint Submitted',
        actor: 'Citizen',
        timestamp: new Date().toISOString(),
        description: 'Citizen complaint submitted.',
      },
    ],
  }

  const updated = [newComplaint, ...list]
  localStorage.setItem(localKey, JSON.stringify(updated))

  try {
    await fetch('/api/complaints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newComplaint),
    })
  } catch {
    // silent fallback; local storage remains the source of truth for this demo
  }

  return newComplaint
}

export async function updateComplaint(id: string, updates: Partial<Complaint>) {
  const list = await listComplaints()
  const updated = list.map((item) => (item.id === id ? { ...item, ...updates, updatedAt: new Date().toISOString() } : item))
  localStorage.setItem(localKey, JSON.stringify(updated))

  try {
    await fetch(`/api/complaints/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
  } catch {
    // silent fallback
  }

  return updated.find((item) => item.id === id) ?? null
}
