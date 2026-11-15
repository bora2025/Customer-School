'use client';

import { useEffect, useState } from 'react';
import AuthGuard from '../../../components/AuthGuard';
import CorePluginSearch from '../../../components/CorePluginSearch';
import { storedRole } from '../../../lib/school-lock';

export default function WorkspaceSearchPage() {
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => { setRole(storedRole()); }, []);
  return (
    <AuthGuard allowedRoles={['RECEPTIONIST', 'ADMIN']}>
      <CorePluginSearch workspace={{ role }} />
    </AuthGuard>
  );
}
