import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { BrowserRouter, Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { MapView } from './components/MapView'
import {
  Button,
  Card,
  ComplaintCard,
  ComplaintTable,
  EmptyState,
  LoadingState,
  SeverityBadge,
  StatsCard,
  StatusBadge,
  Timeline,
} from './components/ui'
import { departments, notifications as seedNotifications, users } from './data/mockData'
import { getTranslation, type TranslationKey } from './lib/translations'
import { analyzeComplaintText } from './services/aiService'
import { createComplaint, listComplaints, updateComplaint } from './services/complaintService'
import { checkDuplicateComplaint } from './services/duplicateService'
import { escalateComplaint, getSlaHours, shouldEscalate } from './services/escalationService'
import { getCurrentLocation, getDemoCoordinates, getNearbyIssues } from './services/locationService'
import { routeComplaint } from './services/routingService'
import type { Complaint, Notification, Role, User } from './types'

const defaultUser: User = { id: 'citizen-1', name: 'Ananya', role: 'citizen', language: 'en', location: 'Anna Nagar, Chennai' }
const AUTH_STORAGE_KEY = 'civic-sync-users'

type StoredUser = User & {
  username?: string
  password?: string
  mobileNumber?: string
  email?: string
  preferredLanguage?: 'en' | 'ta' | 'hi'
  state?: string
  district?: string
  localBody?: string
  ward?: string
  officialEmail?: string
  officialMobile?: string
  staffId?: string
  employeeId?: string
  department?: string
  designation?: string
  roleLevel?: string
  adminRole?: string
  twoFactor?: boolean
}

type ReportMethod = 'camera' | 'voice' | 'text'

type DraftComplaint = {
  id?: string
  title: string
  description: string
  category: string
  severity: string
  department: string
  confidence: number
  summary: string
  address: string
  latitude: number
  longitude: number
  imageUrl?: string
}

function getRoleLabel(role: Role) {
  switch (role) {
    case 'citizen':
      return 'Citizen'
    case 'municipal_officer':
      return 'Municipal Officer'
    case 'municipality_head':
      return 'Municipality Head'
    default:
      return 'Citizen'
  }
}

function translateText(text: string, lang: 'en' | 'ta' | 'hi' | 'te' | 'ml') {
  const replacements: Record<string, string> = {
    pothole: lang === 'ta' ? 'துளை' : lang === 'hi' ? 'गड्ढा' : lang === 'te' ? 'బీట' : lang === 'ml' ? 'ചുരം' : 'pothole',
    garbage: lang === 'ta' ? 'கழிவுகள்' : lang === 'hi' ? 'कचरा' : lang === 'te' ? 'చెత్త' : lang === 'ml' ? 'മാലിന്യം' : 'garbage',
    flood: lang === 'ta' ? 'வெள்ளம்' : lang === 'hi' ? 'बाढ़' : lang === 'te' ? 'జలప్రళయం' : lang === 'ml' ? 'വെള്ളപ്പൊക്കം' : 'flood',
    road: lang === 'ta' ? 'சாலை' : lang === 'hi' ? 'सड़क' : lang === 'te' ? 'రోడ్డు' : lang === 'ml' ? 'റോഡ്' : 'road',
    water: lang === 'ta' ? 'நீர்' : lang === 'hi' ? 'पानी' : lang === 'te' ? 'నీరు' : lang === 'ml' ? 'വെള്ളം' : 'water',
    light: lang === 'ta' ? 'விளக்கு' : lang === 'hi' ? 'लाइट' : lang === 'te' ? 'లైట్' : lang === 'ml' ? 'ലൈറ്റ്' : 'light',
    street: lang === 'ta' ? 'தெரு' : lang === 'hi' ? 'सड़क' : lang === 'te' ? 'వీధి' : lang === 'ml' ? 'ത ули' : 'street',
    issue: lang === 'ta' ? 'சிக்கல்' : lang === 'hi' ? 'समस्या' : lang === 'te' ? 'సమస్య' : lang === 'ml' ? 'പ്രശ്നം' : 'issue',
  }

  let translated = text
  Object.entries(replacements).forEach(([key, value]) => {
    translated = translated.replace(new RegExp(key, 'gi'), value)
  })

  return translated || text
}

function analyzeImageAuthenticity(complaint: Complaint, complaints: Complaint[] = []) {
  const source = detectImageSource(complaint.imageUrl)
  const duplicateImage = detectDuplicateImage(complaint.imageUrl, complaints)
  const defects = detectRoadDefects(`${complaint.title} ${complaint.description} ${complaint.aiSummary}`)
  const criteria = [
    { label: 'Live Camera Capture', passed: source === 'live-camera' },
    { label: 'Capture Timestamp', passed: Boolean(complaint.createdAt) },
    { label: 'GPS Location Match', passed: Boolean(complaint.latitude && complaint.longitude && complaint.address) },
    { label: 'Image Tampering Detection', passed: source !== 'existing-online-or-gallery' },
    { label: 'Duplicate Image Detection', passed: !duplicateImage && !(complaint.duplicateCount > 0) },
    { label: 'Issue Visibility', passed: defects.length > 0 || Boolean(complaint.title && complaint.description && complaint.aiSummary) },
    { label: 'Scene–Location Consistency', passed: Boolean(complaint.address && complaint.category) },
    { label: 'Image Quality & Authenticity', passed: Boolean(complaint.imageUrl && complaint.imageUrl.length > 1000) },
  ]

  const finalResult = criteria.every((item) => item.passed) ? 'real' : "it's a spam"

  return { criteria, defects, source, duplicateImage, finalResult }
}

const ROAD_DEFECTS = [
  { label: 'Potholes', patterns: [/pothole|hole in road|road hole|large pit/i] },
  { label: 'Cracks', patterns: [/crack|surface crack|road crack|fracture/i] },
  { label: 'Rutting', patterns: [/rutting|wheel rut|track mark|deep grooves/i] },
  { label: 'Road Depressions', patterns: [/depression|sunken road|dip in road|low area/i] },
  { label: 'Uneven Road Surface', patterns: [/uneven road|rough surface|bumpy road|uneven surface/i] },
  { label: 'Pavement Patches', patterns: [/patch|patched pavement|repair patch/i] },
  { label: 'Ravelling', patterns: [/ravelling|loose aggregate|surface disintegration/i] },
  { label: 'Edge Cracks', patterns: [/edge crack|road edge crack|shoulder crack/i] },
  { label: 'Road Shoulder Damage', patterns: [/shoulder damage|road shoulder|damaged shoulder/i] },
  { label: 'Road Erosion', patterns: [/erosion|washed away|soil erosion|eroded road/i] },
  { label: 'Sinkholes', patterns: [/sinkhole|cavity|collapse in road/i] },
  { label: 'Waterlogging', patterns: [/waterlogging|water log|flooded road|stagnant water/i] },
  { label: 'Drainage Damage', patterns: [/drainage|blocked drain|damaged drain|water drain/i] },
  { label: 'Manhole Damage', patterns: [/manhole|damaged manhole|open cover|cover damage/i] },
  { label: 'Speed Breaker Damage', patterns: [/speed breaker|speed bump|damaged bump/i] },
  { label: 'Loose Gravel', patterns: [/loose gravel|gravel|stone spread/i] },
  { label: 'Road Debris', patterns: [/debris|road debris|construction waste|litter on road/i] },
  { label: 'Faded Road Markings', patterns: [/faded marking|road marking|lane marking|paint faded/i] },
  { label: 'Damaged Road Signs', patterns: [/damaged sign|road sign|missing sign|broken sign/i] },
  { label: 'Pavement Bleeding', patterns: [/bleeding|asphalt bleeding|bitumen seepage/i] },
] as const

function detectImageSource(imageUrl?: string) {
  if (!imageUrl) return 'unknown'
  if (imageUrl.startsWith('data:image')) return 'live-camera'
  if (/https?:\/\//i.test(imageUrl) || /gallery|upload|stock|unsplash|example|demo|placeholder/i.test(imageUrl)) return 'existing-online-or-gallery'
  return 'user-uploaded'
}

function detectDuplicateImage(imageUrl: string | undefined, complaints: Complaint[]) {
  if (!imageUrl) return false
  const compact = imageUrl.replace(/^data:image\/[^;]+;base64,/, '').slice(0, 200)
  return complaints.some((item) => {
    if (!item.imageUrl || item.imageUrl === imageUrl) return false
    const compare = item.imageUrl.replace(/^data:image\/[^;]+;base64,/, '').slice(0, 200)
    return compare === compact || item.imageUrl === imageUrl || item.imageUrl.includes(imageUrl.slice(-25))
  })
}

function detectRoadDefects(text: string) {
  const lower = text.toLowerCase()
  return ROAD_DEFECTS.filter(({ patterns }) => patterns.some((pattern) => pattern.test(lower))).map(({ label }) => label)
}

function getAuthenticityScore({
  source,
  isDuplicateImage,
  detectedDefects,
  sceneMatch,
  qualityOk,
  gpsMatch,
  issueVisible,
}: {
  source: string
  isDuplicateImage: boolean
  detectedDefects: string[]
  sceneMatch: boolean
  qualityOk: boolean
  gpsMatch: boolean
  issueVisible: boolean
}) {
  const checks = [
    { passed: source === 'live-camera', weight: 22 },
    { passed: !isDuplicateImage, weight: 18 },
    { passed: detectedDefects.length >= 1, weight: 18 },
    { passed: sceneMatch, weight: 12 },
    { passed: qualityOk, weight: 12 },
    { passed: gpsMatch, weight: 10 },
    { passed: issueVisible, weight: 8 },
  ]

  const score = checks.reduce((total, item) => total + (item.passed ? item.weight : 0), 0)
  const verdict = source === 'live-camera' && !isDuplicateImage && detectedDefects.length > 0 && sceneMatch && qualityOk && gpsMatch && score >= 70 ? 'real' : "it's a spam"

  return { score, verdict, checks }
}

function getDashboardPath(role: Role) {
  switch (role) {
    case 'citizen':
      return '/citizen'
    case 'municipal_officer':
      return '/officer'
    case 'municipality_head':
      return '/admin'
    default:
      return '/citizen'
  }
}

function loadStoredUsers(): StoredUser[] {
  try {
    const existing = localStorage.getItem(AUTH_STORAGE_KEY)
    return existing ? JSON.parse(existing) as StoredUser[] : []
  } catch {
    return []
  }
}

function saveStoredUsers(users: StoredUser[]) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(users))
}

