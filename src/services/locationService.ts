export function getDemoCoordinates() {
  return {
    latitude: 13.0875,
    longitude: 80.2096,
    address: 'Anna Nagar, Chennai',
  }
}

export function getCurrentLocation() {
  return new Promise<{ latitude: number; longitude: number; address: string }>((resolve) => {
    if (!navigator.geolocation) {
      resolve(getDemoCoordinates())
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          address: 'Current location detected by browser',
        })
      },
      () => {
        resolve(getDemoCoordinates())
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  })
}

export function getNearbyIssues(complaints: Array<{ latitude: number; longitude: number; title: string; severity: string; status: string }>, lat: number, lng: number) {
  return complaints
    .map((issue) => {
      const distance = Math.sqrt((issue.latitude - lat) ** 2 + (issue.longitude - lng) ** 2) * 111000
      return { ...issue, distance: Math.round(distance) }
    })
    .filter((issue) => issue.distance < 800)
    .sort((a, b) => a.distance - b.distance)
}
