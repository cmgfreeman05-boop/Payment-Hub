export type CatalogPlan = {
  id: string;
  name: string;
  description: string;
  kind: 'one_time' | 'subscription';
  amountCents: number;
  currency: string;
  interval: 'month' | 'year' | null;
  features: string[];
  active: boolean;
};

export const CATALOG: CatalogPlan[] = [
  {
    id: 'essential-report',
    name: 'Essential Report',
    description: 'A focused market analysis for a single decision.',
    kind: 'one_time',
    amountCents: 2900,
    currency: 'usd',
    interval: null,
    features: ['One comprehensive report', 'Key metrics and benchmarks', 'PDF delivery', '30 days of email support'],
    active: true,
  },
  {
    id: 'portfolio-pack',
    name: 'Portfolio Pack',
    description: 'Deep-dive research across your entire portfolio.',
    kind: 'one_time',
    amountCents: 9900,
    currency: 'usd',
    interval: null,
    features: ['Five comprehensive reports', 'Portfolio-level risk analysis', 'Executive summary', '90 days of priority support'],
    active: true,
  },
  {
    id: 'starter-monthly',
    name: 'Starter',
    description: 'Continuous insights for independent professionals.',
    kind: 'subscription',
    amountCents: 1900,
    currency: 'usd',
    interval: 'month',
    features: ['Monthly market report', 'Dashboard access', 'Email alerts', 'Cancel anytime'],
    active: true,
  },
  {
    id: 'pro-monthly',
    name: 'Pro',
    description: 'Advanced analytics for growing teams.',
    kind: 'subscription',
    amountCents: 4900,
    currency: 'usd',
    interval: 'month',
    features: ['Everything in Starter', 'Weekly analytics briefings', 'Team seats for five', 'Priority support'],
    active: true,
  },
  {
    id: 'pro-annual',
    name: 'Pro Annual',
    description: 'A full year of Pro with two months saved.',
    kind: 'subscription',
    amountCents: 49000,
    currency: 'usd',
    interval: 'year',
    features: ['Everything in Pro', 'Two months free', 'Annual strategy session', 'Dedicated onboarding'],
    active: true,
  },
];