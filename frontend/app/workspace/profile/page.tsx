'use client';

import AuthGuard from '../../../components/AuthGuard';
import MyProfile from '../../../components/MyProfile';

/** My Profile of the staff roles (Teacher, Wattaman, Receptionist). */
export default function WorkspaceProfilePage() {
  return (
    <AuthGuard allowedRoles={['TEACHER', 'WATTAMAN', 'RECEPTIONIST', 'ADMIN']}>
      <MyProfile />
    </AuthGuard>
  );
}
