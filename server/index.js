import express from 'express'
import cors from 'cors'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const app = express()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dbPath = path.join(__dirname, '..', 'data', 'civic_connect.json')

app.use(cors())
app.use(express.json({ limit: '10mb' }))

async function readDatabase() {
  const raw = await fs.readFile(dbPath, 'utf8')
  return JSON.parse(raw)
}

async function writeDatabase(data) {
  await fs.writeFile(dbPath, JSON.stringify(data, null, 2))
}

app.get('/api/complaints', async (_req, res) => {
  const db = await readDatabase()
  res.json(db.complaints)
})

app.get('/api/complaints/:id', async (req, res) => {
  const db = await readDatabase()
  const complaint = db.complaints.find((item) => item.id === req.params.id)
  if (!complaint) return res.status(404).json({ message: 'Complaint not found' })
  return res.json(complaint)
})

app.post('/api/complaints', async (req, res) => {
  const db = await readDatabase()
  const complaint = req.body
  db.complaints.unshift(complaint)
  await writeDatabase(db)
  res.status(201).json(complaint)
})

app.patch('/api/complaints/:id', async (req, res) => {
  const db = await readDatabase()
  const index = db.complaints.findIndex((item) => item.id === req.params.id)
  if (index === -1) return res.status(404).json({ message: 'Complaint not found' })
  db.complaints[index] = { ...db.complaints[index], ...req.body, updatedAt: new Date().toISOString() }
  await writeDatabase(db)
  res.json(db.complaints[index])
})

app.post('/api/analyze', async (req, res) => {
  const text = String(req.body.text || '')
  const lower = text.toLowerCase()
  let category = 'Other'
  let severity = 'MEDIUM'
  let summary = 'Civic issue reported for review and inspection.'

  if (/(pothole|broken road|road damage|road crack)/.test(lower)) {
    category = 'Road / Pothole'
    severity = 'HIGH'
    summary = 'Large road surface damage detected from the complaint.'
  } else if (/(garbage|trash|waste|dump|litter)/.test(lower)) {
    category = 'Garbage / Sanitation'
    severity = 'MEDIUM'
    summary = 'Garbage accumulation reported near public space.'
  } else if (/(water leak|water leakage|no water|pipe burst|water pipe)/.test(lower)) {
    category = 'Water Supply'
    severity = 'HIGH'
    summary = 'Water service disruption or pipeline leak detected.'
  } else if (/(street light|broken light|lamp|dark road)/.test(lower)) {
    category = 'Street Lighting'
    severity = 'MEDIUM'
    summary = 'Street lighting issue affecting visibility and safety.'
  } else if (/(flood|flooding|water logging|drainage|blocked drain)/.test(lower)) {
    category = 'Drainage / Flooding'
    severity = 'CRITICAL'
    summary = 'Flooding or drainage blockage detected requiring urgent response.'
  }

  res.json({
    category,
    severity,
    confidence: category === 'Other' ? 71 : 94,
    summary,
    department: category === 'Road / Pothole' ? 'Roads & Infrastructure' : category === 'Garbage / Sanitation' ? 'Sanitation Department' : category === 'Water Supply' ? 'Water Supply Department' : category === 'Street Lighting' ? 'Electrical / Street Lighting' : 'Drainage / Disaster Response',
    duplicateCandidates: [],
  })
})

app.post('/api/duplicate-check', async (req, res) => {
  const db = await readDatabase()
  const complaint = req.body
  const query = `${complaint.category ?? ''} ${complaint.description ?? ''}`.toLowerCase()
  const similar = db.complaints.filter((item) => {
    const near = Math.abs(item.latitude - (complaint.latitude ?? 0)) < 0.002 && Math.abs(item.longitude - (complaint.longitude ?? 0)) < 0.002
    const sameCategory = item.category === complaint.category
    const textMatch = item.description.toLowerCase().includes(query) || query.includes(item.description.toLowerCase())
    return sameCategory && (textMatch || near)
  })

  if (similar.length === 0) return res.json({ isDuplicate: false, duplicateCount: 0, message: 'No duplicate found' })
  return res.json({ isDuplicate: true, similarComplaint: similar[0], duplicateCount: similar.length + 1, message: `${similar.length + 1} citizens have reported similar issues in this area.` })
})

app.post('/api/verify-resolution', async (_req, res) => {
  res.json({ status: 'verified', confidence: 89, reason: 'Location consistency and visual improvement were detected in the provided evidence.' })
})

app.post('/api/escalate', async (req, res) => {
  const db = await readDatabase()
  const complaint = db.complaints.find((item) => item.id === req.body.id)
  if (!complaint) return res.status(404).json({ message: 'Complaint not found' })
  complaint.status = 'ESCALATED'
  complaint.updatedAt = new Date().toISOString()
  complaint.timeline.push({
    id: `timeline-${Date.now()}`,
    complaintId: complaint.id,
    status: 'Escalated',
    actor: 'SLA Monitor',
    timestamp: new Date().toISOString(),
    description: 'Complaint automatically escalated due to delayed response.',
  })
  await writeDatabase(db)
  res.json(complaint)
})

app.listen(3001, () => {
  console.log('Civic Sync mock API running on http://localhost:3001')
})
