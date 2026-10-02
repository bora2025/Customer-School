'use client';

import { useState } from 'react';
import {
  CardDesign,
  CardType,
  BLANK_TEMPLATE,
  STUDENT_TEMPLATE,
  STAFF_TEMPLATE,
  STUDENT_CLASSIC_BLUE,
  STUDENT_DARK_NAVY,
  STUDENT_SKY_WAVE,
  STUDENT_GEOMETRIC,
  STUDENT_MINIMAL,
  STAFF_CORPORATE_TEAL,
  STAFF_DEEP_OCEAN,
  STAFF_ROSE,
  STAFF_FOREST,
  STAFF_SLATE_EXECUTIVE,
} from './types';

type Unit = 'px' | 'cm' | 'in' | 'mm';
type BitDepth = 8 | 16 | 32;
type DPI = 72 | 96 | 150 | 300;

interface NewProjectDialogProps {
  onClose: () => void;
  onCreate: (design: CardDesign) => void;
}

const PRESET_SIZES: { label: string; key: string; widthPx: number; heightPx: number; description: string }[] = [
  { label: 'A4 Portrait', key: 'a4', widthPx: 794, heightPx: 1123, description: '210 × 297 mm' },
  { label: 'Social Media Post', key: 'post', widthPx: 1080, heightPx: 1080, description: '1080 × 1080 px' },
  { label: 'Social Media Story', key: 'story', widthPx: 1080, heightPx: 1920, description: '1080 × 1920 px' },
  { label: 'Photo (4×6)', key: 'photo', widthPx: 1800, heightPx: 1200, description: '4 × 6 inches' },
  { label: 'ID Card', key: 'id', widthPx: 340, heightPx: 215, description: '85.6 × 54 mm' },
];

function pxToUnit(px: number, unit: Unit, dpi: DPI): number {
  switch (unit) {
    case 'cm': return Math.round((px / dpi) * 2.54 * 100) / 100;
    case 'in': return Math.round((px / dpi) * 100) / 100;
    case 'mm': return Math.round((px / dpi) * 25.4 * 10) / 10;
    default: return px;
  }
}

function unitToPx(val: number, unit: Unit, dpi: DPI): number {
  switch (unit) {
    case 'cm': return Math.round((val / 2.54) * dpi);
    case 'in': return Math.round(val * dpi);
    case 'mm': return Math.round((val / 25.4) * dpi);
    default: return Math.round(val);
  }
}

const PURPOSE_OPTIONS: { id: CardType; icon: string; label: string; description: string; color: string }[] = [
  { id: 'student', icon: '🎓', label: 'Student ID Card', description: 'Photo card with student data', color: 'indigo' },
  { id: 'staff', icon: '👨‍🏫', label: 'Staff ID Card', description: 'Photo card with staff data', color: 'emerald' },
  { id: 'teacher-part-time', icon: '⏰', label: 'TPT ID Card', description: 'Part-time teacher from timetable', color: 'orange' },
  { id: 'certificate-student', icon: '📜', label: 'Student Certificate', description: 'Certificate using student records', color: 'amber' },
  { id: 'certificate-staff', icon: '🏅', label: 'Staff Certificate', description: 'Certificate using staff records', color: 'rose' },
  { id: 'general', icon: '✏️', label: 'General / Custom', description: 'Free design, no linked data', color: 'slate' },
];

