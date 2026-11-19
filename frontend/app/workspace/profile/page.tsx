'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '../../../components/AuthGuard';
import { storedRole } from '../../../lib/school-lock';
import MyProfile from '../../../components/MyProfile';

/** My Profile of the staff roles (Teacher, Wattaman, Receptionist). */
export default function WorkspaceProfilePage() {
  const router = useRouter();
  // Teachers have their profile on the Teacher Portal's home.
  useEffect(() => { if (storedRole() === 'TEACHER') router.replace('/teacher#account'); }, [router]);
  return (
    <AuthGuard allowedRoles={['TEACHER', 'WATTAMAN', 'RECEPTIONIST', 'ADMIN']}>
      <MyProfile />
    </AuthGuard>
  );
}
