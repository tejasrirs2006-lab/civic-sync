import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

type MapPoint = {
  id: string
  title: string
  lat: number
  lng: number
  severity: string
  status: string
}

const createPin = (color: string) =>
  L.divIcon({
    className: 'custom-pin',
    html: `<div style="background:${color};width:16px;height:16px;border-radius:999px;border:2px solid white;box-shadow:0 3px 10px rgba(15,23,42,0.25);"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -8],
  })

export function MapView({ points, center = [13.0875, 80.2096] }: { points: MapPoint[]; center?: [number, number] }) {
  return (
    <div className="h-[260px] w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
      <MapContainer center={center} zoom={12} scrollWheelZoom className="h-full w-full">
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
        {points.map((point) => {
          const color =
            point.severity === 'CRITICAL' ? '#dc2626' : point.severity === 'HIGH' ? '#f59e0b' : point.severity === 'MEDIUM' ? '#facc15' : '#10b981'

          return (
            <Marker key={point.id} position={[point.lat, point.lng]} icon={createPin(color)}>
              <Popup>
                <div>
                  <strong>{point.title}</strong>
                  <div>{point.status}</div>
                  <div>{point.severity}</div>
                </div>
              </Popup>
            </Marker>
          )
        })}
      </MapContainer>
    </div>
  )
}
