'use client';

import { useEffect, useState } from 'react';

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/**
 * "Install app" button that adapts to platform:
 *  • Chrome/Edge/Android: uses beforeinstallprompt
 *  • iOS Safari: shows a tooltip with Add-to-Home-Screen instructions
 *  • Already-installed (standalone): hides itself
 *
 * `variant="compact"` renders a small pill suitable for the sidebar.
 * `variant="row"` renders a full-width row suitable for menus.
 * `variant="icon"` renders a bare icon button suitable for a compact toolbar.
 */
export default function InstallAppButton({ variant = 'row', className = '' }: { variant?: 'compact' | 'row' | 'icon'; className?: string }) {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSHint, setShowIOSHint] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
    if (standalone) { setInstalled(true); return; }

    const ua = window.navigator.userAgent || '';
    const iOS = /iPhone|iPad|iPod/.test(ua) && !(window as any).MSStream;
    setIsIOS(iOS);

    const onBIP = (e: Event) => { e.preventDefault(); setDeferred(e as BIPEvent); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener('beforeinstallprompt', onBIP);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;
  if (!deferred && !isIOS) return null; // browser hasn't fired the event yet & not iOS — nothing to offer

  async function handleClick() {
    if (deferred) {
      try { await deferred.prompt(); await deferred.userChoice; } catch {}
      setDeferred(null);
      return;
    }
    if (isIOS) setShowIOSHint(v => !v);
  }

  const label = '📲 Install app';
  if (variant === 'icon') {
    return (
      <button
        onClick={handleClick}
        className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${className}`}
        aria-label="Install Wattaman app"
        title="Install Wattaman app"
      >
        <span className="text-base leading-none">📲</span>
      </button>
    );
  }
  if (variant === 'compact') {
    return (
      <button
        onClick={handleClick}
        className={`text-xs px-3 py-1.5 rounded-full bg-emerald-500 text-white font-semibold shadow-sm hover:bg-emerald-600 ${className}`}
        aria-label="Install Wattaman app"
      >
        {label}
      </button>
    );
  }

  return (
    <div className={className}>
      <button
        onClick={handleClick}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
        aria-label="Install Wattaman app"
      >
        <span className="text-lg">📲</span>
        <span className="flex-1 text-left">Install Wattaman on this device</span>
        <span className="text-xs text-emerald-600">{isIOS && !deferred ? 'How?' : 'Install'}</span>
      </button>
      {showIOSHint && isIOS && (
        <div className="mt-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 leading-relaxed">
          On iPhone/iPad: tap the <strong>Share</strong> button <span aria-hidden>⬆️</span> in Safari, then choose <strong>"Add to Home Screen"</strong>.
        </div>
      )}
    </div>
  );
}