function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  )
}

function AppShell() {
  const [language, setLanguage] = useState<'en' | 'ta' | 'hi'>('en')
  const [currentUser, setCurrentUser] = useState<User>(defaultUser)
  const [complaints, setComplaints] = useState<Complaint[]>([])
  const [notifications, setNotifications] = useState<Notification[]>(seedNotifications)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const list = await listComplaints()
      setComplaints(list)
      setNotifications(seedNotifications)
    }
    load()
  }, [])

  useEffect(() => {
    setComplaints((existing) => existing.map((item) => (shouldEscalate(item, new Date()) ? escalateComplaint(item) : item)))
  }, [])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), 2500)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const t = (key: TranslationKey) => getTranslation(language, key)

  const handleRoleSelect = (nextRole: Role) => {
    const selected = users.find((user) => user.role === nextRole) ?? defaultUser
    setCurrentUser(selected)
    setLanguage(selected.language as 'en' | 'ta' | 'hi')
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      {toast && <div className="fixed right-4 top-4 z-50 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">{toast}</div>}
      <Routes>
        <Route path="/" element={<LoginPage onLogin={(user) => { setCurrentUser(user); setLanguage(user.language) }} onRoleSelect={handleRoleSelect} />} />
        <Route path="/login" element={<LoginPage onLogin={(user) => { setCurrentUser(user); setLanguage(user.language) }} onRoleSelect={handleRoleSelect} />} />
        <Route path="/citizen" element={<CitizenDashboard complaints={complaints} notifications={notifications} t={t} currentUser={currentUser} />} />
        <Route path="/citizen/report" element={<CitizenReportFlow complaints={complaints} setComplaints={setComplaints} setToast={setToast} currentUser={currentUser} />} />
        <Route path="/citizen/complaints" element={<CitizenComplaints complaints={complaints} />} />
        <Route path="/citizen/complaints/:id" element={<ComplaintTrackingPage complaints={complaints} setComplaints={setComplaints} />} />
        <Route path="/citizen/map" element={<CitizenNearbyMap complaints={complaints} />} />
        <Route path="/officer" element={<OfficerDashboard complaints={complaints} />} />
        <Route path="/officer/complaints" element={<OfficerComplaintQueue complaints={complaints} />} />
        <Route path="/officer/complaints/:id" element={<OfficerComplaintDetail complaints={complaints} setComplaints={setComplaints} />} />
        <Route path="/officer/map" element={<OfficerMap complaints={complaints} />} />
        <Route path="/officer/escalated" element={<EscalatedQueue complaints={complaints} />} />
        <Route path="/officer/resolved" element={<ResolvedQueue complaints={complaints} />} />
        <Route path="/officer/analytics" element={<AnalyticsConsole complaints={complaints} role="Municipal Officer" />} />
        <Route path="/admin" element={<AdminDashboard complaints={complaints} />} />
        <Route path="/admin/complaints" element={<AdminComplaintList complaints={complaints} />} />
        <Route path="/admin/map" element={<AdminMap complaints={complaints} />} />
        <Route path="/admin/analytics" element={<AnalyticsConsole complaints={complaints} role="Municipality Head" />} />
        <Route path="/profile" element={<ProfilePage currentUser={currentUser} onUpdateProfile={(user) => { setCurrentUser(user); setLanguage(user.language) }} />} />
      </Routes>
    </div>
  )
}

