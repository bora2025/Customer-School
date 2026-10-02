'use client';

import { ChangeEvent, useState, useRef, useCallback } from 'react';
import CropModal from './CropModal';
import {
  CardDesign, CardSize, CARD_SIZE_PRESETS,
  TextElement, LogoElement, ShapeElement, GradientStop,
  PhotoPlaceholder, QrPlaceholder, FONT_OPTIONS, CARD_TYPE_FIELDS,
} from './types';

interface ToolbarProps {
  design: CardDesign;
  selectedId: string | null;
  onDesignChange: (design: CardDesign) => void;
  onSelect?: (id: string | null) => void;
  width?: number;
  lockedType?: string | null;
}

type Tab = 'size' | 'colors' | 'text' | 'shapes' | 'images' | 'photo' | 'qr' | 'fields';

/* ── Tab definitions ─────────────────────────────────────────────────────── */
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'size', label: 'Size',
    icon: <svg viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><rect x="3" y="5" width="14" height="10" rx="1.5"/><line x1="7" y1="5" x2="7" y2="15" strokeDasharray="2 2"/><line x1="13" y1="5" x2="13" y2="15" strokeDasharray="2 2"/></svg>,
  },
  {
    id: 'colors', label: 'Colors',
    icon: <svg viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M10 3a7 7 0 1 0 7 7" strokeLinecap="round"/><path d="M10 3c1.3 2.5 1.3 4.5 0 7s-1.3 4.5 0 7" strokeLinecap="round"/><path d="M3 10h14" strokeLinecap="round"/><circle cx="15.5" cy="15.5" r="2.5" fill="currentColor" stroke="none"/></svg>,
  },
  {
    id: 'text', label: 'Text',
    icon: <svg viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="currentColor"><path d="M3.5 5h13v1.8H11v8.2H9V6.8H3.5z"/></svg>,
  },
  {
    id: 'shapes', label: 'Shapes',
    icon: <svg viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="9" width="6.5" height="6.5" rx="1"/><circle cx="14" cy="6.5" r="3.5"/><path d="M10 16l3.5-6"/></svg>,
  },
  {
    id: 'images', label: 'Images',
    icon: <svg viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="14" height="12" rx="1.5"/><circle cx="7.5" cy="8" r="1.5"/><path d="M3 14l4-4 3 3 2-2 5 5"/></svg>,
  },
  {
    id: 'photo', label: 'Photo',
    icon: <svg viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><circle cx="10" cy="9" r="3"/><path d="M4 17c0-3.31 2.69-6 6-6s6 2.69 6 6"/><circle cx="10" cy="9" r="7"/></svg>,
  },
  {
    id: 'qr', label: 'QR',
    icon: <svg viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="currentColor"><path d="M3 3h6v6H3V3zm2 2v2h2V5H5zM11 3h6v6h-6V3zm2 2v2h2V5h-2zM3 11h6v6H3v-6zm2 2v2h2v-2H5zM13 11h2v2h-2zM15 13h2v2h-2zM13 15h2v2h-2z"/></svg>,
  },
  {
    id: 'fields', label: 'Fields',
    icon: <svg viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><path d="M4 6h12M4 10h8M4 14h5"/><circle cx="16" cy="14" r="2.5"/><path d="M16 11.5V9"/></svg>,
  },
];

/* ── Shared small components ─────────────────────────────────────────────── */
function PanelLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">{children}</p>;
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[10px] text-slate-400 uppercase tracking-wide">{label}</span>
      <div className="flex-1 flex items-center gap-1">{children}</div>
    </div>
  );
}

function NumInput({ value, onChange, min, max, step }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full text-xs text-center rounded-md border border-slate-700 bg-slate-800 text-slate-200 px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 [appearance:textfield]"
    />
  );
}

function SliderRow({ label, value, min, max, onChange, unit = '' }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; unit?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</span>
        <span className="text-[10px] font-mono text-slate-300">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 accent-indigo-500 cursor-pointer" />
    </div>
  );
}

function ColorSwatch({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <label className="relative cursor-pointer group" title={label}>
      <div className="w-7 h-7 rounded-md border border-slate-600 overflow-hidden transition-transform group-hover:scale-105 shadow-sm"
        style={{ backgroundColor: value }}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
          className="opacity-0 absolute inset-0 w-full h-full cursor-pointer" />
      </div>
    </label>
  );
}

function HexInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value); }}
      maxLength={7}
      className="w-full text-[10px] font-mono rounded-md border border-slate-700 bg-slate-800 text-slate-300 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
    />
  );
}

