'use client';

import { useEffect, useMemo, useRef } from 'react';
import { CardDesign, LogoElement, TextElement, ShapeElement, PhotoPlaceholder, QrPlaceholder, CARD_TYPE_FIELDS } from './types';

/** Replace {{Placeholder}} tokens with example values for in-editor preview. */
function previewSubstitute(content: string, exampleMap: Record<string, string>): string {
  if (!content || content.indexOf('{{') === -1) return content;
  return content.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const k = String(key).trim().toLowerCase();
    return exampleMap[k] ?? match;
  });
}

type HandlePosition = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface CardCanvasProps {
  design: CardDesign;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMoveText: (id: string, x: number, y: number) => void;
  onMoveLogo: (id: string, x: number, y: number) => void;
  onResizeLogo?: (id: string, changes: Partial<LogoElement>) => void;
  onMoveShape?: (id: string, x: number, y: number) => void;
  onResizeShape?: (id: string, changes: Partial<ShapeElement>) => void;
  onMovePhoto?: (x: number, y: number) => void;
  onResizePhoto?: (changes: Partial<PhotoPlaceholder>) => void;
  onMoveQr?: (x: number, y: number) => void;
  onResizeQr?: (changes: Partial<QrPlaceholder>) => void;
  onContextMenu?: (e: React.MouseEvent, id: string | null) => void;
  /** Called when a Field button is dropped onto the canvas. (x, y) are in design (unscaled) pixels. */
  onDropField?: (fieldKey: string, x: number, y: number) => void;
  /** When true, photo + QR placeholders render with sample imagery instead of empty boxes. */
  isPreviewMode?: boolean;
  /** Sample photo URL used when isPreviewMode is true. */
  previewPhotoUrl?: string | null;
  /** Sample QR data URL used when isPreviewMode is true. */
  previewQrUrl?: string | null;
}

