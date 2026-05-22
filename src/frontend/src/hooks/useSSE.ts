import { useEffect, useRef, useState } from 'react';

export interface SSEEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

const API_URL = import.meta.env.VITE_API_URL || '';

export function useSSE(maxEvents = 50) {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(`${API_URL}/api/sse/dashboard`);
    esRef.current = es;

    es.addEventListener('connected', () => setConnected(true));

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const event: SSEEvent = {
          id: crypto.randomUUID(),
          type: data.type || 'event',
          data,
          timestamp: data.timestamp || new Date().toISOString(),
        };
        setEvents(prev => [event, ...prev].slice(0, maxEvents));
      } catch {}
    };

    ['segment_change', 'event', 'stats_update', 'rule_triggered'].forEach(type => {
      es.addEventListener(type, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          const event: SSEEvent = {
            id: crypto.randomUUID(),
            type,
            data,
            timestamp: data.timestamp || new Date().toISOString(),
          };
          setEvents(prev => [event, ...prev].slice(0, maxEvents));
        } catch {}
      });
    });

    es.onerror = () => setConnected(false);

    return () => {
      es.close();
      setConnected(false);
    };
  }, [maxEvents]);

  return { events, connected };
}
