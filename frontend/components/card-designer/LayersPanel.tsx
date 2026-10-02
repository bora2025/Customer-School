'use client';

import { CardDesign, LogoElement, TextElement, ShapeElement, PhotoPlaceholder, QrPlaceholder } from './types';

interface LayerItem {
  id: string;
  label: string;
  icon: string;
  type: 'text' | 'logo' | 'shape' | 'photo' | 'qr';
  z: number;
  visible?: boolean;
  locked?: boolean;
}

interface LayersPanelProps {
  design: CardDesign;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDesignChange: (design: CardDesign) => void;
  onArrange: (id: string, mode: 'front' | 'forward' | 'backward' | 'back') => void;
}

export default function LayersPanel({ design, selectedId, onSelect, onDesignChange, onArrange }: LayersPanelProps) {
  // Build flat layer list sorted by z-index descending (top layer = highest z)
  const buildLayers = (): LayerItem[] => {
    const items: LayerItem[] = [
      ...(design.photo
        ? [{ id: '__photo__', label: 'Photo', icon: '👤', type: 'photo' as const, z: design.photo.zIndex ?? 0, visible: (design.photo as PhotoPlaceholder & { visible?: boolean }).visible !== false, locked: (design.photo as PhotoPlaceholder & { locked?: boolean }).locked ?? false }]
        : []),
      ...(design.qr
        ? [{ id: '__qr__', label: 'QR Code', icon: '📱', type: 'qr' as const, z: design.qr.zIndex ?? 0, visible: (design.qr as QrPlaceholder & { visible?: boolean }).visible !== false, locked: (design.qr as QrPlaceholder & { locked?: boolean }).locked ?? false }]
        : []),
      ...(design.shapes ?? []).map((s) => ({
        id: s.id,
        label: s.type === 'rectangle' ? 'Rectangle' : s.type === 'circle' ? 'Circle' : 'Line',
        icon: s.type === 'rectangle' ? '▭' : s.type === 'circle' ? '◯' : '─',
        type: 'shape' as const,
        z: s.zIndex ?? 0,
        visible: (s as ShapeElement & { visible?: boolean }).visible !== false,
        locked: (s as ShapeElement & { locked?: boolean }).locked ?? false,
      })),
      ...design.logos.map((l) => ({
        id: l.id,
        label: l.name || 'Logo',
        icon: '🖼️',
        type: 'logo' as const,
        z: l.zIndex ?? 0,
        visible: (l as LogoElement & { visible?: boolean }).visible !== false,
        locked: (l as LogoElement & { locked?: boolean }).locked ?? false,
      })),
      ...design.texts.map((t) => ({
        id: t.id,
        label: t.content.length > 20 ? t.content.slice(0, 20) + '…' : t.content,
        icon: '✏️',
        type: 'text' as const,
        z: t.zIndex ?? 0,
        visible: (t as TextElement & { visible?: boolean }).visible !== false,
        locked: (t as TextElement & { locked?: boolean }).locked ?? false,
      })),
    ];
    return items.sort((a, b) => b.z - a.z);
  };

  const layers = buildLayers();

  const toggleVisibility = (layer: LayerItem) => {
    if (layer.type === 'text') {
      onDesignChange({
        ...design,
        texts: design.texts.map((t) =>
          t.id === layer.id ? { ...t, visible: !((t as TextElement & { visible?: boolean }).visible !== false) } : t
        ),
      });
    } else if (layer.type === 'logo') {
      onDesignChange({
        ...design,
        logos: design.logos.map((l) =>
          l.id === layer.id ? { ...l, visible: !((l as LogoElement & { visible?: boolean }).visible !== false) } : l
        ),
      });
    } else if (layer.type === 'shape') {
      onDesignChange({
        ...design,
        shapes: (design.shapes ?? []).map((s) =>
          s.id === layer.id ? { ...s, visible: !((s as ShapeElement & { visible?: boolean }).visible !== false) } : s
        ),
      });
    } else if (layer.type === 'photo' && design.photo) {
      onDesignChange({
        ...design,
        photo: { ...design.photo, visible: !((design.photo as PhotoPlaceholder & { visible?: boolean }).visible !== false) } as PhotoPlaceholder,
      });
    } else if (layer.type === 'qr' && design.qr) {
      onDesignChange({
        ...design,
        qr: { ...design.qr, visible: !((design.qr as QrPlaceholder & { visible?: boolean }).visible !== false) } as QrPlaceholder,
      });
    }
  };

  const toggleLock = (layer: LayerItem) => {
    if (layer.type === 'text') {
      onDesignChange({
        ...design,
        texts: design.texts.map((t) =>
          t.id === layer.id ? { ...t, locked: !((t as TextElement & { locked?: boolean }).locked ?? false) } : t
        ),
      });
    } else if (layer.type === 'logo') {
      onDesignChange({
        ...design,
        logos: design.logos.map((l) =>
          l.id === layer.id ? { ...l, locked: !((l as LogoElement & { locked?: boolean }).locked ?? false) } : l
        ),
      });
    } else if (layer.type === 'shape') {
      onDesignChange({
        ...design,
        shapes: (design.shapes ?? []).map((s) =>
          s.id === layer.id ? { ...s, locked: !((s as ShapeElement & { locked?: boolean }).locked ?? false) } : s
        ),
      });
    }
  };

  const deleteLayer = (layer: LayerItem) => {
    if (layer.type === 'text') {
      onDesignChange({ ...design, texts: design.texts.filter((t) => t.id !== layer.id) });
    } else if (layer.type === 'logo') {
      onDesignChange({ ...design, logos: design.logos.filter((l) => l.id !== layer.id) });
    } else if (layer.type === 'shape') {
      onDesignChange({ ...design, shapes: (design.shapes ?? []).filter((s) => s.id !== layer.id) });
    } else if (layer.type === 'photo') {
      onDesignChange({ ...design, photo: null });
    } else if (layer.type === 'qr') {
      onDesignChange({ ...design, qr: null });
    }
  };

  const typeColor: Record<string, string> = {
    text: 'bg-indigo-500',
    logo: 'bg-amber-500',
    shape: 'bg-violet-500',
    photo: 'bg-blue-500',
    qr: 'bg-emerald-500',
  };

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] border-l border-[#333] select-none" style={{ width: 220 }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#333] bg-[#212121]">
        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 text-[#777]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="14" height="3" rx="0.5"/><rect x="1" y="9" width="14" height="3" rx="0.5" opacity="0.5"/></svg>
        <span className="text-xs font-semibold text-[#ccc] tracking-wide uppercase">Layers</span>
        <span className="ml-auto text-[10px] text-[#555] font-mono">{layers.length}</span>
      </div>

      {/* Layer list */}
      <div className="flex-1 overflow-y-auto">
        {layers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <svg viewBox="0 0 24 24" className="w-8 h-8 text-[#444] mb-3" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="4" rx="1"/><rect x="3" y="13" width="18" height="4" rx="1" opacity="0.4"/></svg>
            <p className="text-[11px] text-[#555] leading-relaxed">No layers yet.<br/>Add elements to the canvas.</p>
          </div>
        ) : (
          <div className="py-1">
            {layers.map((layer, idx) => {
              const isSelected = selectedId === layer.id;
              const isHidden = !layer.visible;
              const isLocked = layer.locked ?? false;
              return (
                <div
                  key={layer.id}
                  className={`group flex items-center gap-1.5 px-2 py-[5px] cursor-pointer transition-colors ${
                    isSelected ? 'bg-indigo-600/15 border-l-2 border-indigo-500' : 'border-l-2 border-transparent hover:bg-white/5'
                  } ${isHidden ? 'opacity-30' : ''}`}
                  onClick={() => !isLocked && onSelect(isSelected ? null : layer.id)}
                >
                  {/* Type dot */}
                  <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${typeColor[layer.type]}`} />

                  {/* Label */}
                  <span className={`flex-1 text-[11px] truncate ${isSelected ? 'text-indigo-300 font-medium' : 'text-[#bbb]'}`}>
                    {layer.label}
                  </span>

                  {/* Lock toggle */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleLock(layer); }}
                    title={isLocked ? 'Unlock' : 'Lock'}
                    className={`shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors ${
                      isLocked ? 'text-amber-400' : 'text-[#444] hover:text-[#999] opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    {isLocked
                      ? <svg viewBox="0 0 12 12" className="w-3 h-3" fill="currentColor"><path d="M9 5V4a3 3 0 1 0-6 0v1H2v6h8V5H9zm-5-1a2 2 0 1 1 4 0v1H4V4z"/></svg>
                      : <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={1.2}><rect x="1" y="5" width="10" height="6" rx="1"/><path d="M4 5V4a2 2 0 0 1 4 0"/></svg>}
                  </button>

                  {/* Visibility toggle */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleVisibility(layer); }}
                    title={isHidden ? 'Show' : 'Hide'}
                    className={`shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors ${
                      isHidden ? 'text-[#444]' : 'text-[#666] hover:text-[#bbb] opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    {isHidden
                      ? <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round"><line x1="1" y1="1" x2="11" y2="11"/><path d="M4.5 4.6A3 3 0 0 0 6 10.5c1.66 0 3-1.34 3-3 0-.55-.15-1.06-.4-1.5"/><path d="M8.9 3.1A5 5 0 0 0 6 2C3.24 2 1 4.2 1 6c0 .73.24 1.4.65 1.95"/></svg>
                      : <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round"><path d="M1 6c0 0 2-3.5 5-3.5S11 6 11 6s-2 3.5-5 3.5S1 6 1 6z"/><circle cx="6" cy="6" r="1.5"/></svg>}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Selection actions */}
      {selectedId && (
        <div className="border-t border-[#333] p-2 bg-[#212121]">
          <div className="text-[9px] font-bold text-[#555] uppercase tracking-widest mb-1.5 px-1">Arrange</div>
          <div className="grid grid-cols-4 gap-1">
            <button
              onClick={() => onArrange(selectedId, 'front')}
              title="Bring to Front"
              className="py-1.5 rounded border border-[#383838] text-[11px] text-[#888] hover:bg-indigo-600/20 hover:border-indigo-600/40 hover:text-indigo-300 transition-colors"
            >⤒</button>
            <button
              onClick={() => onArrange(selectedId, 'forward')}
              title="Move Forward"
              className="py-1.5 rounded border border-[#383838] text-[11px] text-[#888] hover:bg-indigo-600/20 hover:border-indigo-600/40 hover:text-indigo-300 transition-colors"
            >↑</button>
            <button
              onClick={() => onArrange(selectedId, 'backward')}
              title="Move Backward"
              className="py-1.5 rounded border border-[#383838] text-[11px] text-[#888] hover:bg-indigo-600/20 hover:border-indigo-600/40 hover:text-indigo-300 transition-colors"
            >↓</button>
            <button
              onClick={() => onArrange(selectedId, 'back')}
              title="Send to Back"
              className="py-1.5 rounded border border-[#383838] text-[11px] text-[#888] hover:bg-indigo-600/20 hover:border-indigo-600/40 hover:text-indigo-300 transition-colors"
            >⤓</button>
          </div>
          <div className="grid grid-cols-2 gap-1 mt-1">
            <button
              onClick={() => {
                const layer = layers.find((l) => l.id === selectedId);
                if (layer) toggleVisibility(layer);
              }}
              className="py-1.5 rounded border border-[#383838] text-[11px] text-[#888] hover:bg-white/8 hover:text-white transition-colors"
            >
              Vis
            </button>
            <button
              onClick={() => {
                const layer = layers.find((l) => l.id === selectedId);
                if (layer) deleteLayer(layer);
                onSelect(null);
              }}
              className="py-1.5 rounded border border-red-900/40 text-[11px] text-red-400 hover:bg-red-600/15 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
