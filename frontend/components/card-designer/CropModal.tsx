'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LogoElement } from './types';

interface CropModalProps {
  logo: LogoElement;
  onConfirm: (cropX: number, cropY: number, cropW: number, cropH: number) => void;
  onClose: () => void;
}

interface CropBox {
  x: number; // pixels from image left edge
  y: number; // pixels from image top edge
  w: number; // width in pixels
  h: number; // height in pixels
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

const MIN_SIZE = 20;
const HANDLE_PX = 10;

const HANDLE_DEFS: { id: Handle; style: React.CSSProperties }[] = [
  { id: 'nw', style: { top: -HANDLE_PX / 2, left: -HANDLE_PX / 2, cursor: 'nw-resize' } },
  { id: 'n',  style: { top: -HANDLE_PX / 2, left: '50%', transform: 'translateX(-50%)', cursor: 'n-resize' } },
  { id: 'ne', style: { top: -HANDLE_PX / 2, right: -HANDLE_PX / 2, cursor: 'ne-resize' } },
  { id: 'e',  style: { top: '50%', transform: 'translateY(-50%)', right: -HANDLE_PX / 2, cursor: 'e-resize' } },
  { id: 'se', style: { bottom: -HANDLE_PX / 2, right: -HANDLE_PX / 2, cursor: 'se-resize' } },
  { id: 's',  style: { bottom: -HANDLE_PX / 2, left: '50%', transform: 'translateX(-50%)', cursor: 's-resize' } },
  { id: 'sw', style: { bottom: -HANDLE_PX / 2, left: -HANDLE_PX / 2, cursor: 'sw-resize' } },
  { id: 'w',  style: { top: '50%', transform: 'translateY(-50%)', left: -HANDLE_PX / 2, cursor: 'w-resize' } },
];

export default function CropModal({ logo, onConfirm, onClose }: CropModalProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<CropBox | null>(null);
  const dragRef = useRef<{
    handle: Handle;
    startX: number;
    startY: number;
    startCrop: CropBox;
  } | null>(null);

  // Initialise crop box from existing fractions when the image finishes loading
  const initCrop = useCallback(() => {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    let { width, height } = rect;
    // Some browsers fire onload BEFORE first layout — bbox can be 0×0. Fall
    // back to natural dimensions scaled to fit our viewport so we never
    // produce a zero-sized crop (which would yield NaN fractions on confirm
    // and cause renderDesignToCanvas to draw a black box).
    if (width < 1 || height < 1) {
      const nw = imgRef.current.naturalWidth || 1;
      const nh = imgRef.current.naturalHeight || 1;
      const maxW = window.innerWidth * 0.8;
      const maxH = window.innerHeight * 0.68;
      const s = Math.min(maxW / nw, maxH / nh, 1);
      width = nw * s;
      height = nh * s;
    }
    setImgSize({ w: width, h: height });
    setCrop({
      x: (logo.cropX ?? 0) * width,
      y: (logo.cropY ?? 0) * height,
      w: (logo.cropW ?? 1) * width,
      h: (logo.cropH ?? 1) * height,
    });
  }, [logo]);

  const startDrag = useCallback(
    (e: React.MouseEvent, handle: Handle) => {
      e.preventDefault();
      e.stopPropagation();
      if (!crop) return;
      dragRef.current = { handle, startX: e.clientX, startY: e.clientY, startCrop: { ...crop } };
    },
    [crop],
  );

  // Global mouse-move / mouse-up so dragging doesn't break when cursor leaves the element
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current || !imgSize) return;
      const { handle, startX, startY, startCrop } = dragRef.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      let { x, y, w, h } = startCrop;