function LoginPage({ onLogin, onRoleSelect }: { onLogin: (user: User) => void; onRoleSelect: (role: Role) => void }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState<'signup' | 'signin'>(searchParams.get('mode') === 'signin' ? 'signin' : 'signup')

  useEffect(() => {
    setMode(searchParams.get('mode') === 'signin' ? 'signin' : 'signup')
  }, [searchParams])
  const [role, setRole] = useState<Role>('citizen')
  const [loginError, setLoginError] = useState('')
  const [signinUsername, setSigninUsername] = useState('')
  const [signinPassword, setSigninPassword] = useState('')
  const [signinRole, setSigninRole] = useState<Role>('citizen')
  const [form, setForm] = useState({
    username: '',
    fullName: '',
    mobileNumber: '',
    email: '',
    password: '',
    preferredLanguage: 'en',
    state: 'Tamil Nadu',
    district: 'Chennai',
    localBody: 'Chennai Municipal Corporation',
    ward: 'Ward 12',
    location: '',
    officialEmail: '',
    officialMobile: '',
    staffId: '',
    department: 'Roads & Infrastructure',
    designation: 'Field Officer',
    roleLevel: 'Field Operator',
    employeeId: '',
    adminRole: 'Department Administrator',
    twoFactor: true,
  })

  const handleChange = (field: string, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSignup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoginError('')

    const username = form.username.trim()
    const password = form.password.trim()

    if (!username || !password || !form.fullName.trim()) {
      setLoginError('Please enter a username, password, and full name.')
      return
    }

    const storedUsers = loadStoredUsers()
    if (storedUsers.some((user) => user.name.toLowerCase() === form.fullName.trim().toLowerCase() && user.role === role)) {
      setLoginError('An account with this full name and role already exists. Please sign in instead.')
      return
    }

    const user: User = {
      id: `${role}-${Date.now()}`,
      name: form.fullName.trim(),
      role,
      language: form.preferredLanguage as 'en' | 'ta' | 'hi',
      location: form.location || `${form.district || 'Chennai'}, ${form.state || 'Tamil Nadu'}`,
    }

    const account: StoredUser = {
      ...user,
      username,
      password,
      mobileNumber: form.mobileNumber.trim(),
      email: form.email.trim(),
      preferredLanguage: form.preferredLanguage as 'en' | 'ta' | 'hi',
      state: form.state.trim(),
      district: form.district.trim(),
      localBody: form.localBody.trim(),
      ward: form.ward.trim(),
      officialEmail: form.officialEmail.trim(),
      officialMobile: form.officialMobile.trim(),
      staffId: form.staffId.trim(),
      employeeId: form.employeeId.trim(),
      department: form.department.trim(),
      designation: form.designation.trim(),
      roleLevel: form.roleLevel.trim(),
      adminRole: form.adminRole.trim(),
      twoFactor: form.twoFactor,
    }
    saveStoredUsers([...storedUsers, account])
    onRoleSelect(role)
    onLogin(user)
    navigate(getDashboardPath(role))
  }

  const handleSignin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoginError('')

    const username = signinUsername.trim()
    const password = signinPassword.trim()

    if (!username || !password) {
      setLoginError('Please enter your username and password.')
      return
    }

    const storedUsers = loadStoredUsers()
    const account = storedUsers.find((user) => user.username === username && user.password === password && user.role === signinRole)

    if (!account) {
      setLoginError('Invalid username, password, or role. Please register first or use the correct account.')
      return
    }

    const user: User = {
      id: account.id,
      name: account.name,
      role: account.role,
      language: account.language ?? 'en',
      location: account.location ?? 'Chennai',
    }

    onRoleSelect(signinRole)
    onLogin(user)
    navigate(getDashboardPath(signinRole))
  }

  const roleFields = {
    citizen: (
      <>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">Username<input value={form.username} onChange={(e) => handleChange('username', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" placeholder="Username" /></label>
          <label className="text-sm font-medium text-slate-700">Full Name<input value={form.fullName} onChange={(e) => handleChange('fullName', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" placeholder="Full Name" /></label>
          <label className="text-sm font-medium text-slate-700">Mobile Number<input value={form.mobileNumber} onChange={(e) => handleChange('mobileNumber', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" placeholder="Mobile Number" /></label>
          <label className="text-sm font-medium text-slate-700">Email ID (optional)<input value={form.email} onChange={(e) => handleChange('email', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" placeholder="Email ID" /></label>
          <label className="text-sm font-medium text-slate-700">Password<input type="password" value={form.password} onChange={(e) => handleChange('password', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" placeholder="Password" /></label>
          <label className="text-sm font-medium text-slate-700">Preferred Language<select value={form.preferredLanguage} onChange={(e) => handleChange('preferredLanguage', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><option value="en">English</option><option value="ta">Tamil</option><option value="hi">Hindi</option></select></label>
          <label className="text-sm font-medium text-slate-700">Location<input value={form.location} onChange={(e) => handleChange('location', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" placeholder="Current location" /></label>
          <label className="text-sm font-medium text-slate-700">State<input value={form.state} onChange={(e) => handleChange('state', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">District<input value={form.district} onChange={(e) => handleChange('district', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Local Body / Municipality / Corporation<input value={form.localBody} onChange={(e) => handleChange('localBody', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Ward<input value={form.ward} onChange={(e) => handleChange('ward', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
        </div>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <p className="font-semibold text-slate-800">Profile</p>
          <label className="mt-2 block"><span className="mr-2">Profile Photo (optional)</span><input type="file" className="mt-1 block w-full text-sm" /></label>
          <div className="mt-3">
            <p className="font-medium text-slate-800">Notification Preferences</p>
            <label className="mt-2 flex items-center gap-2"><input type="checkbox" defaultChecked /> SMS updates</label>
            <label className="mt-1 flex items-center gap-2"><input type="checkbox" defaultChecked /> Email alerts</label>
          </div>
        </div>
      </>
    ),
    municipal_officer: (
      <>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">Username<input value={form.username} onChange={(e) => handleChange('username', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Full Name<input value={form.fullName} onChange={(e) => handleChange('fullName', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Official Email<input value={form.officialEmail} onChange={(e) => handleChange('officialEmail', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Official Mobile Number<input value={form.officialMobile} onChange={(e) => handleChange('officialMobile', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Password<input type="password" value={form.password} onChange={(e) => handleChange('password', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Employee / Staff ID<input value={form.staffId} onChange={(e) => handleChange('staffId', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">State<input value={form.state} onChange={(e) => handleChange('state', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">District<input value={form.district} onChange={(e) => handleChange('district', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Local Body<select value={form.localBody} onChange={(e) => handleChange('localBody', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><option>Chennai Municipal Corporation</option><option>Municipality</option><option>Panchayat</option></select></label>
          <label className="text-sm font-medium text-slate-700">Local Body Type<select value={form.localBody} onChange={(e) => handleChange('localBody', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><option>Municipality</option><option>Municipal Corporation</option><option>Panchayat</option></select></label>
          <label className="text-sm font-medium text-slate-700">Zone<input value={form.ward} onChange={(e) => handleChange('ward', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" placeholder="Zone" /></label>
          <label className="text-sm font-medium text-slate-700">Ward<input value={form.ward} onChange={(e) => handleChange('ward', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Department<select value={form.department} onChange={(e) => handleChange('department', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><option>Roads & Infrastructure</option><option>Sanitation</option><option>Water Supply</option><option>Electrical / Street Lighting</option><option>Drainage / Disaster Response</option></select></label>
          <label className="text-sm font-medium text-slate-700">Designation<input value={form.designation} onChange={(e) => handleChange('designation', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Role<select value={form.adminRole} onChange={(e) => handleChange('adminRole', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><option>Field Operator</option><option>Department Supervisor</option><option>Municipal Officer</option></select></label>
          <label className="text-sm font-medium text-slate-700">Permission Level<select value={form.roleLevel} onChange={(e) => handleChange('roleLevel', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><option>Department Access</option><option>Zone Access</option><option>Citywide Access</option></select></label>
        </div>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.twoFactor} onChange={(e) => handleChange('twoFactor', e.target.checked)} /> 2-Factor Authentication</label>
          <p className="mt-2">Account Status: Active</p>
          <p>Last Login: Today</p>
        </div>
      </>
    ),
    municipality_head: (
      <>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">Username<input value={form.username} onChange={(e) => handleChange('username', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Full Name<input value={form.fullName} onChange={(e) => handleChange('fullName', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Official Email<input value={form.officialEmail} onChange={(e) => handleChange('officialEmail', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Official Mobile Number<input value={form.officialMobile} onChange={(e) => handleChange('officialMobile', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Employee / Officer ID<input value={form.employeeId} onChange={(e) => handleChange('employeeId', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Password<input type="password" value={form.password} onChange={(e) => handleChange('password', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Designation<input value={form.designation} onChange={(e) => handleChange('designation', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" defaultValue="Municipal Commissioner" /></label>
          <label className="text-sm font-medium text-slate-700">State<input value={form.state} onChange={(e) => handleChange('state', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">District<input value={form.district} onChange={(e) => handleChange('district', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Municipal Corporation / Municipality<input value={form.localBody} onChange={(e) => handleChange('localBody', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Zones<input value={form.ward} onChange={(e) => handleChange('ward', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Wards<input value={form.ward} onChange={(e) => handleChange('ward', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Departments under supervision<select value={form.department} onChange={(e) => handleChange('department', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><option>All Departments</option><option>Roads & Infrastructure</option><option>Drainage & Disaster Response</option><option>Sanitation</option></select></label>
        </div>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <p className="font-semibold text-slate-800">Dashboard Access</p>
          <ul className="mt-2 list-inside list-disc space-y-1">
            <li>Total Issues</li>
            <li>Critical / High Issues</li>
            <li>Pending Issues</li>
            <li>Overdue Issues</li>
            <li>Resolved Issues</li>
            <li>SLA Compliance</li>
            <li>Department Performance</li>
            <li>Civic Hotspots</li>
            <li>Escalated Issues</li>
          </ul>
          <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={form.twoFactor} onChange={(e) => handleChange('twoFactor', e.target.checked)} /> Strong password + 2FA / OTP</label>
        </div>
      </>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-2xl font-black tracking-tight text-blue-900">CIVIC SYNC</p>
          <p className="text-sm text-slate-600">Secure access portal</p>
        </div>
        <Button variant="secondary" onClick={() => navigate('/')}>Back to Home</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <aside className="rounded-3xl bg-slate-900 p-6 text-white shadow-lg">
          <h1 className="text-3xl font-black">Access</h1>
          <p className="mt-3 text-slate-300">Set up your account once and sign in with your username and password next time.</p>
          <div className="mt-6 flex gap-3">
            <button type="button" onClick={() => setMode('signup')} className={`flex-1 rounded-2xl px-4 py-3 font-semibold ${mode === 'signup' ? 'bg-blue-700 text-white' : 'bg-slate-800 text-slate-200'}`}>Sign Up</button>
            <button type="button" onClick={() => setMode('signin')} className={`flex-1 rounded-2xl px-4 py-3 font-semibold ${mode === 'signin' ? 'bg-blue-700 text-white' : 'bg-slate-800 text-slate-200'}`}>Sign In</button>
          </div>
          <div className="mt-6 space-y-3">
            {(['citizen', 'municipal_officer', 'municipality_head'] as Role[]).map((option) => (
              <button key={option} type="button" onClick={() => { setRole(option); setSigninRole(option) }} className={`w-full rounded-2xl px-4 py-3 text-left font-semibold ${role === option ? 'bg-blue-700 text-white' : 'bg-slate-800 text-slate-200'}`}>
                {getRoleLabel(option)}
              </button>
            ))}
          </div>
        </aside>

        {mode === 'signup' ? (
          <form onSubmit={handleSignup} className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-slate-900">{getRoleLabel(role)} Registration</h2>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">First Time</span>
            </div>
            {loginError && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loginError}</div>}
            {roleFields[role]}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-between">
              <Button type="button" variant="secondary" onClick={() => navigate('/')}>Cancel</Button>
              <Button type="submit">CREATE ACCOUNT</Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSignin} className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-slate-900">Sign In</h2>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Returning User</span>
            </div>
            {loginError && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loginError}</div>}
            <div className="space-y-4">
              <label className="block text-sm font-medium text-slate-700">Role<select value={signinRole} onChange={(e) => setSigninRole(e.target.value as Role)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><option value="citizen">Citizen</option><option value="municipal_officer">Municipal Officer</option><option value="municipality_head">Municipality Head</option></select></label>
              <label className="block text-sm font-medium text-slate-700">Username<input value={signinUsername} onChange={(e) => setSigninUsername(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" placeholder="Enter username" /></label>
              <label className="block text-sm font-medium text-slate-700">Password<input type="password" value={signinPassword} onChange={(e) => setSigninPassword(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" placeholder="Enter password" /></label>
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-between">
              <Button type="button" variant="secondary" onClick={() => navigate('/')}>Cancel</Button>
              <Button type="submit">SIGN IN</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function CitizenDashboard({ complaints, notifications, currentUser, t }: { complaints: Complaint[]; notifications: Notification[]; t: (key: TranslationKey) => string; currentUser: User }) {
  const navigate = useNavigate()
  const summary = useMemo(() => ({
    active: complaints.filter((item) => item.status !== 'RESOLVED').length,
    pending: complaints.filter((item) => item.status === 'PENDING_VERIFICATION' || item.status === 'ASSIGNED' || item.status === 'IN_PROGRESS').length,
    resolved: complaints.filter((item) => item.status === 'RESOLVED').length,
  }), [complaints])

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-4">
      <header className="mb-6 rounded-2xl bg-slate-900 p-4 text-white shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xl font-bold">{t('reportTitle')}</p>
            <p className="text-sm text-slate-300">{currentUser.location}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="bg-white/10 text-white hover:bg-white/20" onClick={() => navigate('/profile')}>Profile</Button>
            <Button variant="secondary" className="bg-white/10 text-white hover:bg-white/20" onClick={() => navigate('/citizen/complaints')}>Notifications</Button>
          </div>
        </div>
      </header>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Button onClick={() => navigate('/citizen/report')}>REPORT A CIVIC ISSUE</Button>
        <Button variant="secondary" onClick={() => navigate('/citizen/complaints')}>MY COMPLAINTS</Button>
        <Button variant="secondary" onClick={() => navigate('/citizen/map')}>NEARBY ISSUES</Button>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <StatsCard label="Active Complaints" value={String(summary.active)} tone="blue" />
        <StatsCard label="Pending" value={String(summary.pending)} tone="amber" />
        <StatsCard label="Resolved" value={String(summary.resolved)} tone="green" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold">Nearby Issues</h2>
            <Button variant="secondary" onClick={() => navigate('/citizen/map')}>View Map</Button>
          </div>
          <MapView points={complaints.slice(0, 5).map((item) => ({ id: item.id, title: item.title, lat: item.latitude, lng: item.longitude, severity: item.severity, status: item.status }))} />
        </Card>

        <Card>
          <h3 className="mb-3 text-lg font-bold">Notifications</h3>
          <div className="space-y-3">
            {notifications.slice(0, 4).map((item) => (
              <div key={item.id} className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{item.message}</div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold">Recent complaints</h3>
          <Link to="/citizen/complaints" className="text-sm font-semibold text-blue-700">See all</Link>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {complaints.slice(0, 3).map((complaint) => (
            <ComplaintCard key={complaint.id} complaint={complaint} onClick={() => navigate(`/citizen/complaints/${complaint.id}`)} />
          ))}
        </div>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto grid max-w-4xl grid-cols-5 gap-2 text-center text-xs font-semibold text-slate-600">
          <button className="rounded-xl px-2 py-2 hover:bg-slate-100" onClick={() => navigate('/citizen')}>HOME</button>
          <button className="rounded-xl px-2 py-2 hover:bg-slate-100" onClick={() => navigate('/citizen/report')}>REPORT</button>
          <button className="rounded-xl px-2 py-2 hover:bg-slate-100" onClick={() => navigate('/citizen/complaints')}>COMPLAINTS</button>
          <button className="rounded-xl px-2 py-2 hover:bg-slate-100" onClick={() => navigate('/citizen/map')}>MAP</button>
          <button className="rounded-xl px-2 py-2 hover:bg-slate-100" onClick={() => navigate('/profile')}>PROFILE</button>
        </div>
      </nav>
    </div>
  )
}

function CitizenReportFlow({ complaints, setComplaints, setToast, currentUser }: { complaints: Complaint[]; setComplaints: React.Dispatch<React.SetStateAction<Complaint[]>>; setToast: (msg: string | null) => void; currentUser: User }) {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [method, setMethod] = useState<ReportMethod>('camera')
  const [description, setDescription] = useState('There is a large pothole near the main road.')
  const [voiceText, setVoiceText] = useState('')
  const [translationLanguage, setTranslationLanguage] = useState<'en' | 'ta' | 'hi' | 'te' | 'ml'>('en')
  const [capturedPhoto, setCapturedPhoto] = useState<string>('')
  const [analysis, setAnalysis] = useState<any>(null)
  const [draft, setDraft] = useState<DraftComplaint | null>(null)
  const [location, setLocation] = useState(getDemoCoordinates())
  const [duplicateResult, setDuplicateResult] = useState<any>(null)
  const [reviewStep, setReviewStep] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [cameraEvidence, setCameraEvidence] = useState({
    source: 'unknown',
    capturedAt: '',
    gpsMatch: false,
    tamperingDetected: false,
    duplicateDetected: false,
    issueVisible: false,
    sceneMatch: false,
    qualityOk: false,
  })

  useEffect(() => {
    const start = async () => {
      const loc = await getCurrentLocation()
      setLocation(loc)
    }
    start()
  }, [])

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
    } catch {
      setCapturedPhoto('/pothole-demo.svg')
    }
  }

  const capturePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (ctx && videoRef.current.videoWidth) {
        canvas.width = videoRef.current.videoWidth
        canvas.height = videoRef.current.videoHeight
        ctx.drawImage(videoRef.current, 0, 0)
        const imageData = canvas.toDataURL('image/png')
        setCapturedPhoto(imageData)
        setCameraEvidence({
          source: 'in-app-camera',
          capturedAt: new Date().toISOString(),
          gpsMatch: true,
          tamperingDetected: false,
          duplicateDetected: false,
          issueVisible: true,
          sceneMatch: true,
          qualityOk: imageData.length > 15000,
        })
      }
      return
    }

    setCapturedPhoto('/pothole-demo.svg')
    setCameraEvidence({
      source: 'demo',
      capturedAt: new Date().toISOString(),
      gpsMatch: true,
      tamperingDetected: false,
      duplicateDetected: false,
      issueVisible: true,
      sceneMatch: true,
      qualityOk: true,
    })
  }

  const startVoiceRecognition = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setVoiceText('There is a large pothole near the main road.')
      setDescription('There is a large pothole near the main road.')
      setToast('Speech recognition is unavailable; text fallback is active.')
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = 'en-US'
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript
      setVoiceText(transcript)
      setDescription(transcript)
    }
    recognition.start()
  }

  const analyze = () => {
    setIsAnalyzing(true)
    const textToAnalyze = (voiceText || description).trim() || 'There is a large pothole near the main road.'
    const result = analyzeComplaintText(textToAnalyze)
    const route = routeComplaint({ category: result.category, severity: result.severity, description: textToAnalyze })

    const issueDraft: DraftComplaint = {
      title: result.category === 'Road / Pothole' ? 'Pothole' : result.category === 'Garbage / Sanitation' ? 'Garbage accumulation' : 'Civic issue',
      description: textToAnalyze,
      category: result.category,
      severity: result.severity,
      department: route,
      confidence: result.confidence,
      summary: result.summary,
      address: location.address,
      latitude: location.latitude,
      longitude: location.longitude,
      imageUrl: capturedPhoto || '/pothole-demo.svg',
    }

    const duplicateCheck = checkDuplicateComplaint(issueDraft as any, complaints)
    const detectedDefects = detectRoadDefects(`${textToAnalyze} ${result.summary}`)
    const imageSource = detectImageSource(capturedPhoto)
    const isDuplicateImage = detectDuplicateImage(capturedPhoto || issueDraft.imageUrl, complaints)
    const issueVisible = detectedDefects.length > 0 || Boolean(issueDraft.imageUrl)
    const sceneMatch = Boolean(location.address && location.latitude && location.longitude)
    const qualityOk = Boolean(capturedPhoto) && capturedPhoto.length > 15000
    const authenticityProfile = getAuthenticityScore({
      source: imageSource,
      isDuplicateImage,
      detectedDefects,
      sceneMatch,
      qualityOk,
      gpsMatch: Boolean(location.latitude && location.longitude),
      issueVisible,
    })

    setCameraEvidence((prev) => ({
      ...prev,
      source: imageSource,
      capturedAt: new Date().toISOString(),
      duplicateDetected: isDuplicateImage || duplicateCheck.isDuplicate,
      issueVisible,
      sceneMatch,
      qualityOk,
      gpsMatch: Boolean(location.latitude && location.longitude),
    }))

    setAnalysis({
      ...result,
      imageSource,
      detectedDefects,
      duplicateImage: isDuplicateImage,
      authenticityVerdict: authenticityProfile.verdict,
      authenticityScore: authenticityProfile.score,
    })
    setDraft(issueDraft)
    setDuplicateResult(duplicateCheck)
    setIsAnalyzing(false)
  }

  const submitComplaint = async () => {
    if (!draft) return
    const complaint = await createComplaint({
      citizenId: currentUser.id,
      title: draft.title,
      description: draft.description,
      category: draft.category,
      severity: draft.severity as any,
      departmentId: 'dept-road',
      latitude: draft.latitude,
      longitude: draft.longitude,
      address: draft.address,
      imageUrl: draft.imageUrl,
      aiConfidence: draft.confidence,
      aiSummary: draft.summary,
      slaDeadline: new Date(Date.now() + getSlaHours(draft.severity) * 60 * 60 * 1000).toISOString(),
      duplicateCount: duplicateResult?.duplicateCount ?? 0,
    })

    setComplaints((prev) => [complaint, ...prev])
    setToast(`Complaint ${complaint.id} submitted successfully.`)
    navigate(`/citizen/complaints/${complaint.id}`)
  }

  if (reviewStep && draft) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <Card className="p-6">
          <h2 className="text-2xl font-bold text-slate-900">REPORT SUMMARY</h2>
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
            <div className="space-y-4 text-sm text-slate-700">
              <p><strong>Issue:</strong> {draft.title}</p>
              <p><strong>Description:</strong> {draft.description}</p>
              <p><strong>Severity:</strong> <SeverityBadge severity={draft.severity} /></p>
              <p><strong>Department:</strong> {draft.department}</p>
              <p><strong>Location:</strong> {draft.address}</p>
              <p><strong>Duplicate Status:</strong> {duplicateResult?.isDuplicate ? 'Similar complaint nearby' : 'No duplicate found'}</p>
            </div>
            <div>
              <img src={draft.imageUrl || '/pothole-demo.svg'} alt="Complaint evidence" className="h-56 w-full rounded-xl object-cover" />
              <div className="mt-4 h-[200px] w-full overflow-hidden rounded-xl border border-slate-200">
                <MapView points={[{ id: 'draft', title: draft.title, lat: draft.latitude, lng: draft.longitude, severity: draft.severity, status: 'SUBMITTED' }]} center={[draft.latitude, draft.longitude]} />
              </div>
            </div>
          </div>
          <div className="mt-6 flex gap-3">
            <Button onClick={submitComplaint}>SUBMIT COMPLAINT</Button>
            <Button variant="secondary" onClick={() => setReviewStep(false)}>Back</Button>
          </div>
        </Card>
      </div>
    )
  }

  const isOfficialRole = currentUser.role === 'municipal_officer' || currentUser.role === 'municipality_head'

  if (analysis && draft) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <Card className="p-6">
          <h2 className="text-2xl font-bold text-slate-900">AI ANALYSIS</h2>
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
            <div className="space-y-4 text-sm text-slate-700">
              <p><strong>Detected Issue:</strong> {draft.title}</p>
              <p><strong>Category:</strong> {draft.category}</p>
              <p><strong>Severity:</strong> <SeverityBadge severity={draft.severity} /></p>
              <p><strong>AI Confidence:</strong> {draft.confidence}%</p>
              <p><strong>Recommended Department:</strong> {draft.department}</p>
              <p><strong>Reason:</strong> {draft.summary}</p>
              <p><strong>Image Source:</strong> {analysis.imageSource}</p>
              <p><strong>Duplicate Photo:</strong> {analysis.duplicateImage ? 'Detected' : 'Not detected'}</p>
              <p><strong>Road Defects Found:</strong> {analysis.detectedDefects?.length ? analysis.detectedDefects.join(', ') : 'No clear road defect detected'}</p>
              <p><strong>Authenticity Score:</strong> {analysis.authenticityScore ?? 0}/100</p>
              <p><strong>Final Verdict:</strong> <span className="font-black uppercase text-blue-900">{analysis.authenticityVerdict}</span></p>
            </div>
            <div>
              <img src={draft.imageUrl || '/pothole-demo.svg'} alt="Evidence preview" className="h-52 w-full rounded-xl object-cover" />
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">IMAGE AUTHENTICITY CHECK</h3>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">
                {cameraEvidence.source === 'in-app-camera' ? 'CAMERA VERIFIED' : 'DEMO MODE'}
              </span>
            </div>
            <div className="grid gap-3 text-sm text-slate-700 md:grid-cols-2">
              {[
                ['Live Camera Capture', cameraEvidence.source === 'in-app-camera'],
                ['Capture Timestamp', Boolean(cameraEvidence.capturedAt)],
                ['GPS Location Match', cameraEvidence.gpsMatch],
                ['Image Tampering Detection', !cameraEvidence.tamperingDetected],
                ['Duplicate Image Detection', !cameraEvidence.duplicateDetected],
                ['Issue Visibility', cameraEvidence.issueVisible],
                ['Scene–Location Consistency', cameraEvidence.sceneMatch],
                ['Image Quality & Authenticity', cameraEvidence.qualityOk],
              ].map(([label, passed]) => (
                <div key={label as string} className={`rounded-xl border px-3 py-2 ${passed ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                  <strong>{label}</strong>
                  <div className="mt-1 text-xs font-semibold uppercase tracking-[0.12em]">{passed ? 'PASS' : 'CHECK'}</div>
                </div>
              ))}
            </div>
          </div>

          {duplicateResult?.isDuplicate ? (
            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="font-bold text-amber-800">SIMILAR ISSUE FOUND NEARBY</h3>
              <p className="mt-2 text-sm text-amber-700">Complaint: {duplicateResult.similarComplaint?.id} | Distance: {Math.round(Math.abs((duplicateResult.similarComplaint?.latitude ?? 0) - draft.latitude) * 111000)} metres | Status: {duplicateResult.similarComplaint?.status}</p>
              <p className="mt-2 text-sm font-semibold">{duplicateResult.message}</p>
              <div className="mt-4 flex gap-3">
                <Button onClick={() => setReviewStep(true)}>JOIN EXISTING COMPLAINT</Button>
                <Button variant="secondary" onClick={() => setReviewStep(true)}>CREATE NEW COMPLAINT</Button>
              </div>
            </div>
          ) : (
            <div className="mt-6 flex gap-3">
              <Button onClick={() => setReviewStep(true)}>CONTINUE TO REVIEW</Button>
              <Button variant="secondary" onClick={() => navigate('/citizen')}>BACK</Button>
            </div>
          )}
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-black text-slate-900">How would you like to report the issue?</h1>
        <Button variant="secondary" onClick={() => navigate('/citizen')}>Back</Button>
      </div>

      <div className="mb-6 flex gap-3">
        {(['camera', 'voice', 'text'] as const).map((option) => (
          <Button key={option} variant={method === option ? 'primary' : 'secondary'} onClick={() => setMethod(option)} className="capitalize">{option}</Button>
        ))}
      </div>

      {method === 'camera' && (
        <Card className="p-6">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">LIVE CAMERA PREVIEW</p>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
            {capturedPhoto ? (
              <img src={capturedPhoto} alt="Captured issue" className="h-[280px] w-full object-cover" />
            ) : (
              <video ref={videoRef} autoPlay playsInline className="h-[280px] w-full object-cover" />
            )}
          </div>
          <div className="mt-4 flex gap-3">
            <Button onClick={startCamera}>START CAMERA</Button>
            <Button variant="secondary" onClick={capturePhoto}>CAPTURE PHOTO</Button>
            {capturedPhoto && <Button variant="secondary" onClick={() => setCapturedPhoto('')}>RETAKE</Button>}
            {capturedPhoto && (
              <Button onClick={() => {
                if (isOfficialRole) {
                  analyze()
                  return
                }
                setMethod('text')
              }}>
                {isOfficialRole ? 'OPEN AI ANALYSIS' : 'USE PHOTO'}
              </Button>
            )}
            {!capturedPhoto && <Button variant="secondary" onClick={() => setCapturedPhoto('/pothole-demo.svg')}>DEMO CAMERA</Button>}
          </div>
        </Card>
      )}

      {method === 'voice' && (
        <Card className="p-6">
          <label className="mb-2 block text-sm font-semibold text-slate-700">Voice input language</label>
          <select className="mb-4 w-full rounded-xl border border-slate-200 p-3" defaultValue="en-US">
            <option value="en-US">English</option>
            <option value="ta-IN">தமிழ்</option>
            <option value="hi-IN">हिन्दी</option>
          </select>
          <label className="mb-2 block text-sm font-semibold text-slate-700">Translate to</label>
          <select value={translationLanguage} onChange={(e) => setTranslationLanguage(e.target.value as 'en' | 'ta' | 'hi' | 'te' | 'ml')} className="mb-4 w-full rounded-xl border border-slate-200 p-3">
            <option value="en">English</option>
            <option value="ta">Tamil</option>
            <option value="hi">Hindi</option>
            <option value="te">Telugu</option>
            <option value="ml">Malayalam</option>
          </select>
          <Button onClick={startVoiceRecognition}>START SPEAKING</Button>
          <p className="mt-4 text-lg font-medium text-slate-700">Listening...</p>
          <textarea value={voiceText || description} onChange={(e) => { setVoiceText(e.target.value); setDescription(e.target.value) }} className="mt-4 min-h-[140px] w-full rounded-2xl border border-slate-200 p-4" placeholder="Describe the civic issue..." />
          <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Translated Preview</p>
            <p className="mt-2 text-sm text-blue-900">{translationLanguage === 'en' ? (voiceText || description) : translateText(voiceText || description, translationLanguage)}</p>
          </div>
          <div className="mt-4 flex gap-3">
            <Button onClick={analyze}>ANALYZE REPORT</Button>
          </div>
        </Card>
      )}

      {method === 'text' && (
        <Card className="p-6">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[180px] w-full rounded-2xl border border-slate-200 p-4 text-base" placeholder="Describe the civic issue..." />
          <div className="mt-4 flex gap-3">
            <Button onClick={analyze}>ANALYZE REPORT</Button>
          </div>
        </Card>
      )}

      {isAnalyzing && <div className="mt-6"><LoadingState label="ANALYZING YOUR REPORT..." /></div>}
    </div>
  )
}

function CitizenComplaints({ complaints }: { complaints: Complaint[] }) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'ALL' | 'ACTIVE' | 'PENDING VERIFICATION' | 'RESOLVED' | 'ESCALATED'>('ALL')

  const filtered = complaints.filter((complaint) => {
    if (tab === 'ALL') return true
    if (tab === 'ACTIVE') return complaint.status !== 'RESOLVED' && complaint.status !== 'ESCALATED'
    if (tab === 'PENDING VERIFICATION') return complaint.status === 'PENDING_VERIFICATION'
    if (tab === 'RESOLVED') return complaint.status === 'RESOLVED'
    if (tab === 'ESCALATED') return complaint.status === 'ESCALATED'
    return true
  })

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-3xl font-bold text-slate-900">My Complaints</h2>
        <Button variant="secondary" onClick={() => navigate('/citizen')}>Back</Button>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {['ALL', 'ACTIVE', 'PENDING VERIFICATION', 'RESOLVED', 'ESCALATED'].map((item) => (
          <button key={item} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === item ? 'bg-blue-900 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setTab(item as any)}>{item}</button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.length > 0 ? filtered.map((complaint) => <ComplaintCard key={complaint.id} complaint={complaint} onClick={() => navigate(`/citizen/complaints/${complaint.id}`)} />) : <EmptyState title="No complaints in this tab" description="Submit a new issue or check back later." />}
      </div>
    </div>
  )
}

function ComplaintTrackingPage({ complaints, setComplaints }: { complaints: Complaint[]; setComplaints: React.Dispatch<React.SetStateAction<Complaint[]>> }) {
  const navigate = useNavigate()
  const { id } = useParams()
  const complaint = complaints.find((item) => item.id === id)
  const [confirmation, setConfirmation] = useState<'yes' | 'no' | null>(null)

  if (!complaint) return <LoadingState label="Loading complaint..." />

  const handleCitizenVerification = async (answer: 'yes' | 'no') => {
    const updated = await updateComplaint(complaint.id, {
      status: answer === 'yes' ? 'RESOLVED' : 'REOPENED',
      verification: { status: answer === 'yes' ? 'verified' : 'needs_review', confidence: answer === 'yes' ? 91 : 58, reason: answer === 'yes' ? 'Citizen confirmed issue has been fixed.' : 'Citizen reported issue is still unresolved.' },
    })
    if (updated) {
      setComplaints((items) => items.map((item) => (item.id === complaint.id ? { ...item, ...updated } : item)))
    }
    setConfirmation(answer)
  }

  const isVerificationPending = complaint.status === 'PENDING_VERIFICATION' || complaint.verification?.status === 'needs_review'

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Complaint #{complaint.id}</p>
          <h2 className="text-3xl font-black text-slate-900">{complaint.title}</h2>
        </div>
        <Button variant="secondary" onClick={() => navigate('/citizen')}>Back</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <SeverityBadge severity={complaint.severity} />
            <StatusBadge status={complaint.status} />
          </div>
          <p className="text-slate-600">{complaint.address}</p>
          <p className="mt-3 text-sm text-slate-700">{complaint.description}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-3"><span className="text-xs uppercase tracking-[0.2em] text-slate-500">Assigned Department</span><p className="mt-1 font-semibold">{complaint.departmentId}</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><span className="text-xs uppercase tracking-[0.2em] text-slate-500">Assigned Officer</span><p className="mt-1 font-semibold">{complaint.officerId || 'Unassigned'}</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><span className="text-xs uppercase tracking-[0.2em] text-slate-500">SLA Deadline</span><p className="mt-1 font-semibold">{new Date(complaint.slaDeadline).toLocaleString()}</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><span className="text-xs uppercase tracking-[0.2em] text-slate-500">Current Status</span><p className="mt-1 font-semibold">{complaint.status}</p></div>
          </div>

          <div className="mt-6"><h3 className="mb-3 text-lg font-bold">Timeline</h3><Timeline items={complaint.timeline} /></div>
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-bold">Evidence</h3>
          <img src={complaint.imageUrl || '/pothole-demo.svg'} alt="Issue evidence" className="mt-4 h-52 w-full rounded-xl object-cover" />
          {complaint.resolutionImageUrl && <img src={complaint.resolutionImageUrl} alt="Resolution evidence" className="mt-4 h-40 w-full rounded-xl object-cover" />}

          {isVerificationPending && (
            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <h4 className="font-bold text-amber-800">Your complaint has been marked as resolved.</h4>
              <p className="mt-2 text-sm text-amber-700">HAS THE ISSUE ACTUALLY BEEN FIXED?</p>
              <div className="mt-4 flex gap-3">
                <Button onClick={() => handleCitizenVerification('yes')}>YES, ISSUE FIXED</Button>
                <Button variant="danger" onClick={() => handleCitizenVerification('no')}>NO, ISSUE STILL EXISTS</Button>
              </div>
            </div>
          )}

          {confirmation && (
            <div className="mt-6 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
              {confirmation === 'yes' ? 'Thank you. Your complaint has been successfully resolved.' : 'Complaint reopened and returned to the department.'}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function CitizenNearbyMap({ complaints }: { complaints: Complaint[] }) {
  const nearby = useMemo(() => getNearbyIssues(complaints.map((item) => ({ latitude: item.latitude, longitude: item.longitude, title: item.title, severity: item.severity, status: item.status })), 13.0875, 80.2096), [complaints])

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h2 className="mb-4 text-3xl font-bold text-slate-900">Nearby Issues</h2>
      <MapView points={nearby.map((item) => ({ id: item.title, title: item.title, lat: item.latitude, lng: item.longitude, severity: item.severity, status: item.status }))} />
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {nearby.map((issue) => (
          <Card key={`${issue.title}-${issue.distance}`}>
            <div className="flex items-center justify-between"><h3>{issue.title}</h3><SeverityBadge severity={issue.severity} /></div>
            <p className="mt-2 text-sm text-slate-600">{issue.distance}m</p>
            <p className="mt-1 text-sm text-slate-500">{issue.status}</p>
          </Card>
        ))}
      </div>
    </div>
  )
}

function OfficerDashboard({ complaints }: { complaints: Complaint[] }) {
  const navigate = useNavigate()
  const stats = useMemo(() => ({
    critical: complaints.filter((item) => item.severity === 'CRITICAL').length,
    high: complaints.filter((item) => item.severity === 'HIGH').length,
    medium: complaints.filter((item) => item.severity === 'MEDIUM').length,
    low: complaints.filter((item) => item.severity === 'LOW').length,
    overdue: complaints.filter((item) => new Date(item.slaDeadline) < new Date() && item.status !== 'RESOLVED').length,
  }), [complaints])

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <aside className="mb-6 flex gap-2 overflow-x-auto">
        {['Dashboard', 'Complaint Queue', 'Map', 'Escalated', 'Resolved', 'Analytics', 'Profile'].map((item) => (
          <button key={item} onClick={() => navigate(item === 'Dashboard' ? '/officer' : item === 'Complaint Queue' ? '/officer/complaints' : item === 'Map' ? '/officer/map' : item === 'Escalated' ? '/officer/escalated' : item === 'Resolved' ? '/officer/resolved' : item === 'Analytics' ? '/officer/analytics' : '/profile')} className="rounded-full bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">{item}</button>
        ))}
      </aside>

      <div className="mb-6 grid gap-4 md:grid-cols-5">
        <StatsCard label="CRITICAL" value={String(stats.critical)} tone="red" />
        <StatsCard label="HIGH" value={String(stats.high)} tone="amber" />
        <StatsCard label="MEDIUM" value={String(stats.medium)} tone="blue" />
        <StatsCard label="LOW" value={String(stats.low)} tone="green" />
        <StatsCard label="OVERDUE" value={String(stats.overdue)} tone="red" />
      </div>

      <ComplaintTable complaints={complaints.slice(0, 6)} onSelect={(complaint) => navigate(`/officer/complaints/${complaint.id}`)} />
    </div>
  )
}

function OfficerComplaintQueue({ complaints }: { complaints: Complaint[] }) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const filtered = complaints.filter((complaint) => complaint.title.toLowerCase().includes(search.toLowerCase()) || complaint.id.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-3xl font-bold text-slate-900">Complaint Queue</h2>
        <input value={search} onChange={(e) => setSearch(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2" placeholder="Search complaints" />
      </div>
      <ComplaintTable complaints={filtered} onSelect={(complaint) => navigate(`/officer/complaints/${complaint.id}`)} />
    </div>
  )
}

function OfficerComplaintDetail({ complaints, setComplaints }: { complaints: Complaint[]; setComplaints: React.Dispatch<React.SetStateAction<Complaint[]>> }) {
  const navigate = useNavigate()
  const { id } = useParams()
  const complaint = complaints.find((item) => item.id === id)
  const [resolutionImage, setResolutionImage] = useState<string>('/after-demo.svg')

  if (!complaint) return <LoadingState label="Loading officer detail..." />

  const updateStatus = async (status: Complaint['status']) => {
    const updated = await updateComplaint(complaint.id, { status, timeline: [...complaint.timeline, { id: `timeline-${Date.now()}`, complaintId: complaint.id, status, actor: 'Officer Console', timestamp: new Date().toISOString(), description: `${status} updated by officer.` }] })
    if (updated) {
      setComplaints((items) => items.map((item) => (item.id === complaint.id ? { ...item, ...updated } : item)))
    }
  }

  const handleResolved = async () => {
    const updated = await updateComplaint(complaint.id, {
      status: 'PENDING_VERIFICATION',
      resolutionImageUrl: resolutionImage,
      verification: { status: 'needs_review', confidence: 89, reason: 'AI resolution verification pending citizen confirmation.' },
    })
    if (updated) {
      setComplaints((items) => items.map((item) => (item.id === complaint.id ? { ...item, ...updated } : item)))
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-3xl font-bold">Complaint #{complaint.id}</h2>
        <Button variant="secondary" onClick={() => navigate('/officer')}>Back</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Issue</p><p className="mt-1 font-semibold">{complaint.title}</p></div>
            <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Department</p><p className="mt-1 font-semibold">{complaint.departmentId}</p></div>
            <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">AI Category</p><p className="mt-1">{complaint.category}</p></div>
            <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">AI Severity</p><p className="mt-1"><SeverityBadge severity={complaint.severity} /></p></div>
            <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">AI Confidence</p><p className="mt-1">{complaint.aiConfidence}%</p></div>
            <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">SLA Deadline</p><p className="mt-1">{new Date(complaint.slaDeadline).toLocaleString()}</p></div>
          </div>
          <p className="mt-4 text-sm text-slate-600">{complaint.description}</p>
          <div className="mt-6 h-[220px] overflow-hidden rounded-2xl border border-slate-200">
            <MapView points={[{ id: complaint.id, title: complaint.title, lat: complaint.latitude, lng: complaint.longitude, severity: complaint.severity, status: complaint.status }]} center={[complaint.latitude, complaint.longitude]} />
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={() => updateStatus('ASSIGNED')}>ACCEPT COMPLAINT</Button>
            <Button variant="secondary" onClick={() => updateStatus('ASSIGNED')}>ASSIGN OFFICER</Button>
            <Button variant="secondary" onClick={() => updateStatus('IN_PROGRESS')}>START WORK</Button>
            <Button variant="secondary" onClick={() => updateStatus('ASSIGNED')}>REQUEST MORE INFORMATION</Button>
            <Button variant="success" onClick={handleResolved}>MARK AS RESOLVED</Button>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="text-xl font-bold">Resolution Evidence</h3>
          <img src={complaint.imageUrl || '/pothole-demo.svg'} alt="Before" className="mt-4 h-40 w-full rounded-xl object-cover" />
          <img src={resolutionImage} alt="After" className="mt-4 h-40 w-full rounded-xl object-cover" />
          <div className="mt-4 flex gap-3">
            <Button variant="secondary" onClick={() => setResolutionImage('/after-demo.svg')}>DEMO RESOLUTION PHOTO</Button>
          </div>
          <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
            <p className="font-bold">AI RESOLUTION VERIFICATION</p>
            <p className="mt-2">Original Issue: {complaint.title}</p>
            <p>Location Consistency: Verified</p>
            <p>Visual Improvement: Detected</p>
            <p>Resolution Confidence: 89%</p>
            <p>Recommendation: Send to citizen for confirmation.</p>
          </div>
        </Card>
      </div>
    </div>
  )
}

function OfficerMap({ complaints }: { complaints: Complaint[] }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h2 className="mb-4 text-3xl font-bold text-slate-900">Map</h2>
      <MapView points={complaints.map((item) => ({ id: item.id, title: item.title, lat: item.latitude, lng: item.longitude, severity: item.severity, status: item.status }))} />
    </div>
  )
}

function EscalatedQueue({ complaints }: { complaints: Complaint[] }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h2 className="mb-4 text-3xl font-bold text-slate-900">Escalated</h2>
      <ComplaintTable complaints={complaints.filter((item) => item.status === 'ESCALATED')} onSelect={() => undefined} />
    </div>
  )
}

function ResolvedQueue({ complaints }: { complaints: Complaint[] }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h2 className="mb-4 text-3xl font-bold text-slate-900">Resolved</h2>
      <ComplaintTable complaints={complaints.filter((item) => item.status === 'RESOLVED')} onSelect={() => undefined} />
    </div>
  )
}

function AdminDashboard({ complaints }: { complaints: Complaint[] }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 grid gap-4 md:grid-cols-6">
        <StatsCard label="TOTAL" value={String(complaints.length)} tone="blue" />
        <StatsCard label="RESOLVED" value={String(complaints.filter((item) => item.status === 'RESOLVED').length)} tone="green" />
        <StatsCard label="IN PROGRESS" value={String(complaints.filter((item) => item.status === 'IN_PROGRESS' || item.status === 'ASSIGNED').length)} tone="amber" />
        <StatsCard label="ESCALATED" value={String(complaints.filter((item) => item.status === 'ESCALATED').length)} tone="red" />
        <StatsCard label="DUPLICATE" value={String(complaints.filter((item) => item.duplicateCount > 0).length)} tone="amber" />
        <StatsCard label="CRITICAL" value={String(complaints.filter((item) => item.severity === 'CRITICAL').length)} tone="red" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 text-lg font-bold">Complaints by Department</h3>
          <div className="space-y-3">
            {departments.slice(0, 5).map((department) => {
              const count = complaints.filter((item) => item.departmentId === department.id).length
              return <div key={department.id}><div className="mb-1 flex justify-between text-sm"><span>{department.name}</span><span>{count}</span></div><div className="h-2 rounded-full bg-slate-200"><div className="h-2 rounded-full bg-blue-700" style={{ width: `${Math.min(count * 20, 100)}%` }} /></div></div>
            })}
          </div>
        </Card>

        <Card>
          <h3 className="mb-4 text-lg font-bold">Complaints by Category</h3>
          <div className="space-y-3">
            {['Road / Pothole', 'Garbage / Sanitation', 'Water Supply', 'Drainage / Flooding', 'Street Lighting'].map((category) => {
              const count = complaints.filter((item) => item.category === category).length
              return <div key={category}><div className="mb-1 flex justify-between text-sm"><span>{category}</span><span>{count}</span></div><div className="h-2 rounded-full bg-slate-200"><div className="h-2 rounded-full bg-emerald-600" style={{ width: `${Math.min(count * 25, 100)}%` }} /></div></div>
            })}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <h3 className="mb-4 text-lg font-bold">Department Workload</h3>
          <div className="space-y-4">
            {departments.map((department) => {
              const assigned = complaints.filter((item) => item.departmentId === department.id).length
              return (
                <div key={department.id} className="rounded-xl bg-slate-50 p-3">
                  <div className="flex items-center justify-between"><strong>{department.name}</strong><span>{assigned}</span></div>
                  <div className="mt-2 flex justify-between text-xs text-slate-500"><span>Assigned: {assigned}</span><span>Pending: {Math.max(0, assigned - 2)}</span><span>Resolved: {Math.max(0, assigned - 1)}</span></div>
                </div>
              )
            })}
          </div>
        </Card>

        <Card>
          <h3 className="mb-4 text-lg font-bold">Escalations</h3>
          <div className="space-y-3">
            {complaints.filter((item) => item.status === 'ESCALATED').map((item) => (
              <div key={item.id} className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{item.id} | {item.title} | <strong>{item.severity}</strong></div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

function AdminComplaintList({ complaints }: { complaints: Complaint[] }) {
  return <div className="mx-auto max-w-6xl px-4 py-8"><ComplaintTable complaints={complaints} onSelect={() => undefined} /></div>
}

function AdminMap({ complaints }: { complaints: Complaint[] }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h2 className="mb-4 text-3xl font-bold text-slate-900">Admin Map</h2>
      <MapView points={complaints.map((item) => ({ id: item.id, title: `${item.id} ${item.title}`, lat: item.latitude, lng: item.longitude, severity: item.severity, status: item.status }))} />
    </div>
  )
}

function AnalyticsConsole({ complaints, role }: { complaints: Complaint[]; role: string }) {
  const [selectedId, setSelectedId] = useState(complaints[0]?.id ?? '')
  const selectedComplaint = complaints.find((item) => item.id === selectedId) ?? complaints[0]
  const languages = ['en', 'ta', 'hi', 'te', 'ml'] as const

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">{role} Console</p>
          <h2 className="mt-2 text-3xl font-black text-slate-900">Analytics</h2>
        </div>
        <Button variant="secondary" onClick={() => window.history.back()}>Back</Button>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <StatsCard label="Total Complaints" value={String(complaints.length)} tone="blue" />
        <StatsCard label="Escalations" value={String(complaints.filter((item) => item.status === 'ESCALATED').length)} tone="red" />
        <StatsCard label="Duplicates" value={String(complaints.filter((item) => item.duplicateCount > 0).length)} tone="amber" />
        <StatsCard label="Critical" value={String(complaints.filter((item) => item.severity === 'CRITICAL').length)} tone="red" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <Card className="p-4">
          <h3 className="mb-4 text-lg font-bold text-slate-900">Complaint Feed</h3>
          <div className="space-y-3">
            {complaints.map((complaint) => (
              <button key={complaint.id} type="button" onClick={() => setSelectedId(complaint.id)} className={`w-full rounded-2xl border p-3 text-left ${selectedComplaint?.id === complaint.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800">{complaint.id}</span>
                  <SeverityBadge severity={complaint.severity} />
                </div>
                <p className="mt-2 text-sm text-slate-700">{complaint.title}</p>
                <p className="mt-1 text-xs text-slate-500">{complaint.status}</p>
              </button>
            ))}
          </div>
        </Card>

        {selectedComplaint && (
          <Card className="p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Complaint ID</p>
                <h3 className="mt-1 text-2xl font-bold text-slate-900">{selectedComplaint.id}</h3>
              </div>
              <SeverityBadge severity={selectedComplaint.severity} />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Voice to text</p>
                  <p className="mt-2 text-sm text-slate-700">{selectedComplaint.description}</p>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Text Translation</p>
                  <div className="mt-3 grid gap-3">
                    {languages.map((lang) => (
                      <div key={lang} className="rounded-xl border border-slate-200 bg-white p-2">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{lang}</p>
                        <p className="mt-1 text-sm text-slate-700">{translateText(selectedComplaint.description, lang)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Evidence</p>
                  <img src={selectedComplaint.imageUrl || '/pothole-demo.svg'} alt="Complaint evidence" className="mt-3 h-56 w-full rounded-xl object-cover" />
                </div>

                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Image Authenticity Analysis</p>
                  <div className="mt-3 grid gap-2">
                    {analyzeImageAuthenticity(selectedComplaint, complaints).criteria.map((check) => (
                      <div key={check.label} className={`rounded-xl border px-3 py-2 text-sm ${check.passed ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                        <div className="flex items-center justify-between gap-3">
                          <span>{check.label}</span>
                          <span className="font-bold uppercase">{check.passed ? 'PASS' : 'FAIL'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-center text-lg font-black text-blue-900">
                    {analyzeImageAuthenticity(selectedComplaint, complaints).finalResult}
                  </div>
                  <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
                    <p><strong>Image Source:</strong> {analyzeImageAuthenticity(selectedComplaint, complaints).source}</p>
                    <p><strong>Duplicate Photo:</strong> {analyzeImageAuthenticity(selectedComplaint, complaints).duplicateImage ? 'Yes' : 'No'}</p>
                    <p><strong>Detected Defects:</strong> {analyzeImageAuthenticity(selectedComplaint, complaints).defects.length ? analyzeImageAuthenticity(selectedComplaint, complaints).defects.join(', ') : 'No clear defect detected'}</p>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

function ProfilePage({ currentUser, onUpdateProfile }: { currentUser: User; onUpdateProfile: (user: User) => void }) {
  const navigate = useNavigate()
  const [section, setSection] = useState<'overview' | 'edit' | 'account'>('overview')
  const [profile, setProfile] = useState<StoredUser>({ ...currentUser, username: '', email: '', mobileNumber: '', state: '', district: '', localBody: '', ward: '', preferredLanguage: currentUser.language, location: currentUser.location })
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [message, setMessage] = useState('')

  useEffect(() => {
    const storedAccount = loadStoredUsers().find((user) => user.id === currentUser.id)
    const merged: StoredUser = {
      ...currentUser,
      username: storedAccount?.username ?? '',
      password: storedAccount?.password ?? '',
      mobileNumber: storedAccount?.mobileNumber ?? '',
      email: storedAccount?.email ?? '',
      preferredLanguage: storedAccount?.preferredLanguage ?? currentUser.language,
      state: storedAccount?.state ?? '',
      district: storedAccount?.district ?? '',
      localBody: storedAccount?.localBody ?? '',
      ward: storedAccount?.ward ?? '',
      officialEmail: storedAccount?.officialEmail ?? '',
      officialMobile: storedAccount?.officialMobile ?? '',
      staffId: storedAccount?.staffId ?? '',
      employeeId: storedAccount?.employeeId ?? '',
      department: storedAccount?.department ?? '',
      designation: storedAccount?.designation ?? '',
      roleLevel: storedAccount?.roleLevel ?? '',
      adminRole: storedAccount?.adminRole ?? '',
      twoFactor: storedAccount?.twoFactor ?? true,
      location: storedAccount?.location ?? currentUser.location,
    }
    setProfile(merged)
  }, [currentUser])

  const saveProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const storedUsers = loadStoredUsers()
    const updatedUser: StoredUser = {
      ...profile,
      id: currentUser.id,
      role: currentUser.role,
      name: profile.name.trim() || currentUser.name,
      language: profile.preferredLanguage ?? currentUser.language,
      location: profile.location?.trim() || currentUser.location,
    }

    const nextUsers = storedUsers.map((user) => (user.id === currentUser.id ? updatedUser : user))
    saveStoredUsers(nextUsers)

    const user: User = {
      id: updatedUser.id,
      name: updatedUser.name,
      role: updatedUser.role,
      language: updatedUser.language,
      location: updatedUser.location,
    }

    onUpdateProfile(user)
    setMessage('Profile updated successfully.')
    setSection('overview')
  }

  const changePassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const storedUsers = loadStoredUsers()
    const currentAccount = storedUsers.find((user) => user.id === currentUser.id)

    if (!currentAccount || currentAccount.password !== passwordForm.currentPassword) {
      setMessage('Current password is incorrect.')
      return
    }

    if (!passwordForm.newPassword || passwordForm.newPassword.length < 6) {
      setMessage('New password must be at least 6 characters long.')
      return
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setMessage('New password and confirm password do not match.')
      return
    }

    const nextUsers = storedUsers.map((user) =>
      user.id === currentUser.id ? { ...user, password: passwordForm.newPassword } : user,
    )
    saveStoredUsers(nextUsers)
    setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    setMessage('Password changed successfully.')
    setSection('account')
  }

  const isOfficerOrHead = currentUser.role !== 'citizen'

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">Account Center</p>
          <h2 className="mt-2 text-3xl font-black text-slate-900">Profile & Settings</h2>
        </div>
        <Button variant="secondary" onClick={() => navigate(getDashboardPath(currentUser.role))}>Back to Dashboard</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="rounded-3xl bg-slate-900 p-4 text-white shadow-lg">
          <div className="mb-4 rounded-2xl bg-slate-800 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Signed in as</p>
            <p className="mt-2 text-lg font-bold">{currentUser.name}</p>
            <p className="text-sm text-slate-300">{getRoleLabel(currentUser.role)}</p>
          </div>
          <nav className="space-y-2">
            <button type="button" onClick={() => setSection('overview')} className={`w-full rounded-2xl px-4 py-3 text-left font-semibold ${section === 'overview' ? 'bg-blue-700 text-white' : 'bg-slate-800 text-slate-200'}`}>Overview</button>
            <button type="button" onClick={() => setSection('edit')} className={`w-full rounded-2xl px-4 py-3 text-left font-semibold ${section === 'edit' ? 'bg-blue-700 text-white' : 'bg-slate-800 text-slate-200'}`}>Edit Profile</button>
            <button type="button" onClick={() => setSection('account')} className={`w-full rounded-2xl px-4 py-3 text-left font-semibold ${section === 'account' ? 'bg-blue-700 text-white' : 'bg-slate-800 text-slate-200'}`}>Account Center</button>
          </nav>
        </aside>

        <div className="space-y-6">
          {message && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}

          {section === 'overview' && (
            <Card className="p-6">
              <h3 className="text-2xl font-bold text-slate-900">Personal Details</h3>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Username</p><p className="mt-2 font-semibold text-slate-800">{profile.username || 'Not set'}</p></div>
                <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Full Name</p><p className="mt-2 font-semibold text-slate-800">{profile.name}</p></div>
                <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Mobile Number</p><p className="mt-2 font-semibold text-slate-800">{profile.mobileNumber || 'Not provided'}</p></div>
                <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Email</p><p className="mt-2 font-semibold text-slate-800">{profile.email || 'Not provided'}</p></div>
                <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Location</p><p className="mt-2 font-semibold text-slate-800">{profile.location || 'Not provided'}</p></div>
                <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">State</p><p className="mt-2 font-semibold text-slate-800">{profile.state || 'Not provided'}</p></div>
                <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">District</p><p className="mt-2 font-semibold text-slate-800">{profile.district || 'Not provided'}</p></div>
                <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Ward</p><p className="mt-2 font-semibold text-slate-800">{profile.ward || 'Not provided'}</p></div>
                {isOfficerOrHead && (
                  <>
                    <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Official Email</p><p className="mt-2 font-semibold text-slate-800">{profile.officialEmail || 'Not provided'}</p></div>
                    <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Designation</p><p className="mt-2 font-semibold text-slate-800">{profile.designation || 'Not provided'}</p></div>
                    <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Department</p><p className="mt-2 font-semibold text-slate-800">{profile.department || 'Not provided'}</p></div>
                  </>
                )}
              </div>
            </Card>
          )}

          {section === 'edit' && (
            <form onSubmit={saveProfile} className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="mb-6 flex items-center justify-between">
                <h3 className="text-2xl font-bold text-slate-900">Edit Profile</h3>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Editable details</span>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">Username<input value={profile.username ?? ''} onChange={(e) => setProfile((prev) => ({ ...prev, username: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
                <label className="text-sm font-medium text-slate-700">Full Name<input value={profile.name} onChange={(e) => setProfile((prev) => ({ ...prev, name: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
                <label className="text-sm font-medium text-slate-700">Mobile Number<input value={profile.mobileNumber ?? ''} onChange={(e) => setProfile((prev) => ({ ...prev, mobileNumber: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
                <label className="text-sm font-medium text-slate-700">Email ID<input value={profile.email ?? ''} onChange={(e) => setProfile((prev) => ({ ...prev, email: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
                <label className="text-sm font-medium text-slate-700">Preferred Language<select value={profile.preferredLanguage ?? currentUser.language} onChange={(e) => setProfile((prev) => ({ ...prev, preferredLanguage: e.target.value as 'en' | 'ta' | 'hi' }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><option value="en">English</option><option value="ta">Tamil</option><option value="hi">Hindi</option></select></label>
                <label className="text-sm font-medium text-slate-700">Location<input value={profile.location ?? ''} onChange={(e) => setProfile((prev) => ({ ...prev, location: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
                <label className="text-sm font-medium text-slate-700">State<input value={profile.state ?? ''} onChange={(e) => setProfile((prev) => ({ ...prev, state: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
                <label className="text-sm font-medium text-slate-700">District<input value={profile.district ?? ''} onChange={(e) => setProfile((prev) => ({ ...prev, district: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
                <label className="text-sm font-medium text-slate-700">Local Body / Municipality<input value={profile.localBody ?? ''} onChange={(e) => setProfile((prev) => ({ ...prev, localBody: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
                <label className="text-sm font-medium text-slate-700">Ward<input value={profile.ward ?? ''} onChange={(e) => setProfile((prev) => ({ ...prev, ward: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
                {isOfficerOrHead && (
                  <>
                    <label className="text-sm font-medium text-slate-700">Official Email<input value={profile.officialEmail ?? ''} onChange={(e) => setProfile((prev) => ({ ...prev, officialEmail: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
                    <label className="text-sm font-medium text-slate-700">Official Mobile Number<input value={profile.officialMobile ?? ''} onChange={(e) => setProfile((prev) => ({ ...prev, officialMobile: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
                    <label className="text-sm font-medium text-slate-700">Department<input value={profile.department ?? ''} onChange={(e) => setProfile((prev) => ({ ...prev, department: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
                    <label className="text-sm font-medium text-slate-700">Designation<input value={profile.designation ?? ''} onChange={(e) => setProfile((prev) => ({ ...prev, designation: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
                    <label className="text-sm font-medium text-slate-700">Staff ID<input value={profile.staffId ?? ''} onChange={(e) => setProfile((prev) => ({ ...prev, staffId: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
                    <label className="text-sm font-medium text-slate-700">Employee ID<input value={profile.employeeId ?? ''} onChange={(e) => setProfile((prev) => ({ ...prev, employeeId: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" /></label>
                  </>
                )}
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <Button type="button" variant="secondary" onClick={() => setSection('overview')}>Cancel</Button>
                <Button type="submit">Save Changes</Button>
              </div>
            </form>
          )}

          {section === 'account' && (
            <Card className="p-6">
              <h3 className="text-2xl font-bold text-slate-900">Account Center</h3>
              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-lg font-semibold text-slate-800">Change Password</p>
                <form onSubmit={changePassword} className="mt-4 grid gap-4">
                  <label className="text-sm font-medium text-slate-700">Current Password<input type="password" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2" /></label>
                  <label className="text-sm font-medium text-slate-700">New Password<input type="password" value={passwordForm.newPassword} onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2" /></label>
                  <label className="text-sm font-medium text-slate-700">Confirm New Password<input type="password" value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2" /></label>
                  <div className="flex justify-end">
                    <Button type="submit">Update Password</Button>
                  </div>
                </form>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
