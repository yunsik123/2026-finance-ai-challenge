import { useEffect, useRef, useState } from 'react'
import { Bell, Inbox } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from './lib/api.ts'
import type { AppNotification } from './types.ts'

const ago = (value: string) => {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000)
  if (minutes < 1) return '방금'
  if (minutes < 60) return `${minutes}분 전`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`
  return `${Math.floor(minutes / 1440)}일 전`
}

export default function NotificationBell({ notifications, unread, refresh }: {
  notifications: AppNotification[]
  unread: number
  refresh: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const markRead = async () => {
    if (!unread) return
    try { await api('/api/notifications/read', { method: 'POST', body: JSON.stringify({}) }); await refresh() }
    catch { /* 알림 읽음 처리는 실패해도 사용자 흐름을 막지 않는다. */ }
  }

  return <div className="notification-wrap" ref={wrap}>
    <button className="icon-button hide-mobile" aria-label={unread ? `알림 ${unread}건` : '알림'}
      onClick={() => { setOpen(!open); if (!open) markRead() }}>
      <Bell size={20} />
      {unread > 0 && <i className="bell-dot">{unread > 9 ? '9+' : unread}</i>}
    </button>
    {open && <div className="notification-panel">
      <header><b>알림</b><span>{notifications.length}건</span></header>
      <div className="notification-list">
        {notifications.map((item) => <button key={item.id} className={item.read ? '' : 'unread'}
          onClick={() => { setOpen(false); if (item.link) navigate(item.link) }}>
          <b>{item.title}</b>
          <p>{item.body}</p>
          <small>{ago(item.createdAt)}</small>
        </button>)}
        {!notifications.length && <div className="notification-empty"><Inbox /><p>아직 받은 알림이 없어요.</p></div>}
      </div>
    </div>}
  </div>
}
