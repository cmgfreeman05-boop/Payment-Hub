import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PlanCard } from '../src/components/PlanCard.js';
import { AuthPanel } from '../src/components/AuthPanel.js';
import { StatusBadge } from '../src/components/StatusBadge.js';
import type { Plan } from '../src/types.js';

const plan: Plan = {
  id: 'pro-monthly',
  name: 'Pro',
  description: 'Advanced analytics',
  kind: 'subscription',
  amountCents: 4900,
  currency: 'usd',
  interval: 'month',
  features: ['Weekly briefings'],
  active: true,
};

describe('payment UI components', () => {
  it('renders server pricing and starts checkout', async () => {
    const onCheckout = vi.fn();
    render(<PlanCard plan={plan} busy={false} demo={false} onCheckout={onCheckout} />);
    expect(screen.getByText(/\$49\.00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /subscribe/i }));
    expect(onCheckout).toHaveBeenCalledWith('pro-monthly');
  });

  it('labels demo checkout clearly', () => {
    render(<PlanCard plan={plan} busy={false} demo onCheckout={vi.fn()} />);
    expect(screen.getByText('Demo checkout — no real charge.')).toBeInTheDocument();
  });

  it('submits registration credentials', async () => {
    const onAuthenticate = vi.fn().mockResolvedValue(undefined);
    render(<AuthPanel gateway="demo" onAuthenticate={onAuthenticate} />);
    await userEvent.click(screen.getByRole('button', { name: /need an account/i }));
    await userEvent.type(screen.getByLabelText('Email'), 'customer@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(onAuthenticate).toHaveBeenCalledWith('customer@example.com', 'correct-horse-battery', 'register');
  });

  it('renders accessible status badges', () => {
    render(<StatusBadge status="past_due" />);
    expect(screen.getByText('Past due')).toBeInTheDocument();
  });
});