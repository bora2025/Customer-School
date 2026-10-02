import {
  composeNavigation,
  frontendDistribution,
  isCoreNavigationHref,
  NavigationRegistration,
} from './navigation-registry';

const legacyAdminItems = [
  // ── Overview ──
  { label: 'nav.dashboard', href: '/admin', icon: 'dashboard', section: 'nav.section.overview' },
  { label: 'nav.search', href: '/admin/search', icon: 'search' },

  // ── Academics ──
  { label: 'nav.manageClasses', href: '/admin/classes', icon: 'book', section: 'nav.section.academics' },
  { label: 'nav.studyYears', href: '/admin/study-years', icon: 'layers' },
  { label: 'nav.timetable', href: '/admin/timetable', icon: 'calendar' },
  { label: 'nav.scoring', href: '/admin/scoring', icon: 'trophy' },
  { label: 'Examinations', href: '/admin/exams', icon: 'book' },

  // ── Attendance ──
  { label: 'nav.takeAttendance', href: '/admin/camera', icon: 'camera', section: 'nav.section.attendance' },
  { label: 'nav.officerAttendance', href: '/admin/staff-attendance', icon: 'clipboard' },
  { label: 'nav.editAttendance', href: '/admin/attendance/edit', icon: 'edit' },
  { label: 'nav.editOfficerAttendance', href: '/admin/staff-attendance/edit', icon: 'edit' },

  // ── People ──
  { label: 'nav.manageUsers', href: '/admin/users', icon: 'users', section: 'nav.section.people' },
  { label: 'Teacher Portal', href: '/admin/teachers', icon: 'graduation' },
  { label: 'Student Portal', href: '/admin/students', icon: 'users' },
  { label: 'Parent Portal', href: '/admin/parents', icon: 'users' },
  { label: 'nav.manageHub', href: '/admin/manage-hub', icon: 'briefcase' },
  { label: 'nav.manageOfficer', href: '/admin/employees', icon: 'briefcase' },
  { label: 'nav.manageTeachers', href: '/wattaman/scheduled-teacher', icon: 'graduation' },

  // ── Communication ──
  { label: 'Communication Hub', href: '/admin/communication', icon: 'clipboard', section: 'Communication', badgeKey: 'messages' as const },
  { label: 'Parent Link Requests', href: '/admin/parent-requests', icon: 'users' },
  { label: 'Class Registrations', href: '/admin/class-registrations', icon: 'clipboard', badgeKey: 'class-registrations' as const },

  // ── Finance ──
  { label: 'Finance Dashboard', href: '/admin/budget-report', icon: 'bar-chart', section: 'Finance' },
  { label: 'nav.feeManagement', href: '/admin/fees', icon: 'money' },
  { label: 'Salary Management', href: '/admin/salary', icon: 'money' },
  { label: 'Platform Billing', href: '/admin/platform-billing', icon: 'money', badgeKey: 'platform-billing' as const },

  // ── Reports ──
  { label: 'nav.studentReport', href: '/admin/reports', icon: 'chart', section: 'nav.section.reports' },
  { label: 'nav.officerReport', href: '/admin/staff-reports', icon: 'bar-chart' },
  { label: 'nav.teacherReports', href: '/wattaman/teacher-reports', icon: 'clipboard' },

  // ── Designer ──
  { label: 'nav.cardDesigner', href: '/admin/card-designer', icon: 'design', section: 'Designer' },
  { label: 'nav.studentCards', href: '/admin/student-cards', icon: 'id-card' },
  { label: 'nav.staffCards', href: '/admin/staff-cards', icon: 'id-card' },
  { label: 'Certificate', href: '/admin/certificate', icon: 'certificate' },

  // ── Modules ──
  { label: 'School Bus', href: '/admin/bus', icon: 'calendar', section: 'Modules' },

  // ── Tools ──
  { label: 'LaTeX Editor', href: '/tools/latex-editor', icon: '∑', section: 'Tools' },

  // ── Settings ──
  { label: 'nav.sessionSettings', href: '/admin/session-settings', icon: 'clock', section: 'nav.section.settings' },
  { label: 'nav.holidays', href: '/admin/holidays', icon: 'holiday' },
  { label: 'Backup & Restore', href: '/admin/backup', icon: 'briefcase' },
  // School administrators use the installation's delegated marketplace session here. The
  // standalone /marketplace portal has its own account session and would incorrectly ask them to
  // sign in again even when this school is already linked.
  { label: 'Marketplace & Plugins', href: '/admin/plugins', icon: 'briefcase' },
  { label: 'Updates & Health', href: '/admin/system', icon: 'chart' },
  { label: 'Licensing', href: '/admin/licensing', icon: 'certificate' },
  { label: 'Audit & Security', href: '/admin/audit', icon: 'clipboard' },
  { label: 'nav.settings', href: '/admin/settings', icon: 'settings' },
  { label: 'My Profile', href: '/admin/profile', icon: 'users' },
  { label: 'Appearance', href: '/admin/appearance', icon: 'paint', section: 'Appearance' },
  { label: 'Posts', href: '/admin/appearance/posts', icon: 'edit' },
  { label: 'About', href: '/admin/appearance/about', icon: 'users' },
] as const;

/** Authoritative ownership registry for static administrator navigation. */
export const adminNavigationRegistry: readonly NavigationRegistration[] = legacyAdminItems.map((item) => ({
  ...item,
  source: isCoreNavigationHref(item.href) ? 'core' : 'legacy-business',
}));

export function adminNavigationForDistribution(value?: string) {
  return composeNavigation(adminNavigationRegistry, frontendDistribution(value));
}

// Safe compatibility default: existing deployments stay legacy-full until explicitly migrated.
export const adminNav = adminNavigationForDistribution();

/** Navigation for CLASS_ADMIN — limited to classes, scoring, and student attendance only. */
export const classAdminNav = [
  // ── Academics ──
  { label: 'nav.manageClasses', href: '/admin/classes', icon: 'book', section: 'nav.section.academics' },
  { label: 'nav.scoring', href: '/admin/scoring', icon: 'trophy' },
  { label: 'Class Registrations', href: '/admin/class-registrations', icon: 'clipboard', badgeKey: 'class-registrations' as const },

  // ── Attendance ──
  { label: 'nav.takeAttendance', href: '/admin/attendance', icon: 'camera', section: 'nav.section.attendance' },
  { label: 'nav.editAttendance', href: '/admin/attendance/edit', icon: 'edit' },
  { label: 'nav.selfScan', href: '/employee/scan', icon: 'camera' },
]
