import type { AIAnalysis, Severity } from '../types'

const departmentMap: Record<string, string> = {
  'Road / Pothole': 'Roads & Infrastructure',
  'Garbage / Sanitation': 'Sanitation Department',
  'Water Supply': 'Water Supply Department',
  'Street Lighting': 'Electrical / Street Lighting',
  'Drainage / Flooding': 'Drainage / Disaster Response',
  'Traffic / Road Safety': 'Traffic / Road Safety',
  'Public Infrastructure': 'Municipal Infrastructure',
  'Disaster / Emergency': 'Disaster Response + Emergency',
}

export function analyzeComplaintText(text: string): AIAnalysis {
  const lower = text.toLowerCase()

  let category = 'Other'
  let severity: Severity = 'MEDIUM'
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
  } else if (/(street light|broken light|lamp|dark road|electric pole)/.test(lower)) {
    category = 'Street Lighting'
    severity = 'MEDIUM'
    summary = 'Street lighting issue affecting visibility and safety.'
  } else if (/(flood|flooding|water logging|drainage|blocked drain)/.test(lower)) {
    category = 'Drainage / Flooding'
    severity = 'CRITICAL'
    summary = 'Flooding or drainage blockage detected requiring urgent response.'
  } else if (/(accident|dangerous|collapsed|fire|exposed wire|severe flooding)/.test(lower)) {
    category = 'Disaster / Emergency'
    severity = 'CRITICAL'
    summary = 'High-risk emergency condition requiring immediate escalation.'
  } else if (/(traffic|signal|road safety|unsafe)/.test(lower)) {
    category = 'Traffic / Road Safety'
    severity = 'HIGH'
    summary = 'Traffic risk detected at the reported location.'
  } else if (/(bridge|public wall|park|bench|infrastructure)/.test(lower)) {
    category = 'Public Infrastructure'
    severity = 'MEDIUM'
    summary = 'Public infrastructure concern reported for maintenance.'
  }

  const confidence = category === 'Other' ? 71 : 90 + (severity === 'CRITICAL' ? 4 : severity === 'HIGH' ? 3 : 1)
  const department = departmentMap[category] ?? 'Municipal Infrastructure'

  return {
    category,
    severity,
    confidence: Math.min(confidence, 98),
    summary,
    department,
    duplicateCandidates: [],
  }
}

export const mockAIService = {
  analyzeComplaintText,
}
