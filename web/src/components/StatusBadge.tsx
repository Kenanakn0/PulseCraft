export function StatusBadge({ online }: { online: boolean }) {
  return <span className={`badge ${online ? 'online' : 'offline'}`}>{online ? 'Çevrimiçi' : 'Çevrimdışı'}</span>
}
