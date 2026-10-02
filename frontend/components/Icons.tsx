'use client';

/**
 * Modern SVG icon set — replaces emoji icons with clean, consistent line icons.
 * Each icon is 24×24 by default, uses currentColor for theming.
 */

import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

const icon = (d: string, opts?: { viewBox?: string; fill?: boolean }) => {
  const Component = ({ size = 24, className }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox={opts?.viewBox || '0 0 24 24'}
      fill={opts?.fill ? 'currentColor' : 'none'}
      stroke={opts?.fill ? 'none' : 'currentColor'}
      strokeWidth={opts?.fill ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={d} />
    </svg>
  );
  Component.displayName = 'Icon';
  return Component;
};

const multi = (paths: string[], opts?: { viewBox?: string; fill?: boolean }) => {
  const Component = ({ size = 24, className }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox={opts?.viewBox || '0 0 24 24'}
      fill={opts?.fill ? 'currentColor' : 'none'}
      stroke={opts?.fill ? 'none' : 'currentColor'}
      strokeWidth={opts?.fill ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
  Component.displayName = 'Icon';
  return Component;
};

// ─── Navigation & General ───
export const IconDashboard = multi([
  'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  'M9 22V12h6v10',
]);

export const IconSearch = multi([
  'M11 17.25a6.25 6.25 0 1 1 0-12.5 6.25 6.25 0 0 1 0 12.5z',
  'M16 16l4.5 4.5',
]);

export const IconUsers = multi([
  'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2',
  'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  'M23 21v-2a4 4 0 0 0-3-3.87',
  'M16 3.13a4 4 0 0 1 0 7.75',
]);

export const IconUser = multi([
  'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2',
  'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
]);

export const IconCamera = multi([
  'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z',
  'M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
]);

export const IconBook = multi([
  'M4 19.5A2.5 2.5 0 0 1 6.5 17H20',
  'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
]);

export const IconChart = multi([
  'M18 20V10',
  'M12 20V4',
  'M6 20v-6',
]);

export const IconBarChart = multi([
  'M12 20V10',
  'M18 20V4',
  'M6 20v-4',
]);

export const IconEdit = multi([
  'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7',
  'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
]);

export const IconBell = multi([
  'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9',
  'M13.73 21a2 2 0 0 1-3.46 0',
]);

export const IconCalendar = multi([
  'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z',
  'M16 2v4',
  'M8 2v4',
  'M3 10h18',
]);

export const IconSettings = multi([
  'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
]);

export const IconClock = multi([
  'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z',
  'M12 6v6l4 2',
]);

export const IconIdCard = multi([
  'M20 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z',
  'M8 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  'M14 10h4',
  'M14 14h4',
  'M5 17c0-1.5 1.5-3 3-3s3 1.5 3 3',
]);

export const IconTicket = multi([
  'M2 9a3 3 0 0 1 0 6v5h20v-5a3 3 0 0 1 0-6V4H2z',
  'M13 4v16',
]);

export const IconBriefcase = multi([
  'M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z',
  'M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2',
]);

export const IconGraduation = multi([
  'M22 10l-10-6L2 10l10 6 10-6z',
  'M6 12v5c3 3 9 3 12 0v-5',
  'M22 10v6',
]);

export const IconShield = icon(
  'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'
);

export const IconDownload = multi([
  'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4',
  'M7 10l5 5 5-5',
  'M12 15V3',
]);

export const IconClipboard = multi([
  'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2',
  'M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z',
]);

export const IconLogout = multi([
  'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4',
  'M16 17l5-5-5-5',
  'M21 12H9',
]);

export const IconGlobe = multi([
  'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z',
  'M2 12h20',
  'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z',
]);

export const IconCheck = icon('M20 6L9 17l-5-5');

export const IconStar = icon(
  'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'
);

export const IconHoliday = multi([
  'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z',
  'M16 2v4',
  'M8 2v4',
  'M3 10h18',
  'M8 14h.01',
  'M12 14h.01',
]);

export const IconDesign = multi([
  'M12 19l7-7 3 3-7 7-3-3z',
  'M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z',
  'M2 2l7.586 7.586',
  'M11 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
]);

export const IconMoney = multi([
  'M12 2v20',
  'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
]);

export const IconTrophy = multi([
  'M6 9H3l1.5 6h15L21 9h-3',
  'M6 9c0 3.3 2.7 6 6 6s6-2.7 6-6',
  'M12 15v6',
  'M8 21h8',
]);

export const IconLayers = multi([
  'M12 2L2 7l10 5 10-5-10-5z',
  'M2 17l10 5 10-5',
  'M2 12l10 5 10-5',
]);

export const IconCertificate = multi([
  'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z',
  'M9 12h6',
  'M9 8h6',
  'M9 16h3',
  'M15 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  'M18 18l2.5 2.5',
]);

/** Document scanner icon — corner-bracket scan frame with document and horizontal scan line */
export const IconDocScanner = ({ size = 24, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {/* Corner scan brackets */}
    <path d="M3 8V3h5" />
    <path d="M16 3h5v5" />
    <path d="M3 16v5h5" />
    <path d="M21 16v5h-5" />
    {/* Document body */}
    <path d="M7 5h7l3 3v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
    {/* Page fold corner */}
    <path d="M14 5v4h3" />
    {/* Text lines above scan */}
    <path d="M9 9.5h5" strokeWidth={1.2} />
    <path d="M9 11.5h5" strokeWidth={1.2} />
    {/* Scan line — bold, prominent */}
    <path d="M6 13.5h12" strokeWidth={2.4} />
    {/* Text lines below scan */}
    <path d="M9 15.5h5" strokeWidth={1.2} />
    <path d="M9 17.5h3" strokeWidth={1.2} />
  </svg>
);
IconDocScanner.displayName = 'IconDocScanner';

/** Paint brush / appearance icon */
export const IconPaint = multi([
  'M12 3a9 9 0 0 0-9 9 9 9 0 0 0 9 9 4 4 0 0 0 4-4c0-1-.5-2-1-2.5-1-1-.5-2.5 1-2.5h2a4 4 0 0 0 4-4 7 7 0 0 0-7-7',
  'M7.5 10.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  'M10.5 7.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  'M14.5 7.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  'M17 10.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
]);

// Icon name → component map for easy lookup
export const iconMap: Record<string, React.FC<IconProps>> = {
  dashboard: IconDashboard,
  search: IconSearch,
  users: IconUsers,
  user: IconUser,
  camera: IconCamera,
  book: IconBook,
  chart: IconChart,
  'bar-chart': IconBarChart,
  edit: IconEdit,
  bell: IconBell,
  calendar: IconCalendar,
  settings: IconSettings,
  clock: IconClock,
  'id-card': IconIdCard,
  ticket: IconTicket,
  briefcase: IconBriefcase,
  graduation: IconGraduation,
  shield: IconShield,
  download: IconDownload,
  clipboard: IconClipboard,
  logout: IconLogout,
  globe: IconGlobe,
  check: IconCheck,
  star: IconStar,
  holiday: IconHoliday,
  design: IconDesign,
  money: IconMoney,
  trophy: IconTrophy,
  layers: IconLayers,
  certificate: IconCertificate,
  'doc-scanner': IconDocScanner,
  paint: IconPaint,
};