      if (handle === 'move') {
        x = Math.max(0, Math.min(imgSize.w - w, x + dx));
        y = Math.max(0, Math.min(imgSize.h - h, y + dy));
      } else {
        // East / West — affect x and w
        if (handle.includes('e')) {
          w = Math.max(MIN_SIZE, Math.min(imgSize.w - x, startCrop.w + dx));
        }
        if (handle.includes('w')) {
          const newX = Math.max(0, Math.min(startCrop.x + startCrop.w - MIN_SIZE, startCrop.x + dx));
          w = startCrop.x + startCrop.w - newX;
          x = newX;
        }
        // South / North — affect y and h
        if (handle.includes('s')) {
          h = Math.max(MIN_SIZE, Math.min(imgSize.h - y, startCrop.h + dy));
        }
        if (handle.includes('n')) {
          const newY = Math.max(0, Math.min(startCrop.y + startCrop.h - MIN_SIZE, startCrop.y + dy));
          h = startCrop.y + startCrop.h - newY;
          y = newY;
        }
      }
      setCrop({ x, y, w, h });
    };

    const onUp = () => { dragRef.current = null; };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [imgSize]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleConfirm = () => {
    if (!crop || !imgSize || imgSize.w < 1 || imgSize.h < 1) return;
    // Clamp into [0, 1] AND keep cropX+cropW <= 1 / cropY+cropH <= 1 so the
    // canvas renderer never tries to draw past the source's edge (which
    // produces transparent-black pixels filling the destination rect).
    const fx = Math.max(0, Math.min(1, crop.x / imgSize.w));
    const fy = Math.max(0, Math.min(1, crop.y / imgSize.h));
    const fw = Math.max(0.01, Math.min(1 - fx, crop.w / imgSize.w));
    const fh = Math.max(0.01, Math.min(1 - fy, crop.h / imgSize.h));
    onConfirm(fx, fy, fw, fh);
  };

  const hasCrop = crop && imgSize && (crop.x > 0 || crop.y > 0 || crop.w < imgSize.w || crop.h < imgSize.h);

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4"
      style={{ background: 'rgba(0,0,0,0.88)' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between w-full px-6" style={{ maxWidth: '90vw' }}>
        <p className="text-white font-semibold text-sm">Crop Image</p>
        <p className="text-slate-400 text-xs hidden sm:block">Drag the box or corner handles to crop</p>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white transition-colors p-1 rounded"
          title="Close (Esc)"
        >
          <svg viewBox="0 0 20 20" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>

      {/* ── Image + crop overlay ── */}
      <div className="relative inline-block select-none" style={{ userSelect: 'none' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={logo.src}
          alt=""
          draggable={false}
          onLoad={initCrop}
          style={{ maxWidth: '80vw', maxHeight: '68vh', display: 'block' }}
        />

        {crop && imgSize && (
          <div className="absolute inset-0" style={{ pointerEvents: 'none', userSelect: 'none' }}>
            {/* Four dark panels outside crop region */}
            <div className="absolute bg-black/60" style={{ top: 0, left: 0, right: 0, height: crop.y }} />
            <div className="absolute bg-black/60" style={{ top: crop.y + crop.h, left: 0, right: 0, bottom: 0 }} />
            <div className="absolute bg-black/60" style={{ top: crop.y, left: 0, width: crop.x, height: crop.h }} />
            <div className="absolute bg-black/60" style={{ top: crop.y, left: crop.x + crop.w, right: 0, height: crop.h }} />

            {/* Crop box */}
            <div
              className="absolute border-2 border-white"
              style={{
                top: crop.y,
                left: crop.x,
                width: crop.w,
                height: crop.h,
                cursor: 'move',
                boxSizing: 'border-box',
                pointerEvents: 'auto',
              }}
              onMouseDown={(e) => startDrag(e, 'move')}
            >
              {/* Rule-of-thirds grid lines */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute h-full border-r border-white/20" style={{ left: '33.33%' }} />
                <div className="absolute h-full border-r border-white/20" style={{ left: '66.66%' }} />
                <div className="absolute w-full border-b border-white/20" style={{ top: '33.33%' }} />
                <div className="absolute w-full border-b border-white/20" style={{ top: '66.66%' }} />
              </div>

              {/* Corner + edge resize handles */}
              {HANDLE_DEFS.map(({ id, style }) => (
                <div
                  key={id}
                  className="absolute bg-white rounded-sm shadow-md"
                  style={{
                    ...style,
                    width: HANDLE_PX,
                    height: HANDLE_PX,
                    pointerEvents: 'auto',
                  }}
                  onMouseDown={(e) => startDrag(e, id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Actions ── */}
      <div className="flex items-center gap-3">
        {hasCrop && (
          <button
            onClick={() => {
              if (!imgSize) return;
              setCrop({ x: 0, y: 0, w: imgSize.w, h: imgSize.h });
            }}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-400 hover:text-white transition-colors border border-slate-700"
          >
            Reset
          </button>
        )}
        <button
          onClick={onClose}
          className="px-5 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm text-white transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm text-white font-semibold transition-colors"
        >
          Apply Crop
        </button>
      </div>
    </div>
  );
}
