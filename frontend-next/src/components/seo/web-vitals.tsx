'use client';

import { useReportWebVitals } from 'next/web-vitals';

function report(metric: { id: string; name: string; value: number; delta: number; rating: string }) {
  const detail = { id: metric.id, name: metric.name, value: metric.value, delta: metric.delta, rating: metric.rating, path: window.location.pathname };
  window.dispatchEvent(new CustomEvent('dokitruyen:web-vital', { detail }));
  if (process.env.NODE_ENV === 'development') console.debug('[web-vitals]', detail);
}

export function WebVitals() {
  useReportWebVitals(report);
  return null;
}
