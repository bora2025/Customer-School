'use client';

import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api';

type Element = { id: string; type: 'text' | 'image' | 'qr' | 'shape' | 'photo'; x: number; y: number; width: number; height: number; rotation: number; zIndex?: number; value?: string; binding?: string; assetId?: string; fit?: 'contain' | 'cover' | 'fill'; color?: string; fontSize?: number; fontWeight?: 'normal' | 'bold'; fontStyle?: 'normal' | 'italic'; fontFamily?: string; textAlign?: 'left' | 'center' | 'right'; shapeType?: 'rectangle' | 'circle' | 'line'; fill?: string; borderColor?: string; borderWidth?: number; borderRadius?: number; opacity?: number; lineStyle?: 'solid' | 'dashed' | 'dotted'; gradient?: { enabled: boolean; type: 'linear' | 'radial'; angle: number; stops: { offset: number; color: string }[] } };
type Document = { id: string; page: { width: number; height: number; background: string; frameColor?: string; frameWidth?: number; borderRadius?: number }; elements: Element[] };

function documents(value: unknown): Document[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item: any) => item && typeof item.id === 'string' && item.page && Array.isArray(item.elements));
}

function AssetImage({ pluginId, element }: { pluginId: string; element: Element }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let active = true;
    if (!element.assetId) return;
    apiFetch(`/api/plugin-api/${encodeURIComponent(pluginId)}/assets/${encodeURIComponent(element.assetId)}`).then(async (response) => {
      const result = await response.json().catch(() => ({}));
      if (active && response.ok && typeof result.dataBase64 === 'string' && typeof result.mimeType === 'string') setSrc(`data:${result.mimeType};base64,${result.dataBase64}`);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [pluginId, element.assetId]);
  return src ? <img className="h-full w-full" style={{ objectFit: element.fit || 'contain' }} src={src} alt="" /> : <span className="flex h-full items-center justify-center bg-slate-100 text-xs text-slate-500">Image unavailable</span>;
}

function PhotoImage({ element }: { element: Element }) {
  const source = typeof element.value === 'string' && (/^\/(?!\/)/.test(element.value) || /^data:image\/(?:png|jpeg|webp);base64,/.test(element.value)) ? element.value : '';
  return source ? <img src={source} alt="" className="h-full w-full" style={{ objectFit: element.fit || 'cover', borderColor: element.borderColor, borderStyle: 'solid', borderWidth: element.borderWidth, borderRadius: element.borderRadius }} /> : null;
}

function shapeBackground(element: Element) {
  const gradient = element.gradient;
  if (!gradient?.enabled || gradient.stops.length < 2) return element.fill;
  const stops = gradient.stops.map((stop) => `${stop.color} ${stop.offset * 100}%`).join(', ');
  return gradient.type === 'radial' ? `radial-gradient(circle, ${stops})` : `linear-gradient(${gradient.angle}deg, ${stops})`;
}

function QrImage({ value }: { value: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => { let active = true; QRCode.toDataURL(value || ' ', { margin: 0, errorCorrectionLevel: 'M' }).then((url) => { if (active) setSrc(url); }).catch(() => undefined); return () => { active = false; }; }, [value]);
  return src ? <img className="h-full w-full" src={src} alt="QR code" /> : null;
}

export default function PluginDocumentPreview({ pluginId, title, value, options, loading, error }: { pluginId: string; title?: string; value: unknown; options: { formats: Array<'print' | 'pdf'>; maximumDocuments?: number }; loading: boolean; error?: string }) {
  const pages = useMemo(() => documents(value).slice(0, options.maximumDocuments || 500), [value, options.maximumDocuments]);
  if (loading) return <section className="card p-6" aria-busy="true">Preparing document preview…</section>;
  if (error) return <section className="card border-red-200 p-6 text-red-700" role="alert">{error}</section>;
  return <section className="card overflow-hidden print:fixed print:inset-0 print:z-50 print:overflow-visible print:bg-white">
    <div className="flex items-center justify-between border-b border-slate-200 p-4 print:hidden"><h2 className="font-semibold text-slate-800">{title || 'Document preview'}</h2><div className="flex gap-2">{options.formats.includes('print') && <button className="btn btn-secondary" onClick={() => window.print()}>Print</button>}{options.formats.includes('pdf') && <button className="btn btn-primary" onClick={() => window.print()}>Save as PDF</button>}</div></div>
    <div className="space-y-6 overflow-auto bg-slate-100 p-5 print:space-y-0 print:overflow-visible print:bg-white print:p-0">{pages.map((page) => <div key={page.id} className="relative mx-auto origin-top overflow-hidden shadow print:break-after-page print:shadow-none" style={{ width: page.page.width, height: page.page.height, background: page.page.background, borderColor: page.page.frameColor, borderStyle: page.page.frameWidth ? 'solid' : undefined, borderWidth: page.page.frameWidth, borderRadius: page.page.borderRadius }} data-document-id={page.id}>{[...page.elements].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0)).map((element) => <div key={element.id} className="absolute overflow-hidden" style={{ left: element.x, top: element.y, width: element.width, height: element.height, transform: `rotate(${element.rotation || 0}deg)`, zIndex: element.zIndex, color: element.color, fontSize: element.fontSize, fontWeight: element.fontWeight, fontStyle: element.fontStyle, fontFamily: element.fontFamily, textAlign: element.textAlign, whiteSpace: 'pre-wrap', ...(['image', 'qr'].includes(element.type) ? { borderColor: element.borderColor, borderStyle: 'solid', borderWidth: element.borderWidth, borderRadius: element.borderRadius, opacity: element.opacity } : {}), ...(element.type === 'shape' ? { background: shapeBackground(element), borderColor: element.borderColor, borderStyle: element.lineStyle || 'solid', borderWidth: element.borderWidth, borderRadius: element.shapeType === 'circle' ? '50%' : element.borderRadius, opacity: element.opacity } : {}) }}>{element.type === 'image' ? <AssetImage pluginId={pluginId} element={element} /> : element.type === 'photo' ? <PhotoImage element={element} /> : element.type === 'qr' ? <QrImage value={element.value || ''} /> : element.type === 'shape' ? null : element.value}</div>)}</div>)}{!pages.length && <p className="py-8 text-center text-sm text-slate-500">Generate authorized records to preview documents.</p>}</div>
  </section>;
}
