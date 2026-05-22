import { useEffect, useState, useCallback } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '';

export interface UserState {
  userId: string;
  segment?: string;
  intent_score?: string;
  last_event_name?: string;
  last_event?: string;
  counters?: Record<string, string>;
  sites?: string[];
}

export interface GlobalStats {
  total_users: number;
  stream_events: number;
  segments: Record<string, number>;
  timestamp: string;
}

export interface TimelineBucket {
  bucket: string;
  events: number;
}

export interface RuleHistory {
  rule_id: string;
  rule_name: string;
  userId: string;
  segment: string;
  score: number;
  actions: string[];
  sites: string[];
  counter_value: number;
  threshold: number;
  session_seconds: number | null;
  timestamp: string;
}

export function useAnalytics(refreshMs = 5000) {
  const [users, setUsers] = useState<UserState[]>([]);
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [timeline, setTimeline] = useState<TimelineBucket[]>([]);
  const [rulesHistory, setRulesHistory] = useState<RuleHistory[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(async () => {
    try {
      const [usersRes, statsRes, timelineRes, historyRes] = await Promise.all([
        fetch(`${API_URL}/api/analytics/users`),
        fetch(`${API_URL}/api/analytics/stats`),
        fetch(`${API_URL}/api/analytics/timeline`),
        fetch(`${API_URL}/api/analytics/rules-history`),
      ]);
      setUsers(await usersRes.json());
      setStats(await statsRes.json());
      setTimeline(await timelineRes.json());
      setRulesHistory(await historyRes.json());
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetch_();
    const t = setInterval(fetch_, refreshMs);
    return () => clearInterval(t);
  }, [fetch_, refreshMs]);

  return { users, stats, timeline, rulesHistory, loading, refresh: fetch_ };
}
