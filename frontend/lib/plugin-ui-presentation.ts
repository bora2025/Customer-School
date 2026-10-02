'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from './i18n';
import { getInstallationStatus, InstallationMetadata } from './installation';
import type { PluginUiPageDescriptor } from './plugin-ui-routing';

export function usePluginUiPresentation(page: PluginUiPageDescriptor) {
  const { lang } = useLanguage(); const [installation, setInstallation] = useState<InstallationMetadata | null>(null);
  useEffect(() => { const controller = new AbortController(); getInstallationStatus(controller.signal).then((status) => setInstallation(status.installation)).catch(() => undefined); return () => controller.abort(); }, []);
  return useMemo(() => {
    const language = lang === 'kh' ? 'km' : lang; const fallback = page.defaultLanguage || 'en';
    const translate = (key: unknown, defaultText: unknown) => typeof key === 'string' ? page.translations?.[language]?.[key] || page.translations?.[fallback]?.[key] || String(defaultText || key) : String(defaultText || '');
    const locale = installation?.locale || (language === 'km' ? 'km-KH' : 'en-US'); const timeZone = installation?.timezone || 'Asia/Phnom_Penh'; const currency = installation?.currency || 'USD';
    const format = (value: unknown, kind = 'text') => { if (value === null || value === undefined) return '—'; try { if (kind === 'boolean') return value === true ? 'Yes' : value === false ? 'No' : String(value); if (kind === 'number') return new Intl.NumberFormat(locale).format(Number(value)); if (kind === 'currency') return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(value)); if (kind === 'date') return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium' }).format(new Date(String(value))); if (kind === 'datetime') return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(String(value))); } catch { return String(value); } return typeof value === 'object' ? JSON.stringify(value) : String(value); };
    return { language, locale, timeZone, currency, translate, format };
  }, [installation, lang, page]);
}
