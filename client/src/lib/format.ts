export function formatMoney(amountCents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(amountCents / 100);
}

export function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}