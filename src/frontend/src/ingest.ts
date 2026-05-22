// URL vacía = relativa al origen actual → proxy Vite en dev, mismo host en producción
const API_URL = import.meta.env.VITE_API_URL || '';

export function ingest(userId: string, eventName: string, properties: Record<string, unknown> = {}) {
  fetch(`${API_URL}/api/events/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, eventName, properties }),
  }).catch(() => {}); // fire and forget, never block UI
}
