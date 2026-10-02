'use client';

'use client'

import { useState, useEffect } from 'react';
import Sidebar from '../../../components/Sidebar';
import AuthGuard from '../../../components/AuthGuard';
import { adminNav } from '../../../lib/admin-nav';
import { useLanguage } from '../../../lib/i18n';

export default function NotificationSettings() {
  const { t } = useLanguage();
  const [settings, setSettings] = useState({
    emailEnabled: true,
    smsEnabled: false,
    parentNotifications: true,
    teacherReminders: true,
  });
  const [message, setMessage] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('notificationSettings');
    if (saved) {
      try { setSettings(JSON.parse(saved)); } catch {}
    }
  }, []);

  const updateSetting = (key: string, value: boolean) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const saveSettings = () => {
    localStorage.setItem('notificationSettings', JSON.stringify(settings));
    setMessage('Settings saved locally to this browser.');
    setTimeout(() => setMessage(''), 3000);
  };

  return (
    <AuthGuard requiredRole="ADMIN">
      <div className="page-shell">
        <Sidebar title="Admin Panel" subtitle="Wattanman" navItems={adminNav} accentColor="indigo" />
        <div className="page-content">
          <div className="h-14 lg:hidden" />
          <div className="page-header">
            <h1 className="text-2xl font-bold text-slate-800">{t('notifications.title')}</h1>
            <p className="text-sm text-slate-500 mt-1">{t('notifications.subtitle')}</p>
          </div>
          <div className="page-body">
            {message && (
              <div className="mb-4 px-4 py-3 rounded-lg text-sm font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
                {message}
              </div>
            )}
            <div className="card p-6">
              <h3 className="text-lg font-semibold text-slate-800 mb-4">
                Notification Preferences
              </h3>
              <div className="space-y-4">
                {[
                  { key: 'emailEnabled', label: t('notifications.enableEmail') },
                  { key: 'smsEnabled', label: t('notifications.enableSMS') },
                  { key: 'parentNotifications', label: t('notifications.notifyParents') },
                  { key: 'teacherReminders', label: t('notifications.sendReminders') },
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings[key as keyof typeof settings]}
                      onChange={(e) => updateSetting(key, e.target.checked)}
                      className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-slate-300 rounded"
                    />
                    <span className="text-sm text-slate-700">{label}</span>
                  </label>
                ))}
              </div>
              <div className="mt-6">
                <button onClick={saveSettings} className="btn-primary">
                  {t('sessionSettings.saveSettings')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}