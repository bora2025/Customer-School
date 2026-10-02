import { useEffect, useState } from 'react';

export type InstallationState = 'ready' | 'installed' | 'legacy_unadopted';

export interface InstallationMetadata {
  installationId: string;
  status: string;
  schoolName: string;
  schoolSlug: string;
  locale: string;
  timezone: string;
  currency: string;
  coreVersion: string;
  installedAt: string;
}

export interface InstallationStatus {
  state: InstallationState;
  installation: InstallationMetadata | null;
}

export interface InstallRequest {
  schoolName: string;
  schoolSlug: string;
  locale: string;
  timezone: string;
  currency: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (Array.isArray(body?.message)) return body.message.join('. ');
    if (typeof body?.message === 'string') return body.message;
    if (typeof body?.error === 'string') return body.error;
  } catch {
    // Use the status fallback below when the response is not JSON.
  }
  return `Request failed with status ${response.status}`;
}

export async function getInstallationStatus(signal?: AbortSignal): Promise<InstallationStatus> {
  const response = await fetch('/api/installation/status', {
    credentials: 'include',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(await responseMessage(response));
  return response.json();
}

/**
 * The installation's configured currency (ISO 4217 code), for formatting money without
 * hardcoding `$`. Falls back to 'USD' until the (public, unauthenticated) status endpoint
 * resolves -- there is no meaningful "unknown currency" state to render instead.
 */
export function useInstallationCurrency(): string {
  const [currency, setCurrency] = useState('USD');
  useEffect(() => {
    const controller = new AbortController();
    getInstallationStatus(controller.signal)
      .then((status) => { if (status.installation?.currency) setCurrency(status.installation.currency); })
      .catch(() => { /* keep the USD fallback; this is a display nicety, not a hard dependency */ });
    return () => controller.abort();
  }, []);
  return currency;
}

export async function installWattanam(payload: InstallRequest): Promise<InstallationStatus> {
  const response = await fetch('/api/installation/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await responseMessage(response));
  return response.json();
}

