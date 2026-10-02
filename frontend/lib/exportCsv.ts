// Shared CSV export for student lists (Manage Students / Manage Class).

interface CustomFieldDef { key: string; label: string }

interface ExportableStudent {
  studentNumber?: string;
  name: string;
  nameKh?: string | null;
  email?: string | null;
  phone?: string | null;
  sex?: string | null;
  dateOfBirth?: string | null;
  address?: string | null;
  generation?: string | null;
  className?: string | null;
  customFieldValues?: Record<string, string | string[]> | null;
}

function formatCustomFieldValue(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v.join('; ') : (v || '');
}

function escapeCsvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function downloadStudentsCsv(
  students: ExportableStudent[],
  customFieldDefs: CustomFieldDef[],
  filename: string,
  includeClassColumn = false,
) {
  const headers = [
    'Student Number', 'Name', 'Khmer Name', 'Email', 'Phone', 'Sex', 'Date of Birth', 'Address', 'Generation',
    ...(includeClassColumn ? ['Class'] : []),
    ...customFieldDefs.map(f => f.label),
  ];

  const rows = students.map(s => [
    s.studentNumber || '',
    s.name || '',
    s.nameKh || '',
    s.email || '',
    s.phone || '',
    s.sex || '',
    s.dateOfBirth ? s.dateOfBirth.slice(0, 10) : '',
    s.address || '',
    s.generation || '',
    ...(includeClassColumn ? [s.className || ''] : []),
    ...customFieldDefs.map(f => formatCustomFieldValue(s.customFieldValues?.[f.key])),
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(cell => escapeCsvCell(String(cell))).join(','))
    .join('\n');

  // Leading BOM so Excel opens UTF-8 (Khmer names, etc.) without mangling it.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
