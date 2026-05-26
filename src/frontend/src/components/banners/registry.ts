import type { ComponentType } from 'react';
import type { BannerProps } from './types';
import { HighIntentBanner } from './HighIntentBanner';
import { WeekendInterestBanner } from './WeekendInterestBanner';
import { WarmIntentBanner } from './WarmIntentBanner';
import { EngagedBrowserBanner } from './EngagedBrowserBanner';
import { ActiveSearcherBanner } from './ActiveSearcherBanner';

export const BANNER_REGISTRY: Record<string, ComponentType<BannerProps>> = {
  high_intent_tickets: HighIntentBanner,
  warm_intent_time: WarmIntentBanner,
  engaged_browser: EngagedBrowserBanner,
  active_searcher: ActiveSearcherBanner,
  weekend_interest: WeekendInterestBanner,
};
