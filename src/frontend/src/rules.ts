// Mirror of src/rules-engine/rules.ts — keep in sync
export interface Rule {
  id: string;
  name: string;
  counterKey: string;
  threshold: number;
  windowSeconds: number;
  segment: string;
  score: number;
  minSessionSeconds?: number;
  weekendCheck?: boolean;
}

export const RULES: Rule[] = [
  {
    id: 'high_intent_tickets',
    name: 'Clicked tickets 2+ times',
    counterKey: 'ticket_clicks',
    threshold: 2,
    windowSeconds: 1800,
    segment: 'high_intent',
    score: 0.85,
  },
  {
    id: 'warm_intent_time',
    name: '5min en página + 1 click en tickets',
    counterKey: 'ticket_clicks',
    threshold: 1,
    windowSeconds: 3600,
    segment: 'warm_intent',
    score: 0.70,
    minSessionSeconds: 300,
  },
  {
    id: 'engaged_browser',
    name: 'Visited 3+ venues',
    counterKey: 'site_filters',
    threshold: 3,
    windowSeconds: 3600,
    segment: 'engaged',
    score: 0.60,
  },
  {
    id: 'active_searcher',
    name: 'Searched 3+ times',
    counterKey: 'searches',
    threshold: 3,
    windowSeconds: 1800,
    segment: 'active_searcher',
    score: 0.50,
  },
  {
    id: 'weekend_interest',
    name: 'Filtró Sábado/Domingo en últimos 2 min',
    counterKey: 'weekend_recent',
    threshold: 1,
    windowSeconds: 120,
    segment: 'weekend_interest',
    score: 0.65,
    weekendCheck: true,
  },
];
