'use client';

import AuthGuard from '../../components/AuthGuard';
import StaffWorkspace from '../../components/StaffWorkspace';

/** Home of the staff roles (Wattaman, Receptionist); administrators may open it to see their view. */
export default function WorkspacePage() {
  return (
    <AuthGuard allowedRoles={['WATTAMAN', 'RECEPTIONIST', 'ADMIN']}>
      <StaffWorkspace />
    </AuthGuard>
  );
}