export default function NewProjectDialog({ onClose, onCreate }: NewProjectDialogProps) {
  const [tab, setTab] = useState<'blank' | 'template'>('blank');

  // Blank project state
  const [purpose, setPurpose] = useState<CardType>('general');
  const [selectedPreset, setSelectedPreset] = useState<string>('id');
  const [unit, setUnit] = useState<Unit>('px');
  const [dpi, setDpi] = useState<DPI>(96);
  const [widthVal, setWidthVal] = useState<number>(340);
  const [heightVal, setHeightVal] = useState<number>(215);
  const [isCustomSize, setIsCustomSize] = useState(false);
  const [bgColor, setBgColor] = useState('#ffffff');
  const [bitDepth, setBitDepth] = useState<BitDepth>(8);

  const handlePresetSelect = (preset: (typeof PRESET_SIZES)[number]) => {
    setSelectedPreset(preset.key);
    setIsCustomSize(false);
    setWidthVal(unit === 'px' ? preset.widthPx : pxToUnit(preset.widthPx, unit, dpi));
    setHeightVal(unit === 'px' ? preset.heightPx : pxToUnit(preset.heightPx, unit, dpi));
  };

  const handleUnitChange = (newUnit: Unit) => {
    const widthPx = unitToPx(widthVal, unit, dpi);
    const heightPx = unitToPx(heightVal, unit, dpi);
    setUnit(newUnit);
    setWidthVal(newUnit === 'px' ? widthPx : pxToUnit(widthPx, newUnit, dpi));
    setHeightVal(newUnit === 'px' ? heightPx : pxToUnit(heightPx, newUnit, dpi));
  };

  const handleDpiChange = (newDpi: DPI) => {
    const widthPx = unitToPx(widthVal, unit, dpi);
    const heightPx = unitToPx(heightVal, unit, dpi);
    setDpi(newDpi);
    if (unit !== 'px') {
      setWidthVal(pxToUnit(widthPx, unit, newDpi));
      setHeightVal(pxToUnit(heightPx, unit, newDpi));
    }
  };

  const handleCreateBlank = () => {
    const wPx = Math.max(100, unitToPx(widthVal, unit, dpi));
    const hPx = Math.max(100, unitToPx(heightVal, unit, dpi));
    const design: CardDesign = {
      ...BLANK_TEMPLATE,
      width: wPx,
      height: hPx,
      backgroundColor: bgColor,
      cardType: purpose,
    };
    onCreate(design);
  };

  const handleApplyTemplate = (design: CardDesign) => {
    onCreate(JSON.parse(JSON.stringify(design)));
  };

  const STUDENT_PRESETS = [
    { key: 'st_default', design: STUDENT_TEMPLATE, label: 'Student Default', emoji: '🎓', tag: 'student' },
    { key: 'st1', design: STUDENT_CLASSIC_BLUE, label: 'Classic Blue', emoji: '🔵', tag: 'student' },
    { key: 'st2', design: STUDENT_DARK_NAVY, label: 'Dark Navy', emoji: '🌌', tag: 'student' },
    { key: 'st3', design: STUDENT_SKY_WAVE, label: 'Sky Wave', emoji: '🌊', tag: 'student' },
    { key: 'st4', design: STUDENT_GEOMETRIC, label: 'Geometric', emoji: '🔷', tag: 'student' },
    { key: 'st5', design: STUDENT_MINIMAL, label: 'Minimal', emoji: '⬜', tag: 'student' },
  ] as const;

  const STAFF_PRESETS = [
    { key: 'sf_default', design: STAFF_TEMPLATE, label: 'Staff Default', emoji: '👨‍🏫', tag: 'staff' },
    { key: 'sf1', design: STAFF_CORPORATE_TEAL, label: 'Corp Teal', emoji: '🟢', tag: 'staff' },
    { key: 'sf2', design: STAFF_DEEP_OCEAN, label: 'Deep Ocean', emoji: '🌑', tag: 'staff' },
    { key: 'sf3', design: STAFF_ROSE, label: 'Rose Pro', emoji: '🌸', tag: 'staff' },
    { key: 'sf4', design: STAFF_FOREST, label: 'Forest', emoji: '🌿', tag: 'staff' },
    { key: 'sf5', design: STAFF_SLATE_EXECUTIVE, label: 'Executive', emoji: '🏛️', tag: 'staff' },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-xl font-bold text-slate-800">New Project</h2>
            <p className="text-sm text-slate-500 mt-0.5">Create a blank canvas or start from a template</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors text-lg">&times;</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 px-6">
          <button
            onClick={() => setTab('blank')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === 'blank' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            📄 Blank Project
          </button>
          <button
            onClick={() => setTab('template')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === 'template' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            🎨 From Template
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'blank' && (
            <div className="space-y-5">
              {/* Purpose / Data Source */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Purpose / Data Source</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {PURPOSE_OPTIONS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPurpose(p.id)}
                      className={`p-3 rounded-xl border-2 text-left transition-all ${
                        purpose === p.id
                          ? 'border-indigo-500 bg-indigo-50'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="text-2xl mb-1">{p.icon}</div>
                      <div className="text-xs font-semibold text-slate-800 leading-tight">{p.label}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">{p.description}</div>
                    </button>
                  ))}
                </div>
                {purpose !== 'general' && (
                  <p className="mt-1.5 text-[11px] text-indigo-600 bg-indigo-50 rounded-lg px-3 py-1.5">
                    Text placeholders like <code className="font-mono bg-white px-1 rounded">{'{{name}}'}</code>, <code className="font-mono bg-white px-1 rounded">{'{{class}}'}</code> will be replaced with real data when printing.
                  </p>
                )}
              </div>

              {/* Preset Sizes */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Preset Size</label>
                <div className="grid grid-cols-3 gap-2">
                  {PRESET_SIZES.map((preset) => (
                    <button
                      key={preset.key}
                      onClick={() => handlePresetSelect(preset)}
                      className={`p-3 rounded-xl border-2 text-left transition-all ${
                        selectedPreset === preset.key && !isCustomSize
                          ? 'border-indigo-500 bg-indigo-50'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="text-sm font-medium text-slate-800">{preset.label}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{preset.description}</div>
                    </button>
                  ))}
                  <button
                    onClick={() => { setIsCustomSize(true); setSelectedPreset(''); }}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${
                      isCustomSize
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-sm font-medium text-slate-800">Custom</div>
                    <div className="text-xs text-slate-500 mt-0.5">Set your own size</div>
                  </button>
                </div>
              </div>

              {/* Dimensions */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Dimensions</label>
                <div className="flex gap-3 items-end">
                  <div className="flex-1">
                    <span className="text-xs text-slate-500 mb-1 block">Width</span>
                    <input
                      type="number"
                      value={widthVal}
                      onChange={(e) => { setIsCustomSize(true); setSelectedPreset(''); setWidthVal(Number(e.target.value)); }}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  <div className="pb-2 text-slate-400 font-medium">×</div>
                  <div className="flex-1">
                    <span className="text-xs text-slate-500 mb-1 block">Height</span>
                    <input
                      type="number"
                      value={heightVal}
                      onChange={(e) => { setIsCustomSize(true); setSelectedPreset(''); setHeightVal(Number(e.target.value)); }}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  <div className="flex-1">
                    <span className="text-xs text-slate-500 mb-1 block">Unit</span>
                    <select
                      value={unit}
                      onChange={(e) => handleUnitChange(e.target.value as Unit)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    >
                      <option value="px">px</option>
                      <option value="cm">cm</option>
                      <option value="in">in</option>
                      <option value="mm">mm</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* DPI */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Resolution (DPI)</label>
                <div className="flex gap-2">
                  {([72, 96, 150, 300] as DPI[]).map((d) => (
                    <button
                      key={d}
                      onClick={() => handleDpiChange(d)}
                      className={`flex-1 py-2 text-sm rounded-lg border-2 font-medium transition-all ${
                        dpi === d ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {dpi === 72 ? 'Screen / Web' : dpi === 96 ? 'Standard Web' : dpi === 150 ? 'Medium Quality Print' : 'High Quality Print'}
                </p>
              </div>

              {/* Background Color + Color Mode */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Background Color</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={bgColor}
                      onChange={(e) => setBgColor(e.target.value)}
                      className="w-10 h-10 rounded-lg cursor-pointer border border-slate-300"
                    />
                    <span className="text-sm text-slate-600 font-mono">{bgColor.toUpperCase()}</span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Color Mode</label>
                  <div className="flex items-center gap-2 h-10">
                    <span className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium">RGB</span>
                    <span className="text-xs text-slate-400">ICC: sRGB</span>
                  </div>
                </div>
              </div>

              {/* Bit Depth */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Bit Depth (per channel)</label>
                <div className="flex gap-2">
                  {([8, 16, 32] as BitDepth[]).map((b) => (
                    <button
                      key={b}
                      onClick={() => setBitDepth(b)}
                      className={`flex-1 py-2 text-sm rounded-lg border-2 font-medium transition-all ${
                        bitDepth === b ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {b}-bit
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {bitDepth === 8 ? 'Standard — suitable for most designs' : bitDepth === 16 ? 'Extended range — better gradients' : '32-bit HDR — maximum fidelity'}
                </p>
              </div>

              {/* Preview Summary */}
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-sm text-slate-600">
                <div className="font-medium text-slate-800 mb-2">Project Summary</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-slate-500">Canvas size:</span>
                  <span className="font-medium">{unitToPx(widthVal, unit, dpi)} × {unitToPx(heightVal, unit, dpi)} px</span>
                  <span className="text-slate-500">Resolution:</span>
                  <span className="font-medium">{dpi} DPI</span>
                  <span className="text-slate-500">Color mode:</span>
                  <span className="font-medium">RGB / sRGB</span>
                  <span className="text-slate-500">Bit depth:</span>
                  <span className="font-medium">{bitDepth}-bit</span>
                  <span className="text-slate-500">Purpose:</span>
                  <span className="font-medium">{PURPOSE_OPTIONS.find((p) => p.id === purpose)?.label ?? purpose}</span>
                </div>
              </div>
            </div>
          )}

          {tab === 'template' && (
            <div className="space-y-6">
              {/* Student Templates */}
              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                  <span>🎓</span> Student Templates
                </h4>
                <div className="grid grid-cols-3 gap-3">
                  {STUDENT_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      onClick={() => handleApplyTemplate(preset.design)}
                      className="rounded-xl border-2 border-indigo-100 bg-white hover:border-indigo-400 hover:shadow-md transition-all text-left overflow-hidden group"
                    >
                      <div className="h-20 bg-gradient-to-br from-indigo-50 to-blue-50 flex items-center justify-center text-4xl">
                        {preset.emoji}
                      </div>
                      <div className="p-3">
                        <div className="text-sm font-semibold text-slate-800">{preset.label}</div>
                        <div className="mt-1 inline-block px-2 py-0.5 text-[10px] rounded-full bg-indigo-100 text-indigo-600 font-medium">Student</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Staff Templates */}
              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                  <span>👨‍🏫</span> Staff Templates
                </h4>
                <div className="grid grid-cols-3 gap-3">
                  {STAFF_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      onClick={() => handleApplyTemplate(preset.design)}
                      className="rounded-xl border-2 border-emerald-100 bg-white hover:border-emerald-400 hover:shadow-md transition-all text-left overflow-hidden group"
                    >
                      <div className="h-20 bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center text-4xl">
                        {preset.emoji}
                      </div>
                      <div className="p-3">
                        <div className="text-sm font-semibold text-slate-800">{preset.label}</div>
                        <div className="mt-1 inline-block px-2 py-0.5 text-[10px] rounded-full bg-emerald-100 text-emerald-600 font-medium">Staff</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer (blank tab only) */}
        {tab === 'blank' && (
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
            <button onClick={onClose} className="px-5 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors">
              Cancel
            </button>
            <button onClick={handleCreateBlank} className="px-5 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
              Create
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