function TogglePill({ active, onToggle, label }: { active: boolean; onToggle: () => void; label: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-slate-300 font-medium">{label}</span>
      <button
        onClick={onToggle}
        className={`relative w-9 h-5 rounded-full transition-colors ${active ? 'bg-indigo-500' : 'bg-slate-600'}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${active ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────────────── */
export default function Toolbar({ design, selectedId, onDesignChange, onSelect, lockedType }: ToolbarProps) {
  const [activeTab, setActiveTab] = useState<Tab>('text');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [removingBg, setRemovingBg] = useState<Record<string, boolean>>({});
  const [bgError, setBgError] = useState<Record<string, string>>({});
  const [cropLogoId, setCropLogoId] = useState<string | null>(null);

  const update = (partial: Partial<CardDesign>) => onDesignChange({ ...design, ...partial });
  const genId = () => Math.random().toString(36).slice(2, 10);

  const getMaxZ = () => {
    const all = [...design.texts.map((t) => t.zIndex ?? 0), ...design.logos.map((l) => l.zIndex ?? 0),
      ...(design.shapes ?? []).map((s) => s.zIndex ?? 0), ...(design.photo ? [design.photo.zIndex ?? 0] : []),
      ...(design.qr ? [design.qr.zIndex ?? 0] : [])];
    return all.length ? Math.max(...all) : 0;
  };

  const handleSizePreset = (size: CardSize) => {
    if (size === 'custom') { update({ size }); }
    else { const p = CARD_SIZE_PRESETS[size]; update({ size, width: p.width, height: p.height }); }
  };

  /* Text */
  const addText = () => {
    const n: TextElement = { id: genId(), content: 'New Text', x: 20, y: 20 + design.texts.length * 30, fontSize: 16, color: '#f1f5f9', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left', fontFamily: 'Inter, sans-serif', zIndex: getMaxZ() + 1 };
    update({ texts: [...design.texts, n] });
    onSelect?.(n.id);
  };
  const deleteText = (id: string) => { update({ texts: design.texts.filter((t) => t.id !== id) }); if (selectedId === id) onSelect?.(null); };
  const updateText = (id: string, changes: Partial<TextElement>) => update({ texts: design.texts.map((t) => t.id === id ? { ...t, ...changes } : t) });

  /* Logos */
  const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const n: LogoElement = { id: genId(), src: reader.result as string, name: file.name, x: 20, y: 20, width: 80, height: 80, zIndex: getMaxZ() + 1 };
      update({ logos: [...design.logos, n] });
      onSelect?.(n.id);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };
  const deleteLogo = (id: string) => { update({ logos: design.logos.filter((l) => l.id !== id) }); if (selectedId === id) onSelect?.(null); };
  const updateLogo = (id: string, changes: Partial<LogoElement>) => update({ logos: design.logos.map((l) => l.id === id ? { ...l, ...changes } : l) });

  const handleRemoveBg = useCallback(async (logo: LogoElement) => {
    const logoId = logo.id;
    const existingOriginalSrc = logo.originalSrc;
    setBgError((p) => { const n = { ...p }; delete n[logoId]; return n; });
    setRemovingBg((p) => ({ ...p, [logoId]: true }));
    try {
      const { removeBackground } = await import('@imgly/background-removal');
      // Use the library's default CDN (staticimgly.com) which hosts the ONNX model data
      const blob = await removeBackground(logo.src);
      const newSrc = await new Promise<string>((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result as string);
        fr.readAsDataURL(blob);
      });
      onDesignChange({
        ...design,
        logos: design.logos.map((l) =>
          l.id === logoId ? { ...l, src: newSrc, originalSrc: existingOriginalSrc ?? logo.src, removeBg: false } : l
        ),
      });
    } catch (err) {
      console.error('Background removal failed', err);
      setBgError((p) => ({ ...p, [logoId]: 'Failed to remove background. Check your connection and try again.' }));
    } finally {
      setRemovingBg((p) => { const n = { ...p }; delete n[logoId]; return n; });
    }
  }, [design, onDesignChange]);

  /* Shapes */
  const addShape = (type: 'rectangle' | 'circle' | 'line') => {
    const n: ShapeElement = { id: genId(), type, x: 20, y: 20 + (design.shapes ?? []).length * 20, width: type === 'line' ? 120 : 80, height: type === 'line' ? 4 : 60, color: '#6366f1', borderColor: '#4338ca', borderWidth: type === 'line' ? 2 : 0, borderRadius: type === 'circle' ? 9999 : 8, opacity: 1, rotation: 0, zIndex: getMaxZ() + 1, lineStyle: type === 'line' ? 'solid' : undefined, gradient: { enabled: false, type: 'linear', angle: 90, stops: [{ offset: 0, color: '#6366f1' }, { offset: 1, color: '#06b6d4' }] } };
    update({ shapes: [...(design.shapes ?? []), n] });
    onSelect?.(n.id);
  };
  const deleteShape = (id: string) => { update({ shapes: (design.shapes ?? []).filter((s) => s.id !== id) }); if (selectedId === id) onSelect?.(null); };
  const updateShape = (id: string, changes: Partial<ShapeElement>) => update({ shapes: (design.shapes ?? []).map((s) => s.id === id ? { ...s, ...changes } : s) });
  const updateGradStop = (shapeId: string, idx: number, changes: Partial<GradientStop>) => {
    const s = (design.shapes ?? []).find((s) => s.id === shapeId); if (!s) return;
    updateShape(shapeId, { gradient: { ...s.gradient, stops: s.gradient.stops.map((st, i) => i === idx ? { ...st, ...changes } : st) } });
  };
  const addGradStop = (shapeId: string) => {
    const s = (design.shapes ?? []).find((s) => s.id === shapeId); if (!s) return;
    updateShape(shapeId, { gradient: { ...s.gradient, stops: [...s.gradient.stops, { offset: 1, color: '#f59e0b' }] } });
  };
  const removeGradStop = (shapeId: string, idx: number) => {
    const s = (design.shapes ?? []).find((s) => s.id === shapeId); if (!s || s.gradient.stops.length <= 2) return;
    updateShape(shapeId, { gradient: { ...s.gradient, stops: s.gradient.stops.filter((_, i) => i !== idx) } });
  };

  /* Photo / QR */
  const togglePhoto = () => {
    if (design.photo) { update({ photo: null }); if (selectedId === '__photo__') onSelect?.(null); }
    else { update({ photo: { x: 15, y: 55, width: 70, height: 85, borderRadius: 6, borderColor: design.frameColor, borderWidth: 2 } }); onSelect?.('__photo__'); }
  };
  const updatePhoto = (changes: Partial<PhotoPlaceholder>) => { if (!design.photo) return; update({ photo: { ...design.photo, ...changes } }); };
  const toggleQr = () => {
    if (design.qr) { update({ qr: null }); if (selectedId === '__qr__') onSelect?.(null); }
    else { update({ qr: { x: design.width - 100, y: design.height - 100, size: 80, width: 80, height: 80, borderRadius: 0, borderColor: '#64748b', borderWidth: 1 } }); onSelect?.('__qr__'); }
  };
  const updateQr = (changes: Partial<QrPlaceholder>) => { if (!design.qr) return; update({ qr: { ...design.qr, ...changes } }); };

  const selectedText = design.texts.find((t) => t.id === selectedId);
  const selectedLogo = design.logos.find((l) => l.id === selectedId);
  const selectedShape = (design.shapes ?? []).find((s) => s.id === selectedId);

  /* ── Render ── */
  return (
    <div className="flex h-full bg-[#1e1e1e] text-slate-200">

      {/* ── Icon rail (dark) ── */}
      <div className="flex flex-col items-center gap-0 py-1.5 px-0.5 bg-[#141414] border-r border-[#2d2d2d] shrink-0 w-[48px] overflow-hidden">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
            className={`flex flex-col items-center justify-center gap-0.5 w-10 h-[40px] rounded-lg transition-all text-[8px] font-semibold tracking-wide select-none flex-shrink-0
              ${activeTab === tab.id
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/50'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
              }`}
          >
            {tab.icon}
            <span className="leading-none uppercase">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ── Panel body ── */}
      <div className="flex-1 overflow-y-auto min-w-0">

        {/* ━━ SIZE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {activeTab === 'size' && (
          <div className="p-3 space-y-4">
            <PanelLabel>Preset</PanelLabel>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(CARD_SIZE_PRESETS) as Array<keyof typeof CARD_SIZE_PRESETS>).map((key) => (
                <button key={key} onClick={() => handleSizePreset(key)}
                  className={`text-left px-2.5 py-2 rounded-lg border text-xs transition-all leading-tight
                    ${design.size === key ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600 hover:bg-slate-750'}`}
                >
                  <span className="block font-semibold truncate">{CARD_SIZE_PRESETS[key].label.split(' (')[0]}</span>
                  <span className="block text-[9px] opacity-60">{CARD_SIZE_PRESETS[key].width}×{CARD_SIZE_PRESETS[key].height}</span>
                </button>
              ))}
              <button onClick={() => handleSizePreset('custom')}
                className={`text-left px-2.5 py-2 rounded-lg border text-xs transition-all
                  ${design.size === 'custom' ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'}`}
              >
                <span className="font-semibold">Custom</span>
              </button>
            </div>
            {design.size === 'custom' && (
              <div>
                <PanelLabel>Dimensions</PanelLabel>
                <div className="flex gap-2">
                  <div className="flex-1"><p className="text-[9px] text-slate-500 mb-1 text-center">W</p><NumInput value={design.width} onChange={(v) => update({ width: Math.max(100, v) })} min={100} /></div>
                  <div className="flex items-end pb-1.5 text-slate-600 text-xs">×</div>
                  <div className="flex-1"><p className="text-[9px] text-slate-500 mb-1 text-center">H</p><NumInput value={design.height} onChange={(v) => update({ height: Math.max(100, v) })} min={100} /></div>
                </div>
              </div>
            )}
            <div className="pt-1 border-t border-slate-800">
              <p className="text-[10px] text-slate-500 text-center">{design.width} × {design.height} px</p>
            </div>
          </div>
        )}

        {/* ━━ COLORS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {activeTab === 'colors' && (
          <div className="p-3 space-y-4">
            <PanelLabel>Background</PanelLabel>
            <div className="flex items-center gap-2.5">
              <ColorSwatch value={design.backgroundColor ?? '#ffffff'} onChange={(v) => update({ backgroundColor: v })} label="Background" />
              <HexInput value={design.backgroundColor ?? '#ffffff'} onChange={(v) => update({ backgroundColor: v })} />
            </div>
            <div className="border-t border-slate-800 pt-3">
              <PanelLabel>Frame</PanelLabel>
              <div className="flex items-center gap-2.5 mb-3">
                <ColorSwatch value={design.frameColor ?? '#000000'} onChange={(v) => update({ frameColor: v })} label="Frame Color" />
                <HexInput value={design.frameColor ?? '#000000'} onChange={(v) => update({ frameColor: v })} />
              </div>
              <SliderRow label="Frame Width" value={design.frameWidth ?? 0} min={0} max={12} onChange={(v) => update({ frameWidth: v })} unit="px" />
            </div>
          </div>
        )}

        {/* ━━ TEXT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {activeTab === 'text' && (
          <div className="p-2.5 space-y-2">
            <div className="flex items-center justify-between px-0.5 mb-1">
              <PanelLabel>Text Layers</PanelLabel>
              <span className="text-[9px] text-slate-600 bg-slate-800 px-1.5 py-0.5 rounded font-mono">{design.texts.length}</span>
            </div>
            <button onClick={addText}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors shadow-sm shadow-indigo-900/40">
              <svg viewBox="0 0 14 14" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M7 2v10M2 7h10"/></svg>
              Add Text
            </button>

            {design.texts.length === 0 && (
              <div className="py-8 text-center">
                <div className="text-3xl mb-2 opacity-30">T</div>
                <p className="text-[11px] text-slate-600">No text elements yet.</p>
              </div>
            )}

            {design.texts.map((text) => {
              const isSel = selectedId === text.id;
              return (
                <div key={text.id}
                  className={`rounded-lg border overflow-hidden transition-all ${isSel ? 'border-indigo-500 bg-slate-800/80 shadow-md shadow-indigo-900/30' : 'border-slate-800 hover:border-slate-700 bg-slate-900'}`}
                >
                  {/* Row */}
                  <div className="flex items-center gap-2 px-2.5 py-2 cursor-pointer group" onClick={() => onSelect?.(isSel ? null : text.id)}>
                    <svg viewBox="0 0 16 16" className={`w-3 h-3 shrink-0 ${isSel ? 'text-indigo-400' : 'text-slate-600'}`} fill="currentColor"><path d="M2 3h12v1.8H9v7.2H7V4.8H2z"/></svg>
                    <span className="flex-1 text-xs truncate text-slate-300">{text.content || '(empty)'}</span>
                    <span className="text-[9px] font-mono text-slate-600 shrink-0">{text.fontSize}px</span>
                    <button onClick={(e) => { e.stopPropagation(); deleteText(text.id); }}
                      className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded text-red-500 hover:bg-red-500/20 transition-all text-[10px]">×</button>
                  </div>

                  {/* Inline editor */}
                  {isSel && selectedText && (
                    <div className="px-2.5 pb-3 pt-2 border-t border-slate-700/60 space-y-3">
                      {/* Content */}
                      <div>
                        <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">Content</p>
                        <textarea value={selectedText.content} onChange={(e) => updateText(selectedText.id, { content: e.target.value })} rows={2}
                          className="w-full text-xs rounded-md border border-slate-700 bg-slate-800 text-slate-200 px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                      </div>

                      {/* Font */}
                      <div>
                        <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">Font Family</p>
                        <select value={selectedText.fontFamily ?? 'Inter, sans-serif'} onChange={(e) => updateText(selectedText.id, { fontFamily: e.target.value })}
                          className="w-full text-xs rounded-md border border-slate-700 bg-slate-800 text-slate-200 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                          {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                      </div>

                      {/* Size */}
                      <SliderRow label="Font Size" value={selectedText.fontSize} min={6} max={96} onChange={(v) => updateText(selectedText.id, { fontSize: v })} unit="px" />

                      {/* Style row */}
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => updateText(selectedText.id, { fontWeight: selectedText.fontWeight === 'bold' ? 'normal' : 'bold' })}
                          className={`w-7 h-7 rounded-md border text-xs font-bold transition-all ${selectedText.fontWeight === 'bold' ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-slate-700 text-slate-400 hover:bg-slate-700'}`}>B</button>
                        <button onClick={() => updateText(selectedText.id, { fontStyle: selectedText.fontStyle === 'italic' ? 'normal' : 'italic' })}
                          className={`w-7 h-7 rounded-md border text-xs italic font-semibold transition-all ${selectedText.fontStyle === 'italic' ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-slate-700 text-slate-400 hover:bg-slate-700'}`}>I</button>
                        <div className="w-px h-4 bg-slate-700 mx-0.5" />
                        {(['left', 'center', 'right'] as const).map((a) => (
                          <button key={a} onClick={() => updateText(selectedText.id, { textAlign: a })}
                            className={`w-7 h-7 rounded-md border flex items-center justify-center transition-all ${selectedText.textAlign === a ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-slate-700 text-slate-500 hover:bg-slate-700'}`}>
                            {a === 'left' && <svg viewBox="0 0 12 10" className="w-3 h-3" fill="currentColor"><rect x="0" y="0" width="12" height="2"/><rect x="0" y="4" width="8" height="2"/><rect x="0" y="8" width="10" height="2"/></svg>}
                            {a === 'center' && <svg viewBox="0 0 12 10" className="w-3 h-3" fill="currentColor"><rect x="0" y="0" width="12" height="2"/><rect x="2" y="4" width="8" height="2"/><rect x="1" y="8" width="10" height="2"/></svg>}
                            {a === 'right' && <svg viewBox="0 0 12 10" className="w-3 h-3" fill="currentColor"><rect x="0" y="0" width="12" height="2"/><rect x="4" y="4" width="8" height="2"/><rect x="2" y="8" width="10" height="2"/></svg>}
                          </button>
                        ))}
                        <div className="w-px h-4 bg-slate-700 mx-0.5" />
                        <label className="relative cursor-pointer group" title="Text Color">
                          <div className="w-7 h-7 rounded-md border border-slate-700 overflow-hidden relative hover:scale-105 transition-transform">
                            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold" style={{ color: selectedText.color }}>A</span>
                            <div className="absolute bottom-0.5 left-1 right-1 h-1 rounded-sm" style={{ backgroundColor: selectedText.color }} />
                            <input type="color" value={selectedText.color} onChange={(e) => updateText(selectedText.id, { color: e.target.value })} className="opacity-0 absolute inset-0 w-full h-full cursor-pointer" />
                          </div>
                        </label>
                      </div>

                      {/* X / Y */}
                      <div>
                        <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1.5">Position</p>
                        <div className="flex gap-2">
                          <div className="flex-1"><p className="text-[9px] text-slate-600 mb-1 text-center">X</p><NumInput value={Math.round(selectedText.x)} onChange={(v) => updateText(selectedText.id, { x: v })} /></div>
                          <div className="flex-1"><p className="text-[9px] text-slate-600 mb-1 text-center">Y</p><NumInput value={Math.round(selectedText.y)} onChange={(v) => updateText(selectedText.id, { y: v })} /></div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ━━ SHAPES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {activeTab === 'shapes' && (
          <div className="p-2.5 space-y-2">
            <PanelLabel>Add Shape</PanelLabel>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                { type: 'rectangle' as const, label: 'Rect', icon: <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8}><rect x="2" y="4" width="12" height="8" rx="1.5"/></svg> },
                { type: 'circle' as const, label: 'Circle', icon: <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx="8" cy="8" r="5.5"/></svg> },
                { type: 'line' as const, label: 'Line', icon: <svg viewBox="0 0 16 16" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="2" y1="8" x2="14" y2="8"/></svg> },
              ]).map(({ type, label, icon }) => (
                <button key={type} onClick={() => addShape(type)}
                  className="flex flex-col items-center gap-1 py-2.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:border-indigo-500 hover:text-indigo-400 hover:bg-slate-800 transition-all text-[10px] font-medium">
                  {icon}{label}
                </button>
              ))}
            </div>

            {(design.shapes ?? []).length === 0 && <div className="py-6 text-center text-[11px] text-slate-600">No shapes yet.</div>}

            {(design.shapes ?? []).map((shape) => {
              const isSel = selectedId === shape.id;
              const gradBg = shape.gradient?.enabled
                ? (shape.gradient.type === 'linear'
                  ? `linear-gradient(${shape.gradient.angle}deg, ${shape.gradient.stops.map(s => `${s.color} ${s.offset * 100}%`).join(', ')})`
                  : `radial-gradient(circle, ${shape.gradient.stops.map(s => `${s.color} ${s.offset * 100}%`).join(', ')})`)
                : undefined;
              return (
                <div key={shape.id}
                  className={`rounded-lg border overflow-hidden transition-all ${isSel ? 'border-indigo-500 bg-slate-800/80 shadow-md shadow-indigo-900/30' : 'border-slate-800 hover:border-slate-700'}`}>
                  <div className="flex items-center gap-2 px-2.5 py-2 cursor-pointer group" onClick={() => onSelect?.(isSel ? null : shape.id)}>
                    <span className="w-4 h-4 rounded shrink-0 border border-slate-700"
                      style={{ backgroundColor: gradBg ? undefined : shape.color, backgroundImage: gradBg, borderRadius: shape.type === 'circle' ? '50%' : shape.borderRadius }} />
                    <span className="flex-1 text-xs capitalize text-slate-300">{shape.type}</span>
                    <span className="text-[9px] font-mono text-slate-600">{shape.width}×{shape.height}</span>
                    <button onClick={(e) => { e.stopPropagation(); deleteShape(shape.id); }}
                      className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded text-red-500 hover:bg-red-500/20 transition-all text-[10px]">×</button>
                  </div>

                  {isSel && selectedShape && (
                    <div className="px-2.5 pb-3 pt-2 border-t border-slate-700/60 space-y-3">
                      {/* W H */}
                      <div>
                        <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1.5">Size</p>
                        <div className="flex gap-2">
                          <div className="flex-1"><p className="text-[9px] text-slate-600 mb-1 text-center">W</p><NumInput value={selectedShape.width} onChange={(v) => updateShape(selectedShape.id, { width: Math.max(2, v) })} min={2} /></div>
                          <div className="flex-1"><p className="text-[9px] text-slate-600 mb-1 text-center">H</p><NumInput value={selectedShape.height} onChange={(v) => updateShape(selectedShape.id, { height: Math.max(2, v) })} min={2} /></div>
                        </div>
                      </div>
                      {/* X Y */}
                      <div>
                        <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1.5">Position</p>
                        <div className="flex gap-2">
                          <div className="flex-1"><p className="text-[9px] text-slate-600 mb-1 text-center">X</p><NumInput value={Math.round(selectedShape.x)} onChange={(v) => updateShape(selectedShape.id, { x: v })} /></div>
                          <div className="flex-1"><p className="text-[9px] text-slate-600 mb-1 text-center">Y</p><NumInput value={Math.round(selectedShape.y)} onChange={(v) => updateShape(selectedShape.id, { y: v })} /></div>
                        </div>
                      </div>
                      {/* Fill */}
                      {selectedShape.type !== 'line' && (
                        <div>
                          <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1.5">Fill</p>
                          <div className="flex items-center gap-2">
                            <ColorSwatch value={selectedShape.color ?? '#6366f1'} onChange={(v) => updateShape(selectedShape.id, { color: v })} />
                            <HexInput value={selectedShape.color ?? '#6366f1'} onChange={(v) => updateShape(selectedShape.id, { color: v })} />
                          </div>
                        </div>
                      )}
                      {/* Border */}
                      {selectedShape.type !== 'line' && (
                        <div>
                          <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1.5">Border</p>
                          <div className="flex items-center gap-2 mb-2">
                            <ColorSwatch value={selectedShape.borderColor ?? '#1e293b'} onChange={(v) => updateShape(selectedShape.id, { borderColor: v })} />
                            <HexInput value={selectedShape.borderColor ?? '#1e293b'} onChange={(v) => updateShape(selectedShape.id, { borderColor: v })} />
                          </div>
                          <SliderRow label="Width" value={selectedShape.borderWidth ?? 0} min={0} max={10} onChange={(v) => updateShape(selectedShape.id, { borderWidth: v })} unit="px" />
                          {selectedShape.type === 'rectangle' && (
                            <div className="mt-2">
                              <SliderRow label="Radius" value={selectedShape.borderRadius ?? 0} min={0} max={50} onChange={(v) => updateShape(selectedShape.id, { borderRadius: v })} unit="px" />
                            </div>
                          )}
                        </div>
                      )}
                      {/* Line */}
                      {selectedShape.type === 'line' && (
                        <div className="space-y-2">
                          <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">Line Color</p>
                          <div className="flex items-center gap-2 mb-1">
                            <ColorSwatch value={selectedShape.borderColor ?? '#94a3b8'} onChange={(v) => updateShape(selectedShape.id, { borderColor: v })} />
                            <HexInput value={selectedShape.borderColor ?? '#94a3b8'} onChange={(v) => updateShape(selectedShape.id, { borderColor: v })} />
                          </div>
                          <SliderRow label="Thickness" value={selectedShape.borderWidth ?? 1} min={0.5} max={20} onChange={(v) => updateShape(selectedShape.id, { borderWidth: v })} unit="pt" />
                          <div>
                            <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1.5">Style</p>
                            <div className="flex gap-1">
                              {(['solid', 'dashed', 'dotted'] as const).map((s) => (
                                <button key={s} onClick={() => updateShape(selectedShape.id, { lineStyle: s })}
                                  className={`flex-1 py-1 text-[10px] rounded-md border transition-colors ${(selectedShape.lineStyle ?? 'solid') === s ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-slate-700 text-slate-400 hover:bg-slate-700'}`}>
                                  {s === 'solid' ? '—' : s === 'dashed' ? '- -' : '···'}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                      {/* Opacity / Rotation */}
                      <SliderRow label="Opacity" value={Math.round((selectedShape.opacity ?? 1) * 100)} min={0} max={100} onChange={(v) => updateShape(selectedShape.id, { opacity: v / 100 })} unit="%" />
                      <SliderRow label="Rotation" value={Math.round(selectedShape.rotation ?? 0)} min={0} max={360} onChange={(v) => updateShape(selectedShape.id, { rotation: v })} unit="°" />

                      {/* Gradient */}
                      <div className="border-t border-slate-700/60 pt-2">
                        <TogglePill active={selectedShape.gradient.enabled} onToggle={() => updateShape(selectedShape.id, { gradient: { ...selectedShape.gradient, enabled: !selectedShape.gradient.enabled } })} label="Gradient Fill" />
                        {selectedShape.gradient.enabled && (
                          <div className="mt-2 space-y-2">
                            <div className="w-full h-4 rounded-md border border-slate-700" style={{ backgroundImage: selectedShape.gradient.type === 'linear' ? `linear-gradient(${selectedShape.gradient.angle}deg, ${selectedShape.gradient.stops.map(s => `${s.color} ${s.offset * 100}%`).join(', ')})` : `radial-gradient(circle, ${selectedShape.gradient.stops.map(s => `${s.color} ${s.offset * 100}%`).join(', ')})` }} />
                            <div className="flex gap-1">
                              {(['linear', 'radial'] as const).map((t) => (
                                <button key={t} onClick={() => updateShape(selectedShape.id, { gradient: { ...selectedShape.gradient, type: t } })}
                                  className={`flex-1 py-1 text-[10px] rounded-md border transition-colors capitalize ${selectedShape.gradient.type === t ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-slate-700 text-slate-400 hover:bg-slate-700'}`}>{t}</button>
                              ))}
                            </div>
                            {selectedShape.gradient.type === 'linear' && (
                              <SliderRow label="Angle" value={selectedShape.gradient.angle} min={0} max={360} onChange={(v) => updateShape(selectedShape.id, { gradient: { ...selectedShape.gradient, angle: v } })} unit="°" />
                            )}
                            <div className="space-y-1.5">
                              <p className="text-[9px] text-slate-500 uppercase tracking-widest">Stops</p>
                              {selectedShape.gradient.stops.map((stop, idx) => (
                                <div key={idx} className="flex items-center gap-1.5">
                                  <input type="color" value={stop.color} onChange={(e) => updateGradStop(selectedShape.id, idx, { color: e.target.value })} className="w-5 h-5 rounded cursor-pointer border border-slate-700 bg-transparent" />
                                  <input type="range" min={0} max={100} value={Math.round(stop.offset * 100)} onChange={(e) => updateGradStop(selectedShape.id, idx, { offset: Number(e.target.value) / 100 })} className="flex-1 accent-indigo-500 h-1.5" />
                                  <span className="text-[9px] text-slate-500 w-5">{Math.round(stop.offset * 100)}%</span>
                                  {selectedShape.gradient.stops.length > 2 && <button onClick={() => removeGradStop(selectedShape.id, idx)} className="text-red-500 text-xs w-4">×</button>}
                                </div>
                              ))}
                              <button onClick={() => addGradStop(selectedShape.id)} className="text-[10px] text-indigo-400 hover:text-indigo-300">+ Add Stop</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ━━ IMAGES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {activeTab === 'images' && (() => {
          return (
          <div className="p-2.5 space-y-2">
            <PanelLabel>Logos & Images</PanelLabel>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
            <button onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors shadow-sm shadow-indigo-900/40">
              <svg viewBox="0 0 14 14" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M7 2v10M2 7h10"/></svg>
              Upload Image
            </button>
            {design.logos.length === 0 && <div className="py-6 text-center text-[11px] text-slate-600">No images uploaded yet.</div>}
            {design.logos.map((logo) => {
              const isSel = selectedId === logo.id;
              return (
                <div key={logo.id}
                  className={`rounded-lg border transition-all ${isSel ? 'border-indigo-500 bg-slate-800/80 shadow-md shadow-indigo-900/30' : 'border-slate-800 hover:border-slate-700 bg-slate-900'}`}>
                  <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer group" onClick={() => onSelect?.(isSel ? null : logo.id)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logo.src} alt={logo.name} className="w-8 h-8 object-contain rounded-md border border-slate-700 bg-slate-800 shrink-0" />
                    <span className="flex-1 text-xs truncate text-slate-300">{logo.name}</span>
                    {isSel && <span className="text-[9px] text-indigo-400 shrink-0">Selected</span>}
                    <button onClick={(e) => { e.stopPropagation(); deleteLogo(logo.id); }}
                      className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded text-red-500 hover:bg-red-500/20 transition-all text-[10px] shrink-0">×</button>
                  </div>

                  {/* ── Per-image properties (shown when selected) ── */}
                  {isSel && (
                    <div className="px-2.5 pb-3 space-y-3 border-t border-slate-700/60 pt-2.5">

                      {/* Size & Position */}
                      <div>
                        <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1.5">Size & Position</p>
                        <div className="grid grid-cols-4 gap-1">
                          {([['width','W'],['height','H'],['x','X'],['y','Y']] as [keyof typeof logo, string][]).map(([k, label]) => (
                            <div key={k}>
                              <p className="text-[9px] text-slate-600 mb-0.5 text-center">{label}</p>
                              <NumInput value={logo[k] as number} onChange={(v) => updateLogo(logo.id, { [k]: (k === 'width' || k === 'height') ? Math.max(4, v) : v })} min={(k === 'width' || k === 'height') ? 4 : undefined} />
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Opacity */}
                      <SliderRow label="Opacity" value={Math.round((logo.opacity ?? 1) * 100)} min={0} max={100} onChange={(v) => updateLogo(logo.id, { opacity: v / 100 })} unit="%" />

                      {/* Blur */}
                      <SliderRow label="Blur" value={logo.blur ?? 0} min={0} max={20} onChange={(v) => updateLogo(logo.id, { blur: v })} unit="px" />

                      {/* Border Radius */}
                      <SliderRow label="Radius" value={logo.borderRadius ?? 0} min={0} max={Math.floor(Math.min(logo.width, logo.height) / 2)} onChange={(v) => updateLogo(logo.id, { borderRadius: v })} unit="px" />

                      {/* Remove Background */}
                      <div>
                        <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1.5">Background Removal</p>
                        {removingBg[logo.id] ? (
                          <div className="flex items-center justify-center gap-2 py-2 rounded-lg bg-slate-800 border border-slate-700">
                            <svg className="w-3.5 h-3.5 text-indigo-400 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                            <span className="text-[11px] text-indigo-300">Removing background…</span>
                          </div>
                        ) : logo.originalSrc ? (
                          <div className="flex gap-1.5">
                            <div className="flex-1 flex items-center gap-1.5 py-1.5 px-2 rounded-lg bg-emerald-900/30 border border-emerald-700/50">
                              <svg viewBox="0 0 16 16" className="w-3 h-3 text-emerald-400 shrink-0" fill="currentColor"><path d="M6.5 11.5L3 8l1-1 2.5 2.5 6-6 1 1z"/></svg>
                              <span className="text-[10px] text-emerald-400">BG removed</span>
                            </div>
                            <button
                              onClick={() => updateLogo(logo.id, { src: logo.originalSrc!, originalSrc: undefined })}
                              className="px-2 py-1.5 rounded-lg text-[10px] text-slate-400 hover:text-red-400 bg-slate-800 hover:bg-red-500/10 border border-slate-700 transition-colors"
                              title="Restore original image"
                            >Restore</button>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => handleRemoveBg(logo)}
                              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-xs font-semibold transition-colors shadow-sm shadow-violet-900/40"
                            >
                              <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M3 17l4-4m0 0l3-3m-3 3l-3-3m6 0l4-4m0 0l3-3m-3 3l-3-3"/><circle cx="15" cy="5" r="2" fill="currentColor" stroke="none"/></svg>
                              Remove Background (AI)
                            </button>
                            {bgError[logo.id] && (
                              <p className="text-[10px] text-red-400 mt-1 leading-relaxed">{bgError[logo.id]}</p>
                            )}
                          </>
                        )}
                      </div>

                      {/* Crop */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[9px] text-slate-500 uppercase tracking-widest">Crop</p>
                          {((logo.cropX ?? 0) > 0 || (logo.cropY ?? 0) > 0 || (logo.cropW ?? 1) < 1 || (logo.cropH ?? 1) < 1) && (
                            <button onClick={() => updateLogo(logo.id, { cropX: 0, cropY: 0, cropW: 1, cropH: 1 })} className="text-[9px] text-red-400 hover:text-red-300 transition-colors">Reset</button>
                          )}
                        </div>
                        <button
                          onClick={() => setCropLogoId(logo.id)}
                          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs transition-colors"
                        >
                          <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 3v4H3M3 3h4M15 17v-4h2m0 4h-4M5 17v-4H3m0 4h4M15 3v4h2M17 3h-4" />
                          </svg>
                          Crop Image
                        </button>
                      </div>

                    </div>
                  )}
                </div>
              );
            })}
          </div>
          );
        })()}

        {/* ━━ PHOTO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {activeTab === 'photo' && (
          <div className="p-3 space-y-3">
            <PanelLabel>Photo Placeholder</PanelLabel>
            <div className="flex items-center gap-3 p-3 rounded-lg border border-slate-700 bg-slate-800">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${design.photo ? 'bg-indigo-600' : 'bg-slate-700'}`}>
                <svg viewBox="0 0 20 20" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><circle cx="10" cy="8" r="3"/><path d="M4 17c0-3.31 2.69-6 6-6s6 2.69 6 6"/><circle cx="10" cy="8" r="7.5"/></svg>
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold text-slate-200">Photo Area</p>
                <p className="text-[10px] text-slate-500">{design.photo ? 'Active on canvas' : 'Not placed'}</p>
              </div>
              <TogglePill active={!!design.photo} onToggle={togglePhoto} label="" />
            </div>
            {design.photo && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <div className="flex-1"><p className="text-[9px] text-slate-600 mb-1 text-center">W</p><NumInput value={design.photo.width} onChange={(v) => updatePhoto({ width: Math.max(20, v) })} min={20} /></div>
                  <div className="flex-1"><p className="text-[9px] text-slate-600 mb-1 text-center">H</p><NumInput value={design.photo.height} onChange={(v) => updatePhoto({ height: Math.max(20, v) })} min={20} /></div>
                  <div className="flex-1"><p className="text-[9px] text-slate-600 mb-1 text-center">X</p><NumInput value={design.photo.x} onChange={(v) => updatePhoto({ x: v })} /></div>
                  <div className="flex-1"><p className="text-[9px] text-slate-600 mb-1 text-center">Y</p><NumInput value={design.photo.y} onChange={(v) => updatePhoto({ y: v })} /></div>
                </div>
                <div className="flex items-center gap-2">
                  <ColorSwatch value={design.photo.borderColor ?? '#000'} onChange={(v) => updatePhoto({ borderColor: v })} label="Border Color" />
                  <HexInput value={design.photo.borderColor ?? '#000000'} onChange={(v) => updatePhoto({ borderColor: v })} />
                </div>
                <SliderRow label="Radius" value={design.photo.borderRadius ?? 0} min={0} max={Math.floor(Math.min(design.photo.width, design.photo.height) / 2)} onChange={(v) => updatePhoto({ borderRadius: v })} unit="px" />
                <SliderRow label="Border W" value={design.photo.borderWidth ?? 0} min={0} max={10} onChange={(v) => updatePhoto({ borderWidth: v })} unit="px" />
              </div>
            )}
          </div>
        )}

        {/* ━━ QR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {activeTab === 'qr' && (
          <div className="p-3 space-y-3">
            <PanelLabel>QR Code</PanelLabel>
            <div className="flex items-center gap-3 p-3 rounded-lg border border-slate-700 bg-slate-800">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${design.qr ? 'bg-indigo-600' : 'bg-slate-700'}`}>
                <svg viewBox="0 0 20 20" className="w-5 h-5" fill="currentColor"><path d="M3 3h6v6H3V3zm2 2v2h2V5H5zM11 3h6v6h-6V3zm2 2v2h2V5h-2zM3 11h6v6H3v-6zm2 2v2h2v-2H5zM13 11h2v2h-2zM15 13h2v2h-2zM13 15h2v2h-2z"/></svg>
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold text-slate-200">QR Code</p>
                <p className="text-[10px] text-slate-500">{design.qr ? 'Active on canvas' : 'Not placed'}</p>
              </div>
              <TogglePill active={!!design.qr} onToggle={toggleQr} label="" />
            </div>
            {design.qr && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <div className="flex-1"><p className="text-[9px] text-slate-600 mb-1 text-center">W</p><NumInput value={design.qr.width} onChange={(v) => updateQr({ width: Math.max(20, v) })} min={20} /></div>
                  <div className="flex-1"><p className="text-[9px] text-slate-600 mb-1 text-center">H</p><NumInput value={design.qr.height} onChange={(v) => updateQr({ height: Math.max(20, v) })} min={20} /></div>
                  <div className="flex-1"><p className="text-[9px] text-slate-600 mb-1 text-center">X</p><NumInput value={design.qr.x} onChange={(v) => updateQr({ x: v })} /></div>
                  <div className="flex-1"><p className="text-[9px] text-slate-600 mb-1 text-center">Y</p><NumInput value={design.qr.y} onChange={(v) => updateQr({ y: v })} /></div>
                </div>
                <div className="flex items-center gap-2">
                  <ColorSwatch value={design.qr.borderColor ?? '#64748b'} onChange={(v) => updateQr({ borderColor: v })} label="Border Color" />
                  <HexInput value={design.qr.borderColor ?? '#64748b'} onChange={(v) => updateQr({ borderColor: v })} />
                </div>
                <SliderRow label="Radius" value={design.qr.borderRadius ?? 0} min={0} max={Math.floor(Math.min(design.qr.width, design.qr.height) / 2)} onChange={(v) => updateQr({ borderRadius: v })} unit="px" />
                <SliderRow label="Border W" value={design.qr.borderWidth ?? 0} min={0} max={10} onChange={(v) => updateQr({ borderWidth: v })} unit="px" />
              </div>
            )}
          </div>
        )}

        {/* ━━ FIELDS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {activeTab === 'fields' && (
          <div className="p-3 space-y-3">
            <PanelLabel>Data Source</PanelLabel>
            {lockedType ? (
              /* Locked workspace — show fixed source badge, no switcher */
              <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-orange-500/40 bg-orange-600/10">
                <span className="text-base">
                  {lockedType === 'teacher-part-time' ? '⏰'
                    : lockedType === 'student' ? '🎓'
                    : lockedType === 'staff' ? '👨‍🏫'
                    : lockedType === 'certificate-student' ? '📜'
                    : lockedType === 'certificate-staff' ? '🏅' : '✏️'}
                </span>
                <div>
                  <p className="text-[10px] font-semibold text-orange-300">
                    {lockedType === 'teacher-part-time' ? 'TPT ID Card'
                      : lockedType === 'student' ? 'Student ID Card'
                      : lockedType === 'staff' ? 'Staff ID Card'
                      : lockedType === 'certificate-student' ? 'Student Certificate'
                      : lockedType === 'certificate-staff' ? 'Staff Certificate' : lockedType}
                  </p>
                  <p className="text-[9px] text-slate-500">Locked workspace</p>
                </div>
              </div>
            ) : (
              /* Free workspace — full type switcher */
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  { id: 'student', label: 'Student', icon: '🎓' },
                  { id: 'staff', label: 'Staff', icon: '👨‍🏫' },
                  { id: 'certificate-student', label: 'Cert · Student', icon: '📜' },
                  { id: 'certificate-staff', label: 'Cert · Staff', icon: '🏅' },
                  { id: 'general', label: 'General', icon: '✏️' },
                ] as const).map((p) => (
                  <button key={p.id}
                    onClick={() => update({ cardType: p.id })}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${
                      design.cardType === p.id
                        ? 'border-indigo-500/60 bg-indigo-600/20 text-indigo-300'
                        : 'border-slate-800 text-slate-400 hover:border-slate-700 hover:bg-slate-800'
                    }`}
                  >
                    <span className="text-sm">{p.icon}</span>
                    <span className="truncate">{p.label}</span>
                  </button>
                ))}
              </div>
            )}
            <PanelLabel>Data Fields</PanelLabel>
            {(() => {
              const fields = CARD_TYPE_FIELDS[design.cardType] ?? [];
              if (fields.length === 0) {
                return (
                  <div className="py-6 text-center space-y-2">
                    <div className="text-2xl opacity-20">🔗</div>
                    <p className="text-xs text-slate-500 font-medium">No data source linked</p>
                    <p className="text-[10px] text-slate-600 leading-relaxed px-2">Pick <strong className="text-indigo-400">Student</strong>, <strong className="text-emerald-400">Staff</strong>, or a Certificate type above to enable drag-and-drop fields like <code className="font-mono text-indigo-400">{'{{name}}'}</code>.</p>
                  </div>
                );
              }
              const purposeLabel: Record<string, string> = { student: 'Student ID Card', staff: 'Staff ID Card', 'certificate-student': 'Student Certificate', 'certificate-staff': 'Staff Certificate', 'teacher-part-time': 'TPT ID Card' };
              return (
                <>
                  <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-indigo-600/20 border border-indigo-500/30">
                    <svg viewBox="0 0 14 14" className="w-3.5 h-3.5 text-indigo-400 shrink-0" fill="currentColor"><circle cx="7" cy="7" r="6"/><path d="M7 5v5M7 3.5v1" fill="none" stroke="white" strokeWidth={1.5} strokeLinecap="round"/></svg>
                    <span className="text-[10px] text-indigo-300 font-medium">{purposeLabel[design.cardType] ?? design.cardType}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed px-0.5">Click to insert at top-left, or <strong className="text-indigo-400">drag &amp; drop</strong> onto the card to place at any position. Placeholders are replaced with real data when printing.</p>
                  <div className="space-y-1">
                    {fields.map((field) => (
                      <button key={field.key}
                        draggable
                        onDragStart={(e) => {
                          // Use a custom MIME type so we can ignore unrelated drags (e.g. files, text)
                          e.dataTransfer.setData('application/x-wattaman-field', field.key);
                          e.dataTransfer.setData('text/plain', field.key);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => {
                          const newText: TextElement = { id: genId(), content: field.key, x: 20, y: 20 + design.texts.length * 28, fontSize: 13, color: '#f1f5f9', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left', fontFamily: 'Inter, sans-serif', zIndex: getMaxZ() + 1 };
                          update({ texts: [...design.texts, newText] });
                          onSelect?.(newText.id);
                          setActiveTab('text');
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-800 transition-all group text-left cursor-grab active:cursor-grabbing"
                      >
                        <code className="text-[9px] font-mono bg-slate-800 group-hover:bg-indigo-600/20 text-indigo-400 px-1.5 py-0.5 rounded shrink-0 border border-slate-700 group-hover:border-indigo-500/50">{field.key}</code>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-medium text-slate-300 truncate">{field.label}</p>
                          <p className="text-[9px] text-slate-600 truncate">{field.example}</p>
                        </div>
                        <svg viewBox="0 0 12 12" className="w-3 h-3 text-slate-700 group-hover:text-indigo-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 2v8M2 6h8"/></svg>
                      </button>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        )}

      </div>

      {/* Crop modal — rendered as fixed overlay, logo id controls visibility */}
      {cropLogoId && (() => {
        const cropLogo = design.logos.find((l) => l.id === cropLogoId);
        if (!cropLogo) return null;
        return (
          <CropModal
            logo={cropLogo}
            onConfirm={(cropX, cropY, cropW, cropH) => {
              updateLogo(cropLogoId, { cropX, cropY, cropW, cropH });
              setCropLogoId(null);
            }}
            onClose={() => setCropLogoId(null)}
          />
        );
      })()}
    </div>
  );
}
