'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';

interface Pref {
  emailEnabled: boolean;
  smsEnabled: boolean;
  inAppEnabled: boolean;
  announcementsEnabled: boolean;
  messagesEnabled: boolean;
  digestFrequency: 'NONE' | 'DAILY' | 'WEEKLY';
}

const DEFAULT: Pref = {
  emailEnabled: true,
  smsEnabled: true,
  inAppEnabled: true,
  announcementsEnabled: true,
  messagesEnabled: true,
  digestFrequency: 'NONE',
};

export default function NotificationSettingsPage() {
  const [pref, setPref] = useState<Pref>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/notification-preference');
        if (res.ok) {
          const data = await res.json();
          setPref({
            emailEnabled: data.emailEnabled,
            smsEnabled: data.smsEnabled,
            inAppEnabled: data.inAppEnabled,
            announcementsEnabled: data.announcementsEnabled,
            messagesEnabled: data.messagesEnabled,
            digestFrequency: data.digestFrequency,
          });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await apiFetch('/api/notification-preference', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pref),
      });
      if (res.ok) setMsg('Preferences saved.');
      else setMsg('Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const toggle = (k: keyof Pref) =>
    setPref((p) => ({ ...p, [k]: !p[k as keyof Pref] }));

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-2xl mx-auto bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-slate-800">Notification Preferences</h1>
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">← Back</Link>
        </div>

        {loading ? (
          <p className="text-slate-500">Loading...</p>
        ) : (
          <div className="space-y-5">
            <section>
              <h2 className="text-sm font-semibold text-slate-700 mb-2">Channels</h2>
              <div className="space-y-2">
                {[
                  { k: 'inAppEnabled', label: 'In-app notifications' },
                  { k: 'emailEnabled', label: 'Email' },
                  { k: 'smsEnabled', label: 'SMS' },
                ].map(({ k, label }) => (
                  <label key={k} className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                    <span className="text-slate-700">{label}</span>
                    <input
                      type="checkbox"
                      checked={(pref as any)[k]}
                      onChange={() => toggle(k as keyof Pref)}
                      className="h-5 w-5"
                    />
                  </label>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold text-slate-700 mb-2">Categories</h2>
              <div className="space-y-2">
                {[
                  { k: 'announcementsEnabled', label: 'Announcements' },
                  { k: 'messagesEnabled', label: 'Direct messages' },
                ].map(({ k, label }) => (
                  <label key={k} className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                    <span className="text-slate-700">{label}</span>
                    <input
                      type="checkbox"
                      checked={(pref as any)[k]}
                      onChange={() => toggle(k as keyof Pref)}
                      className="h-5 w-5"
                    />
                  </label>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold text-slate-700 mb-2">Email digest</h2>
              <select
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
                value={pref.digestFrequency}
                onChange={(e) =>
                  setPref({ ...pref, digestFrequency: e.target.value as Pref['digestFrequency'] })
                }
              >
                <option value="NONE">Off (immediate notifications only)</option>
                <option value="DAILY">Daily summary</option>
                <option value="WEEKLY">Weekly summary</option>
              </select>
            </section>

            {msg && <p className="text-sm text-slate-600">{msg}</p>}

            <button
              onClick={save}
              disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg font-medium disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save preferences'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
