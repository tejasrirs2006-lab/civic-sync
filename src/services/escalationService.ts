import type { Complaint } from '../types'

export function getSlaHours(severity: string) {
  const map: Record<string, number> = { CRITICAL: 2, HIGH: 8, MEDIUM: 24, LOW: 72 }
  return map[severity] ?? 24
}

export function shouldEscalate(complaint: Complaint, now = new Date()) {
  const sla = new Date(complaint.slaDeadline)
  if (complaint.status === 'RESOLVED' || complaint.status === 'REOPENED') return false
  return now > sla
}

export function escalateComplaint(complaint: Complaint): Complaint {
  return {
    ...complaint,
    status: 'ESCALATED',
    updatedAt: new Date().toISOString(),
    timeline: [
      ...complaint.timeline,
      {
        id: `timeline-${Date.now()}`,
        complaintId: complaint.id,
        status: 'Escalated',
        actor: 'SLA Monitor',
        timestamp: new Date().toISOString(),
        description: 'Complaint automatically escalated due to delayed response.',
      },
    ],
  }
}
