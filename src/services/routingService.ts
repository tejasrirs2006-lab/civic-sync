export function routeComplaint(complaint: { category: string; severity: string; description?: string }) {
  const category = complaint.category || ''
  const text = `${category} ${complaint.description ?? ''}`.toLowerCase()

  if (/(pothole|road|crack|damaged)/.test(text)) return 'Roads & Infrastructure'
  if (/(garbage|trash|waste|dump|litter|sanitation)/.test(text)) return 'Sanitation Department'
  if (/(water|leak|pipe|supply)/.test(text)) return 'Water Supply Department'
  if (/(street light|lamp|dark|electric|lighting)/.test(text)) return 'Electrical / Street Lighting'
  if (/(flood|drainage|water logging|blocked drain)/.test(text)) return 'Drainage / Disaster Response'
  if (/(traffic|signal|unsafe|accident)/.test(text)) return 'Traffic / Road Safety'
  if (/(bridge|public|infrastructure|wall)/.test(text)) return 'Municipal Infrastructure'
  if (complaint.severity === 'CRITICAL') return 'Disaster Response + Emergency'

  return 'Municipal Infrastructure'
}