export default function CardCanvas({ design, selectedId, onSelect, onMoveText, onMoveLogo, onResizeLogo, onMoveShape, onResizeShape, onMovePhoto, onResizePhoto, onMoveQr, onResizeQr, onContextMenu, onDropField, isPreviewMode, previewPhotoUrl, previewQrUrl }: CardCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  // Build {{name}} → "Sokha Chan" preview lookup based on current cardType,
  // with a global fallback so common placeholders still substitute even when
  // cardType is 'general' or doesn't define the key (e.g. user typed
  // {{name}} on a blank/general card).
  const previewExamples = useMemo(() => {
    const map: Record<string, string> = {};
    // Global fallback: merge examples from every cardType. Earlier entries lose
    // to later ones; that's fine because examples for the same key are similar.
    for (const ct of Object.keys(CARD_TYPE_FIELDS) as (keyof typeof CARD_TYPE_FIELDS)[]) {
      for (const f of CARD_TYPE_FIELDS[ct] ?? []) {
        const k = f.key.replace(/[{}]/g, '').trim().toLowerCase();
        if (!(k in map)) map[k] = f.example;
      }
    }
    // Current cardType wins (override) so e.g. staff {{name}} shows the staff example.
    for (const f of CARD_TYPE_FIELDS[design.cardType] ?? []) {
      const k = f.key.replace(/[{}]/g, '').trim().toLowerCase();
      map[k] = f.example;
    }
    return map;
  }, [design.cardType]);
  const dragRef = useRef<{
    type: 'text' | 'logo' | 'shape' | 'photo' | 'qr' | 'resize' | 'photo-resize' | 'qr-resize' | 'logo-resize' | 'rotate';
    id: string;
    startX: number;
    startY: number;
    elemX: number;
    elemY: number;
    elemW?: number;
    elemH?: number;
    handle?: HandlePosition;
    startAngle?: number;
    elemRotation?: number;
  } | null>(null);

  const handleMouseDown = (e: React.MouseEvent, type: 'text' | 'logo' | 'shape', id: string, elemX: number, elemY: number) => {
    e.stopPropagation();
    // Respect lock: locked elements cannot be selected or moved
    const isLocked =
      (type === 'text' && design.texts.find((t) => t.id === id)?.locked) ||
      (type === 'logo' && design.logos.find((l) => l.id === id)?.locked) ||
      (type === 'shape' && (design.shapes ?? []).find((s) => s.id === id)?.locked);
    if (isLocked) return;
    onSelect(id);
    dragRef.current = { type, id, startX: e.clientX, startY: e.clientY, elemX, elemY };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      const newX = Math.max(0, dragRef.current.elemX + dx);
      const newY = Math.max(0, dragRef.current.elemY + dy);
      if (dragRef.current.type === 'text') {
        onMoveText(dragRef.current.id, newX, newY);
      } else if (dragRef.current.type === 'logo') {
        onMoveLogo(dragRef.current.id, newX, newY);
      } else if (dragRef.current.type === 'shape' && onMoveShape) {
        onMoveShape(dragRef.current.id, newX, newY);
      } else if (dragRef.current.type === 'photo' && onMovePhoto) {
        onMovePhoto(newX, newY);
      } else if (dragRef.current.type === 'qr' && onMoveQr) {
        onMoveQr(newX, newY);
      }
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // --- Resize handle drag ---
  const handleResizeMouseDown = (e: React.MouseEvent, shape: ShapeElement, handle: HandlePosition) => {
    e.stopPropagation();
    e.preventDefault();
    if (shape.locked) return;
    onSelect(shape.id);
    dragRef.current = {
      type: 'resize',
      id: shape.id,
      startX: e.clientX,
      startY: e.clientY,
      elemX: shape.x,
      elemY: shape.y,
      elemW: shape.width,
      elemH: shape.height,
      handle,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current || dragRef.current.type !== 'resize' || !onResizeShape) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      const h = dragRef.current.handle!;
      let { elemX: x, elemY: y, elemW: w, elemH: ht } = dragRef.current;
      w = w!; ht = ht!;

      // Compute new bounds based on which handle is dragged
      if (h.includes('e')) w = Math.max(4, w + dx);
      if (h.includes('w')) { w = Math.max(4, w - dx); x = x + (dragRef.current.elemW! - Math.max(4, dragRef.current.elemW! - dx)); }
      if (h.includes('s')) ht = Math.max(4, ht + dy);
      if (h.includes('n')) { ht = Math.max(4, ht - dy); y = y + (dragRef.current.elemH! - Math.max(4, dragRef.current.elemH! - dy)); }

      onResizeShape(dragRef.current.id, { x, y, width: w, height: ht });
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // --- Rotation handle drag ---
  const handleRotateMouseDown = (e: React.MouseEvent, shape: ShapeElement) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect(shape.id);

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const centerX = rect.left + shape.x + shape.width / 2;
    const centerY = rect.top + shape.y + shape.height / 2;
    const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);

    dragRef.current = {
      type: 'rotate',
      id: shape.id,
      startX: e.clientX,
      startY: e.clientY,
      elemX: shape.x,
      elemY: shape.y,
      startAngle,
      elemRotation: shape.rotation ?? 0,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current || dragRef.current.type !== 'rotate' || !onResizeShape) return;
      const currentAngle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX);
      const delta = ((currentAngle - dragRef.current.startAngle!) * 180) / Math.PI;
      let newRotation = (dragRef.current.elemRotation! + delta) % 360;
      if (newRotation < 0) newRotation += 360;
      // Snap to 15° increments when holding Shift
      if (ev.shiftKey) newRotation = Math.round(newRotation / 15) * 15;
      onResizeShape(dragRef.current.id, { rotation: newRotation });
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // --- Photo resize handle drag ---
  const handlePhotoResizeMouseDown = (e: React.MouseEvent, photo: PhotoPlaceholder, handle: HandlePosition) => {
    e.stopPropagation();
    e.preventDefault();
    if (photo.locked) return;
    onSelect('__photo__');
    dragRef.current = {
      type: 'photo-resize',
      id: '__photo__',
      startX: e.clientX,
      startY: e.clientY,
      elemX: photo.x,
      elemY: photo.y,
      elemW: photo.width,
      elemH: photo.height,
      handle,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current || dragRef.current.type !== 'photo-resize' || !onResizePhoto) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      const h = dragRef.current.handle!;
      let { elemX: x, elemY: y, elemW: w, elemH: ht } = dragRef.current;
      w = w!; ht = ht!;

      if (h.includes('e')) w = Math.max(20, w + dx);
      if (h.includes('w')) { w = Math.max(20, w - dx); x = x + (dragRef.current.elemW! - Math.max(20, dragRef.current.elemW! - dx)); }
      if (h.includes('s')) ht = Math.max(20, ht + dy);
      if (h.includes('n')) { ht = Math.max(20, ht - dy); y = y + (dragRef.current.elemH! - Math.max(20, dragRef.current.elemH! - dy)); }

      onResizePhoto({ x, y, width: w, height: ht });
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // --- QR resize handle drag ---
  const handleQrResizeMouseDown = (e: React.MouseEvent, qr: QrPlaceholder, handle: HandlePosition) => {
    e.stopPropagation();
    e.preventDefault();
    if (qr.locked) return;
    onSelect('__qr__');
    dragRef.current = {
      type: 'qr-resize',
      id: '__qr__',
      startX: e.clientX,
      startY: e.clientY,
      elemX: qr.x,
      elemY: qr.y,
      elemW: qr.width,
      elemH: qr.height,
      handle,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current || dragRef.current.type !== 'qr-resize' || !onResizeQr) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      const h = dragRef.current.handle!;
      let { elemX: x, elemY: y, elemW: w, elemH: ht } = dragRef.current;
      w = w!; ht = ht!;

      if (h.includes('e')) w = Math.max(20, w + dx);
      if (h.includes('w')) { w = Math.max(20, w - dx); x = x + (dragRef.current.elemW! - Math.max(20, dragRef.current.elemW! - dx)); }
      if (h.includes('s')) ht = Math.max(20, ht + dy);
      if (h.includes('n')) { ht = Math.max(20, ht - dy); y = y + (dragRef.current.elemH! - Math.max(20, dragRef.current.elemH! - dy)); }

      onResizeQr({ x, y, width: w, height: ht });
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // --- Logo resize handle drag ---
  const handleLogoResizeMouseDown = (e: React.MouseEvent, logo: LogoElement, handle: HandlePosition) => {
    e.stopPropagation();
    e.preventDefault();
    if (logo.locked) return;
    onSelect(logo.id);
    dragRef.current = {
      type: 'logo-resize',
      id: logo.id,
      startX: e.clientX,
      startY: e.clientY,
      elemX: logo.x,
      elemY: logo.y,
      elemW: logo.width,
      elemH: logo.height,
      handle,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current || dragRef.current.type !== 'logo-resize' || !onResizeLogo) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      const h = dragRef.current.handle!;
      let { elemX: x, elemY: y, elemW: w, elemH: ht } = dragRef.current;
      w = w!; ht = ht!;

      if (h.includes('e')) w = Math.max(10, w + dx);
      if (h.includes('w')) { w = Math.max(10, w - dx); x = x + (dragRef.current.elemW! - Math.max(10, dragRef.current.elemW! - dx)); }
      if (h.includes('s')) ht = Math.max(10, ht + dy);
      if (h.includes('n')) { ht = Math.max(10, ht - dy); y = y + (dragRef.current.elemH! - Math.max(10, dragRef.current.elemH! - dy)); }

      onResizeLogo(dragRef.current.id, { x, y, width: w, height: ht });
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // --- Arrow-key nudge for selected element ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedId) return;
      const arrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (!arrow.includes(e.key)) return;
      // Don't capture if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
      const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;

      if (selectedId === '__photo__' && design.photo && onMovePhoto) {
        onMovePhoto(Math.max(0, design.photo.x + dx), Math.max(0, design.photo.y + dy));
      } else if (selectedId === '__qr__' && design.qr && onMoveQr) {
        onMoveQr(Math.max(0, design.qr.x + dx), Math.max(0, design.qr.y + dy));
      } else {
        const text = design.texts.find((t) => t.id === selectedId);
        if (text) { onMoveText(selectedId, Math.max(0, text.x + dx), Math.max(0, text.y + dy)); return; }
        const logo = design.logos.find((l) => l.id === selectedId);
        if (logo) { onMoveLogo(selectedId, Math.max(0, logo.x + dx), Math.max(0, logo.y + dy)); return; }
        const shape = (design.shapes ?? []).find((s) => s.id === selectedId);
        if (shape && onMoveShape) { onMoveShape(selectedId, Math.max(0, shape.x + dx), Math.max(0, shape.y + dy)); }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, design, onMoveText, onMoveLogo, onMoveShape, onMovePhoto, onMoveQr]);

  const HANDLE_SIZE = 8;
  const handlePositions: { key: HandlePosition; cursor: string; style: React.CSSProperties }[] = [
    { key: 'nw', cursor: 'nwse-resize', style: { top: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 } },
    { key: 'n',  cursor: 'ns-resize',   style: { top: -HANDLE_SIZE / 2, left: '50%', marginLeft: -HANDLE_SIZE / 2 } },
    { key: 'ne', cursor: 'nesw-resize', style: { top: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 } },
    { key: 'e',  cursor: 'ew-resize',   style: { top: '50%', marginTop: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 } },
    { key: 'se', cursor: 'nwse-resize', style: { bottom: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 } },
    { key: 's',  cursor: 'ns-resize',   style: { bottom: -HANDLE_SIZE / 2, left: '50%', marginLeft: -HANDLE_SIZE / 2 } },
    { key: 'sw', cursor: 'nesw-resize', style: { bottom: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 } },
    { key: 'w',  cursor: 'ew-resize',   style: { top: '50%', marginTop: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 } },
  ];

  const hasElements = design.texts.length > 0 || design.logos.length > 0 || (design.shapes ?? []).length > 0 || !!design.photo || !!design.qr;

  return (
    <div className="flex flex-col items-center justify-center p-8 rounded-xl min-h-[500px]" style={{
      backgroundImage: 'linear-gradient(45deg, #e2e8f0 25%, transparent 25%), linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2e8f0 75%), linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)',
      backgroundSize: '16px 16px',
      backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
      backgroundColor: '#f1f5f9',
    }}>
      {/* Outer wrapper — allows transform handles to overflow */}
      <div className="relative" style={{ width: design.width, height: design.height }}>
        {/* Card surface — clips content to card bounds */}
        <div
          ref={canvasRef}
          className="absolute inset-0 shadow-2xl cursor-default"
          style={{
            backgroundColor: design.backgroundColor,
            border: design.frameWidth > 0 ? `${design.frameWidth}px solid ${design.frameColor}` : 'none',
            outline: design.frameWidth > 0 ? 'none' : '1px dashed #94a3b8',
            borderRadius: 12,
            overflow: 'hidden',
          }}
          onMouseDown={() => onSelect(null)}
          onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(e, null); }}
          onDragOver={(e) => {
            // Only react to our own field drags, not files/text from elsewhere
            if (!onDropField) return;
            if (Array.from(e.dataTransfer.types).includes('application/x-wattaman-field')) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={(e) => {
            if (!onDropField) return;
            const key = e.dataTransfer.getData('application/x-wattaman-field');
            if (!key) return;
            e.preventDefault();
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            // Account for zoom scaling: canvas is rendered at scale(zoom/100); rect.width is post-scale
            const scaleX = rect.width > 0 ? design.width / rect.width : 1;
            const scaleY = rect.height > 0 ? design.height / rect.height : 1;
            const x = Math.max(0, Math.min(design.width, (e.clientX - rect.left) * scaleX));
            const y = Math.max(0, Math.min(design.height, (e.clientY - rect.top) * scaleY));
            onDropField(key, x, y);
          }}
        >
          {/* Photo placeholder — rendered with other elements via z-index sorting below */}

          {/* QR placeholder — rendered with other elements via z-index sorting below */}

          {/* All elements sorted by zIndex (including photo and qr) */}
          {[
            ...(design.photo && design.photo.visible !== false ? [{ kind: 'photo' as const, id: '__photo__', z: design.photo.zIndex ?? 0, data: design.photo }] : []),
            ...(design.qr && design.qr.visible !== false ? [{ kind: 'qr' as const, id: '__qr__', z: design.qr.zIndex ?? 0, data: design.qr }] : []),
            ...(design.shapes ?? []).filter((s) => s.visible !== false).map((shape) => ({ kind: 'shape' as const, id: shape.id, z: shape.zIndex ?? 0, data: shape })),
            ...design.logos.filter((l) => l.visible !== false).map((logo) => ({ kind: 'logo' as const, id: logo.id, z: logo.zIndex ?? 0, data: logo })),
            ...design.texts.filter((t) => t.visible !== false).map((text) => ({ kind: 'text' as const, id: text.id, z: text.zIndex ?? 0, data: text })),
          ]
            .sort((a, b) => a.z - b.z)
            .map((item) => {
              if (item.kind === 'photo') {
                const photo = item.data as PhotoPlaceholder;
                const isSelected = selectedId === '__photo__';
                return (
                  <div
                    key="__photo__"
                    className={`absolute flex items-center justify-center bg-slate-200 text-slate-400 text-xs select-none cursor-move ${isSelected ? 'ring-2 ring-indigo-500 ring-offset-1' : ''}`}
                    style={{
                      left: photo.x,
                      top: photo.y,
                      width: photo.width,
                      height: photo.height,
                      borderRadius: photo.borderRadius,
                      border: `${photo.borderWidth}px solid ${photo.borderColor}`,
                      zIndex: photo.zIndex ?? 0,
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      if (photo.locked) return;
                      onSelect('__photo__');
                      dragRef.current = { type: 'photo', id: '__photo__', startX: e.clientX, startY: e.clientY, elemX: photo.x, elemY: photo.y };
                      const handleMouseMove = (ev: MouseEvent) => {
                        if (!dragRef.current || dragRef.current.type !== 'photo') return;
                        const dx = ev.clientX - dragRef.current.startX;
                        const dy = ev.clientY - dragRef.current.startY;
                        const newX = Math.max(0, dragRef.current.elemX + dx);
                        const newY = Math.max(0, dragRef.current.elemY + dy);
                        if (onMovePhoto) onMovePhoto(newX, newY);
                      };
                      const handleMouseUp = () => {
                        dragRef.current = null;
                        document.removeEventListener('mousemove', handleMouseMove);
                        document.removeEventListener('mouseup', handleMouseUp);
                      };
                      document.addEventListener('mousemove', handleMouseMove);
                      document.addEventListener('mouseup', handleMouseUp);
                    }}
                    onContextMenu={(e) => { e.stopPropagation(); e.preventDefault(); onSelect('__photo__'); onContextMenu?.(e, '__photo__'); }}
                  >
                    {isPreviewMode && previewPhotoUrl ? (
                      <img
                        src={previewPhotoUrl}
                        alt="Sample"
                        draggable={false}
                        className="w-full h-full object-cover pointer-events-none"
                        style={{ borderRadius: Math.max(0, photo.borderRadius - photo.borderWidth) }}
                      />
                    ) : (
                      <div className="text-center leading-tight pointer-events-none">
                        <span className="block text-lg">👤</span>
                        <span className="block mt-0.5">Photo</span>
                      </div>
                    )}
                  </div>
                );
              }
              if (item.kind === 'qr') {
                const qr = item.data as QrPlaceholder;
                const isSelected = selectedId === '__qr__';
                return (
                  <div
                    key="__qr__"
                    className={`absolute flex items-center justify-center bg-slate-200 text-slate-400 text-xs select-none cursor-move ${isSelected ? 'ring-2 ring-indigo-500 ring-offset-1' : ''}`}
                    style={{
                      left: qr.x,
                      top: qr.y,
                      width: qr.width,
                      height: qr.height,
                      borderRadius: qr.borderRadius,
                      border: `${qr.borderWidth}px solid ${qr.borderColor}`,
                      zIndex: qr.zIndex ?? 0,
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      if (qr.locked) return;
                      onSelect('__qr__');
                      dragRef.current = { type: 'qr', id: '__qr__', startX: e.clientX, startY: e.clientY, elemX: qr.x, elemY: qr.y };
                      const handleMouseMove = (ev: MouseEvent) => {
                        if (!dragRef.current || dragRef.current.type !== 'qr') return;
                        const dx = ev.clientX - dragRef.current.startX;
                        const dy = ev.clientY - dragRef.current.startY;
                        const newX = Math.max(0, dragRef.current.elemX + dx);
                        const newY = Math.max(0, dragRef.current.elemY + dy);
                        if (onMoveQr) onMoveQr(newX, newY);
                      };
                      const handleMouseUp = () => {
                        dragRef.current = null;
                        document.removeEventListener('mousemove', handleMouseMove);
                        document.removeEventListener('mouseup', handleMouseUp);
                      };
                      document.addEventListener('mousemove', handleMouseMove);
                      document.addEventListener('mouseup', handleMouseUp);
                    }}
                    onContextMenu={(e) => { e.stopPropagation(); e.preventDefault(); onSelect('__qr__'); onContextMenu?.(e, '__qr__'); }}
                  >
                    {isPreviewMode && previewQrUrl ? (
                      <img
                        src={previewQrUrl}
                        alt="QR"
                        draggable={false}
                        className="w-full h-full object-contain pointer-events-none bg-white"
                        style={{ borderRadius: Math.max(0, qr.borderRadius - qr.borderWidth) }}
                      />
                    ) : (
                      <div className="text-center leading-tight pointer-events-none">
                        <span className="block text-base">📱</span>
                        <span className="block mt-0.5" style={{ fontSize: 9 }}>QR Code</span>
                      </div>
                    )}
                  </div>
                );
              }
              if (item.kind === 'shape') {
                const shape = item.data as ShapeElement;
                const gradientStyle = shape.gradient?.enabled
                  ? shape.gradient.type === 'linear'
                    ? `linear-gradient(${shape.gradient.angle}deg, ${shape.gradient.stops.map(s => `${s.color} ${s.offset * 100}%`).join(', ')})`
                    : `radial-gradient(circle, ${shape.gradient.stops.map(s => `${s.color} ${s.offset * 100}%`).join(', ')})`
                  : undefined;
                const isSelected = selectedId === shape.id;
                return (
                  <div
                    key={shape.id}
                    className={`absolute cursor-move select-none ${isSelected ? 'ring-2 ring-indigo-500 ring-offset-1' : ''}`}
                    style={{
                      left: shape.x,
                      top: shape.y,
                      width: shape.width,
                      height: shape.height,
                      zIndex: shape.zIndex ?? 0,
                      transform: shape.rotation ? `rotate(${shape.rotation}deg)` : undefined,
                      transformOrigin: 'center center',
                      backgroundColor: shape.type === 'line' ? 'transparent' : (gradientStyle ? undefined : shape.color),
                      backgroundImage: shape.type === 'line' ? undefined : gradientStyle,
                      borderRadius: shape.type === 'circle' ? '50%' : shape.borderRadius,
                      border: shape.type === 'line' ? 'none' : (shape.borderWidth > 0 ? `${shape.borderWidth}px solid ${shape.borderColor}` : 'none'),
                      opacity: shape.opacity,
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'shape', shape.id, shape.x, shape.y)}
                    onContextMenu={(e) => { e.stopPropagation(); e.preventDefault(); onSelect(shape.id); onContextMenu?.(e, shape.id); }}
                  >
                    {shape.type === 'line' && (
                      <div
                        className="w-full absolute top-1/2 -translate-y-1/2"
                        style={{
                          height: 0,
                          borderTop: `${Math.max(shape.borderWidth, 0.5)}px ${shape.lineStyle ?? 'solid'} ${shape.borderColor || shape.color}`,
                        }}
                      />
                    )}
                  </div>
                );
              }
              if (item.kind === 'logo') {
                const logo = item.data as LogoElement;
                // Crop fractions — guard against divide-by-zero / out-of-range values.
                const cropW = Math.max(0.001, Math.min(1, logo.cropW ?? 1));
                const cropH = Math.max(0.001, Math.min(1, logo.cropH ?? 1));
                const cropX = Math.max(0, Math.min(1 - cropW, logo.cropX ?? 0));
                const cropY = Math.max(0, Math.min(1 - cropH, logo.cropY ?? 0));
                // Compute the natural image's displayed size in PIXELS so it's
                // independent of CSS-percentage quirks (margin-top % is based on
                // container WIDTH, not height — that bug used to make cropped
                // logos render at the wrong vertical offset / appear black when
                // pushed entirely outside the clip box on tall containers).
                const dispW = logo.width / cropW;
                const dispH = logo.height / cropH;
                const offX = -cropX * dispW;
                const offY = -cropY * dispH;
                return (
                  <div
                    key={logo.id}
                    className={`absolute cursor-move select-none overflow-hidden ${selectedId === logo.id ? 'ring-2 ring-indigo-500 ring-offset-1' : ''}`}
                    style={{
                      left: logo.x, top: logo.y, width: logo.width, height: logo.height,
                      zIndex: logo.zIndex ?? 0,
                      borderRadius: logo.borderRadius ?? 0,
                      opacity: logo.opacity ?? 1,
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'logo', logo.id, logo.x, logo.y)}
                    onContextMenu={(e) => { e.stopPropagation(); e.preventDefault(); onSelect(logo.id); onContextMenu?.(e, logo.id); }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logo.src}
                      alt={logo.name}
                      className="pointer-events-none"
                      draggable={false}
                      style={{
                        position: 'absolute',
                        display: 'block',
                        left: offX,
                        top: offY,
                        width: dispW,
                        height: dispH,
                        maxWidth: 'none',
                        maxHeight: 'none',
                        filter: logo.blur && logo.blur > 0 ? `blur(${logo.blur}px)` : undefined,
                        mixBlendMode: logo.removeBg ? 'multiply' : undefined,
                      }}
                    />
                  </div>
                );
              }
              // logo handled above
              const text = item.data as TextElement;
              return (
                <div
                  key={text.id}
                  className={`absolute cursor-move select-none whitespace-pre-wrap ${selectedId === text.id ? 'ring-2 ring-indigo-500 ring-offset-1 rounded' : ''}`}
                  style={{
                    left: text.x,
                    top: text.y,
                    fontSize: text.fontSize,
                    color: text.color,
                    fontFamily: text.fontFamily ?? 'Inter, sans-serif',
                    fontWeight: text.fontWeight,
                    fontStyle: text.fontStyle,
                    lineHeight: 1.3,
                    textAlign: text.textAlign ?? 'left',
                    zIndex: text.zIndex ?? 0,
                  }}
                  onMouseDown={(e) => handleMouseDown(e, 'text', text.id, text.x, text.y)}
                  onContextMenu={(e) => { e.stopPropagation(); e.preventDefault(); onSelect(text.id); onContextMenu?.(e, text.id); }}
                >
                  {text.content ? previewSubstitute(text.content, previewExamples) : 'Double-click to edit'}
                </div>
              );
            })}

          {/* Empty state */}
          {!hasElements && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm pointer-events-none">
              Add elements using the toolbar →
            </div>
          )}
        </div>

        {/* Transform handles overlay — NOT clipped, renders above card */}
        {(() => {
          const selectedShape = (design.shapes ?? []).find((s) => s.id === selectedId);
          if (!selectedShape) return null;

          return (
            <div
              className="absolute pointer-events-none"
              style={{
                left: selectedShape.x,
                top: selectedShape.y,
                width: selectedShape.width,
                height: selectedShape.height,
                transform: selectedShape.rotation ? `rotate(${selectedShape.rotation}deg)` : undefined,
                transformOrigin: 'center center',
                zIndex: 50,
              }}
            >
              {/* Dashed selection border */}
              <div
                className="absolute inset-0 border-2 border-dashed border-indigo-400 rounded-sm pointer-events-none"
              />

              {/* Resize handles */}
              {handlePositions.map(({ key, cursor, style }) => (
                <div
                  key={key}
                  className="absolute bg-white border-2 border-indigo-500 rounded-sm pointer-events-auto shadow-sm hover:bg-indigo-50 hover:scale-125 transition-transform"
                  style={{
                    width: HANDLE_SIZE,
                    height: HANDLE_SIZE,
                    cursor,
                    ...style,
                  }}
                  onMouseDown={(e) => handleResizeMouseDown(e, selectedShape, key)}
                />
              ))}

              {/* Rotation handle — circle above top center with connecting line */}
              <div
                className="absolute flex flex-col items-center pointer-events-auto"
                style={{ top: -32, left: '50%', marginLeft: -7 }}
              >
                <div
                  className="w-3.5 h-3.5 rounded-full bg-indigo-500 border-2 border-white shadow-md cursor-grab hover:bg-indigo-600 hover:scale-110 transition-all"
                  title="Drag to rotate (hold Shift for 15° snapping)"
                  onMouseDown={(e) => handleRotateMouseDown(e, selectedShape)}
                />
                <div className="w-px h-[14px] bg-indigo-400" />
              </div>

              {/* Size label */}
              <div
                className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] text-indigo-500 font-mono whitespace-nowrap pointer-events-none bg-white/80 px-1 rounded"
              >
                {Math.round(selectedShape.width)} × {Math.round(selectedShape.height)}
                {selectedShape.rotation ? ` · ${Math.round(selectedShape.rotation)}°` : ''}
              </div>
            </div>
          );
        })()}

        {/* Photo resize handles overlay */}
        {(() => {
          if (selectedId !== '__photo__' || !design.photo) return null;
          const photo = design.photo;
          return (
            <div
              className="absolute pointer-events-none"
              style={{
                left: photo.x,
                top: photo.y,
                width: photo.width,
                height: photo.height,
                zIndex: 50,
              }}
            >
              <div className="absolute inset-0 border-2 border-dashed border-indigo-400 rounded-sm pointer-events-none" />
              {handlePositions.map(({ key, cursor, style }) => (
                <div
                  key={key}
                  className="absolute bg-white border-2 border-indigo-500 rounded-sm pointer-events-auto shadow-sm hover:bg-indigo-50 hover:scale-125 transition-transform"
                  style={{
                    width: HANDLE_SIZE,
                    height: HANDLE_SIZE,
                    cursor,
                    ...style,
                  }}
                  onMouseDown={(e) => handlePhotoResizeMouseDown(e, photo, key)}
                />
              ))}
              <div
                className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] text-indigo-500 font-mono whitespace-nowrap pointer-events-none bg-white/80 px-1 rounded"
              >
                {Math.round(photo.width)} × {Math.round(photo.height)}
              </div>
            </div>
          );
        })()}

        {/* QR resize handles overlay */}
        {(() => {
          if (selectedId !== '__qr__' || !design.qr) return null;
          const qr = design.qr;
          return (
            <div
              className="absolute pointer-events-none"
              style={{
                left: qr.x,
                top: qr.y,
                width: qr.width,
                height: qr.height,
                zIndex: 50,
              }}
            >
              <div className="absolute inset-0 border-2 border-dashed border-indigo-400 rounded-sm pointer-events-none" />
              {handlePositions.map(({ key, cursor, style }) => (
                <div
                  key={key}
                  className="absolute bg-white border-2 border-indigo-500 rounded-sm pointer-events-auto shadow-sm hover:bg-indigo-50 hover:scale-125 transition-transform"
                  style={{
                    width: HANDLE_SIZE,
                    height: HANDLE_SIZE,
                    cursor,
                    ...style,
                  }}
                  onMouseDown={(e) => handleQrResizeMouseDown(e, qr, key)}
                />
              ))}
              <div
                className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] text-indigo-500 font-mono whitespace-nowrap pointer-events-none bg-white/80 px-1 rounded"
              >
                {Math.round(qr.width)} × {Math.round(qr.height)}
              </div>
            </div>
          );
        })()}

        {/* Logo resize handles overlay */}
        {(() => {
          const selectedLogo = design.logos.find((l) => l.id === selectedId);
          if (!selectedLogo) return null;
          return (
            <div
              className="absolute pointer-events-none"
              style={{
                left: selectedLogo.x,
                top: selectedLogo.y,
                width: selectedLogo.width,
                height: selectedLogo.height,
                zIndex: 50,
              }}
            >
              <div className="absolute inset-0 border-2 border-dashed border-indigo-400 rounded-sm pointer-events-none" />
              {handlePositions.map(({ key, cursor, style }) => (
                <div
                  key={key}
                  className="absolute bg-white border-2 border-indigo-500 rounded-sm pointer-events-auto shadow-sm hover:bg-indigo-50 hover:scale-125 transition-transform"
                  style={{
                    width: HANDLE_SIZE,
                    height: HANDLE_SIZE,
                    cursor,
                    ...style,
                  }}
                  onMouseDown={(e) => handleLogoResizeMouseDown(e, selectedLogo, key)}
                />
              ))}
              <div
                className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] text-indigo-500 font-mono whitespace-nowrap pointer-events-none bg-white/80 px-1 rounded"
              >
                {Math.round(selectedLogo.width)} × {Math.round(selectedLogo.height)}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Card info label */}
      <div className="mt-3 text-center">
        <span className="inline-flex items-center gap-2 text-xs text-slate-500 bg-white/80 backdrop-blur-sm rounded-full px-3 py-1 shadow-sm border border-slate-200">
          <span className="font-medium text-slate-600">
            {design.cardType === 'student' ? '🎓 Student' :
             design.cardType === 'staff' ? '👨‍🏫 Staff' :
             design.cardType === 'certificate-student' ? '📜 Student Cert.' :
             design.cardType === 'certificate-staff' ? '🏅 Staff Cert.' : '📄 General'}
          </span>
          <span className="w-px h-3 bg-slate-300" />
          <span className="font-mono">{design.width} × {design.height}</span>
        </span>
      </div>
    </div>
  );
}
