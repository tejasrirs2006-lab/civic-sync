import type { ReactNode } from 'react'
import type { Complaint } from '../types'

export function Button({ children, className = '', variant = 'primary', ...props }: { children: ReactNode; className?: string; variant?: 'primary' | 'secondary' | 'danger' | 'success'; [key: string]: unknown }) {
  const styles = {
    primary: 'bg-blue-900 text-white hover:bg-blue-800',
    secondary: 'bg-slate-100 text-slate-800 hover:bg-slate-200',
    danger: 'bg-red-600 text-white hover:bg-red-500',
    success: 'bg-emerald-600 text-white hover:bg-emerald-500',
  }

  return (
    <button className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-sm transition ${styles[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>{children}</div>
}

export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>{children}</span>
}

export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    SUBMITTED: 'bg-blue-100 text-blue-700',
    ASSIGNED: 'bg-sky-100 text-sky-700',
    IN_PROGRESS: 'bg-amber-100 text-amber-700',
    ESCALATED: 'bg-red-100 text-red-700',
    RESOLVED: 'bg-emerald-100 text-emerald-700',
    REOPENED: 'bg-orange-100 text-orange-700',
    PENDING_VERIFICATION: 'bg-yellow-100 text-yellow-700',
  }

  return <Badge className={colors[status] ?? 'bg-slate-100 text-slate-700'}>{status}</Badge>
}

export function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    CRITICAL: 'bg-red-100 text-red-700',
    HIGH: 'bg-orange-100 text-orange-700',
    MEDIUM: 'bg-yellow-100 text-yellow-700',
    LOW: 'bg-green-100 text-green-700',
  }

  return <Badge className={colors[severity] ?? 'bg-slate-100 text-slate-700'}>{severity}</Badge>
}

export function ComplaintCard({ complaint, onClick }: { complaint: Complaint; onClick?: () => void }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" onClick={onClick} role="button" tabIndex={0}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.15em] text-slate-500">{complaint.id}</p>
          <h3 className="mt-1 text-base font-semibold text-slate-800">{complaint.title}</h3>
        </div>
        <SeverityBadge severity={complaint.severity} />
      </div>
      <div className="space-y-2 text-sm text-slate-600">
        <p>{complaint.address}</p>
        <p>{complaint.category}</p>
        <p>{complaint.departmentId}</p>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <StatusBadge status={complaint.status} />
        <span className="text-xs text-slate-400">{new Date(complaint.createdAt).toLocaleDateString()}</span>
      </div>
    </div>
  )
}

export function ComplaintTable({ complaints, onSelect }: { complaints: Complaint[]; onSelect: (complaint: Complaint) => void }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="p-3">Complaint ID</th>
            <th className="p-3">Issue</th>
            <th className="p-3">Severity</th>
            <th className="p-3">Location</th>
            <th className="p-3">Age</th>
            <th className="p-3">SLA</th>
            <th className="p-3">Status</th>
            <th className="p-3">Action</th>
          </tr>
        </thead>
        <tbody>
          {complaints.map((complaint) => (
            <tr key={complaint.id} className="border-t border-slate-200">
              <td className="p-3 font-medium text-slate-800">{complaint.id}</td>
              <td className="p-3">{complaint.title}</td>
              <td className="p-3"><SeverityBadge severity={complaint.severity} /></td>
              <td className="p-3">{complaint.address}</td>
              <td className="p-3">{Math.max(1, Math.round((Date.now() - new Date(complaint.createdAt).getTime()) / 3600000))}h</td>
              <td className="p-3">{new Date(complaint.slaDeadline).toLocaleDateString()}</td>
              <td className="p-3"><StatusBadge status={complaint.status} /></td>
              <td className="p-3"><Button variant="secondary" onClick={() => onSelect(complaint)}>View</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Timeline({ items }: { items: Array<{ id: string; status: string; actor: string; timestamp: string; description: string }> }) {
  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <div key={item.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className={`h-3 w-3 rounded-full ${index === items.length - 1 ? 'bg-slate-400' : 'bg-blue-600'}`} />
            {index !== items.length - 1 && <div className="mt-1 h-10 w-px bg-slate-200" />}
          </div>
          <div className="flex-1 rounded-xl bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-slate-800">{item.status}</p>
              <span className="text-xs text-slate-500">{item.actor}</span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{item.description}</p>
            <p className="mt-2 text-xs text-slate-400">{new Date(item.timestamp).toLocaleString()}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

export function StatsCard({ label, value, tone = 'blue' }: { label: string; value: string; tone?: 'blue' | 'green' | 'amber' | 'red' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
  }

  return <div className={`rounded-2xl border border-slate-200 p-4 ${colors[tone]}`}><p className="text-xs uppercase tracking-[0.15em]">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></div>
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center"><h3 className="font-semibold text-slate-800">{title}</h3><p className="mt-2 text-sm text-slate-500">{description}</p></div>
}

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">{label}</div>
}
