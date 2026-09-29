export type Role = 'citizen' | 'municipal_officer' | 'municipality_head'
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
export type ComplaintStatus =
  | 'SUBMITTED'
  | 'AI_ANALYSIS_COMPLETE'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'PENDING_VERIFICATION'
  | 'RESOLVED'
  | 'ESCALATED'
  | 'REOPENED'

export interface User {
  id: string
  name: string
  role: Role
  language: 'en' | 'ta' | 'hi'
  location: string
}

export interface AIAnalysis {
  category: string
  severity: Severity
  confidence: number
  summary: string
  department: string
  duplicateCandidates: Array<{ id: string; title: string; distance: number; status: string; issue: string }>
}

export interface TimelineEvent {
  id: string
  complaintId: string
  status: string
  actor: string
  timestamp: string
  description: string
}

export interface Complaint {
  id: string
  citizenId: string
  title: string
  description: string
  category: string
  severity: Severity
  status: ComplaintStatus
  departmentId: string
  officerId?: string
  latitude: number
  longitude: number
  address: string
  imageUrl?: string
  resolutionImageUrl?: string
  createdAt: string
  updatedAt: string
  slaDeadline: string
  isDuplicate: boolean
  duplicateOf?: string
  duplicateCount: number
  aiConfidence: number
  aiSummary: string
  timeline: TimelineEvent[]
  verification?: {
    status?: string
    confidence?: number
    reason?: string
    verifiedBy?: string
  }
}

export interface Department {
  id: string
  name: string
  type: string
  contact: string
  slaRules: Record<string, number>
}

export interface Officer {
  id: string
  name: string
  departmentId: string
  role: string
  status: 'available' | 'busy'
}

export interface Notification {
  id: string
  userId: string
  message: string
  type: 'info' | 'warning' | 'success' | 'error'
  read: boolean
  createdAt: string
}

export interface DuplicateCheckResult {
  isDuplicate: boolean
  similarComplaint?: Complaint
  duplicateCount: number
  message: string
}

export interface ResolutionVerification {
  status: 'verified' | 'needs_review'
  confidence: number
  reason: string
}
