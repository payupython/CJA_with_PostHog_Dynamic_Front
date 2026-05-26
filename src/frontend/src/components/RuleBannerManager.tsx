import { useEffect, useState } from 'react';
import { BANNER_REGISTRY } from './banners/registry';

const API_URL = import.meta.env.VITE_API_URL || '';

interface Props {
  userEmail: string;
}

export function RuleBannerManager({ userEmail }: Props) {
  const [activeRules, setActiveRules] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const es = new EventSource(`${API_URL}/api/sse/dashboard`);

    es.addEventListener('segment_change', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.userId !== userEmail) return;
        const ruleId = data.rule as string;
        if (!ruleId || !BANNER_REGISTRY[ruleId]) return;
        setActiveRules(prev => new Set(prev).add(ruleId));
      } catch {}
    });

    return () => es.close();
  }, [userEmail]);

  const dismiss = (ruleId: string) => {
    setDismissed(prev => new Set(prev).add(ruleId));
  };

  const visibleRules = [...activeRules].filter(id => !dismissed.has(id));
  if (visibleRules.length === 0) return null;

  const topRule = visibleRules[visibleRules.length - 1];
  const Banner = BANNER_REGISTRY[topRule];
  if (!Banner) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4">
      <Banner userEmail={userEmail} onDismiss={() => dismiss(topRule)} />
    </div>
  );
}
