import type { Complaint, DuplicateCheckResult } from '../types'

export function checkDuplicateComplaint(complaint: Partial<Complaint>, complaints: Complaint[]): DuplicateCheckResult {
  const query = `${complaint.category ?? ''} ${complaint.description ?? ''}`.toLowerCase()

  const similar = complaints.filter((item) => {
    if (item.id === complaint.id) return false
    const sameCategory = item.category === complaint.category
    const descriptionMatch = item.description.toLowerCase().includes(query) || query.includes(item.description.toLowerCase())
    const nearLocation =
      Math.abs(item.latitude - (complaint.latitude ?? 0)) < 0.002 &&
      Math.abs(item.longitude - (complaint.longitude ?? 0)) < 0.002

    return sameCategory && (descriptionMatch || nearLocation)
  })

  if (similar.length === 0) {
    return { isDuplicate: false, duplicateCount: 0, message: 'No duplicate found' }
  }

  const nearest = similar[0]
  return {
    isDuplicate: true,
    similarComplaint: nearest,
    duplicateCount: similar.length + 1,
    message: `${similar.length + 1} citizens have reported similar issues in this area.`,
  }
}
