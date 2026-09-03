import { useMemo, useState } from 'react'
import { ExternalLink, LocateFixed, MapPin, Store } from 'lucide-react'
import type { CommercialAreaView, Restaurant } from './types.ts'
import './nearby-map.css'

type Point = { latitude: number; longitude: number }

// MVP 식당에는 상세 도로명 좌표가 없으므로 동네 중심 좌표를 사용한다.
const neighborhoodCenters: Record<string, Point> = {
  '망원동': { latitude: 37.5560, longitude: 126.9016 },
  '연남동': { latitude: 37.5624, longitude: 126.9227 },
  '성수동': { latitude: 37.5446, longitude: 127.0557 },
  '광안리': { latitude: 35.1532, longitude: 129.1187 },
  '소제동': { latitude: 36.3357, longitude: 127.4382 },
  '동성로': { latitude: 35.8691, longitude: 128.5956 },
  '신림동': { latitude: 37.4842, longitude: 126.9296 },
  '송도동': { latitude: 37.3827, longitude: 126.6439 },
  '동명동': { latitude: 35.1497, longitude: 126.9220 },
  '이태원동': { latitude: 37.5345, longitude: 126.9946 },
  '행궁동': { latitude: 37.2824, longitude: 127.0147 },
  '노형동': { latitude: 33.4850, longitude: 126.4772 },
}

export default function NearbyMap({ restaurant, area }: { restaurant: Restaurant; area?: CommercialAreaView }) {
  const restaurantPoint = neighborhoodCenters[restaurant.neighborhood]
    || (area?.latitude && area?.longitude ? { latitude: area.latitude, longitude: area.longitude } : undefined)
  const [userPoint, setUserPoint] = useState<Point>()
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState('')
  const point = userPoint || restaurantPoint

  const mapUrl = useMemo(() => {
    if (!point) return ''
    const latSpan = .006
    const lngSpan = .008
    const bbox = [point.longitude - lngSpan, point.latitude - latSpan, point.longitude + lngSpan, point.latitude + latSpan].join(',')
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${point.latitude},${point.longitude}`
  }, [point])

  const fullMapUrl = point
    ? `https://www.openstreetmap.org/?mlat=${point.latitude}&mlon=${point.longitude}#map=16/${point.latitude}/${point.longitude}`
    : 'https://www.openstreetmap.org/'

  const locateMe = () => {
    if (!navigator.geolocation) {
      setLocationError('이 브라우저에서는 위치 기능을 사용할 수 없어요.')
      return
    }
    setLocating(true)
    setLocationError('')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setUserPoint({ latitude: coords.latitude, longitude: coords.longitude })
        setLocating(false)
      },
      () => {
        setLocationError('위치 권한을 허용하면 현재 위치 주변 가게를 볼 수 있어요.')
        setLocating(false)
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    )
  }

  return <section className="nearby-map-card">
    <div className="nearby-map-heading">
      <div className="nearby-map-title"><span><MapPin /></span><div><small>위치 기반 탐색</small><h3>{userPoint ? '내 주변 가게' : `${restaurant.neighborhood} 주변 가게`}</h3><p>지도를 확대하면 등록된 음식점·카페·편의시설을 확인할 수 있어요.</p></div></div>
      <div className="nearby-map-actions">
        {userPoint && <button type="button" onClick={() => setUserPoint(undefined)}><Store /> 식당 주변</button>}
        <button type="button" className="locate-button" disabled={locating} onClick={locateMe}><LocateFixed /> {locating ? '위치 확인 중' : '내 위치 주변'}</button>
      </div>
    </div>
    {locationError && <p className="nearby-location-error">{locationError}</p>}
    {mapUrl ? <div className="nearby-map-frame"><iframe title={`${userPoint ? '현재 위치' : restaurant.name} 주변 지도`} src={mapUrl} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /><a href={fullMapUrl} target="_blank" rel="noreferrer">큰 지도에서 보기 <ExternalLink /></a></div>
      : <div className="nearby-map-empty"><MapPin /><p>이 식당의 위치 좌표를 준비하고 있어요.</p></div>}
    <p className="nearby-map-note">{userPoint ? '현재 위치는 지도 표시 목적으로만 브라우저에서 사용하며 먹투 서버에 저장하지 않습니다.' : '표시 지점은 시연용 동네 중심 좌표이며 실제 식당 주소와 다를 수 있습니다.'} 지도 데이터 © OpenStreetMap contributors</p>
  </section>
}
