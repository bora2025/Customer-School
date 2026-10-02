import { CardDesign, TextElement, LogoElement, ShapeElement, PhotoPlaceholder, QrPlaceholder } from './types';

interface RenderContext {
  /** Values to replace template placeholders like {{Student Name}} */
  fieldValues?: Record<string, string>;
  /** QR code data URL to render */
  qrDataUrl?: string;
  /** Photo URL or data URL */
  photoUrl?: string | null;
  /** Render scale multiplier (default 3 ≈ 300 DPI for standard ID cards) */
  scale?: number;
}

/**
 * Renders a CardDesign into an HTMLCanvasElement, substituting
 * template placeholders ({{...}}) with real values and drawing
 * the QR code and photo images.
 */
export async function renderDesignToCanvas(
  design: CardDesign,
  ctx2: RenderContext = {},
): Promise<HTMLCanvasElement> {
  const scale = ctx2.scale ?? 3; // default ≈ 300 DPI for standard 85.6 mm ID card
  const canvas = document.createElement('canvas');
  canvas.width = design.width * scale;
  canvas.height = design.height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  // --- Background + frame ---
  if (design.frameWidth > 0) {
    ctx.fillStyle = design.frameColor;
    ctx.beginPath();
    ctx.roundRect(0, 0, design.width, design.height, 12);
    ctx.fill();
    ctx.fillStyle = design.backgroundColor;
    const fw = design.frameWidth;
    ctx.beginPath();
    ctx.roundRect(fw, fw, design.width - fw * 2, design.height - fw * 2, Math.max(0, 12 - fw));
    ctx.fill();
  } else {
    ctx.fillStyle = design.backgroundColor;
    ctx.beginPath();
    ctx.roundRect(0, 0, design.width, design.height, 12);
    ctx.fill();
  }

  // --- Photo placeholder — rendered in z-index sorted loop below ---

  // --- QR code — rendered in z-index sorted loop below ---

  // --- All elements sorted by zIndex ---
  type RenderItem =
    | { kind: 'photo'; z: number; data: PhotoPlaceholder }
    | { kind: 'qr'; z: number; data: QrPlaceholder }
    | { kind: 'shape'; z: number; data: ShapeElement }
    | { kind: 'logo'; z: number; data: LogoElement }
    | { kind: 'text'; z: number; data: TextElement };

  const items: RenderItem[] = [
    ...(design.photo && design.photo.visible !== false ? [{ kind: 'photo' as const, z: design.photo.zIndex ?? 0, data: design.photo }] : []),
    ...(design.qr && design.qr.visible !== false ? [{ kind: 'qr' as const, z: design.qr.zIndex ?? 0, data: design.qr }] : []),
    ...(design.shapes ?? []).filter((s) => s.visible !== false).map((s) => ({ kind: 'shape' as const, z: s.zIndex ?? 0, data: s })),
    ...design.logos.filter((l) => l.visible !== false).map((l) => ({ kind: 'logo' as const, z: l.zIndex ?? 0, data: l })),
    ...design.texts.filter((t) => t.visible !== false).map((t) => ({ kind: 'text' as const, z: t.zIndex ?? 0, data: t })),
  ].sort((a, b) => a.z - b.z);

  for (const item of items) {
    if (item.kind === 'photo') {
      const p = item.data as PhotoPlaceholder;
      if (ctx2.photoUrl) {
        await drawImageInRect(ctx, ctx2.photoUrl, p.x, p.y, p.width, p.height, p.borderRadius, p.borderColor, p.borderWidth);
      } else {
        // No photo URL: draw canvas-native avatar (matches preview appearance)
        drawPersonAvatar(ctx, p.x, p.y, p.width, p.height, p.borderRadius);
        if (p.borderWidth > 0) {
          ctx.strokeStyle = p.borderColor;
          ctx.lineWidth = p.borderWidth;
          ctx.beginPath();
          ctx.roundRect(p.x, p.y, p.width, p.height, p.borderRadius);
          ctx.stroke();
        }
      }
    } else if (item.kind === 'qr') {
      const q = item.data as QrPlaceholder;
      if (ctx2.qrDataUrl) {
        await drawImg(ctx, ctx2.qrDataUrl, q.x, q.y, q.width, q.height);
      } else {
        ctx.save();
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.roundRect(q.x, q.y, q.width, q.height, q.borderRadius);
        ctx.fill();
        if (q.borderWidth > 0) {
          ctx.strokeStyle = q.borderColor;
          ctx.lineWidth = q.borderWidth;
          ctx.stroke();
        }
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'normal normal 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('QR Code', q.x + q.width / 2, q.y + q.height / 2 + 3);
        ctx.textAlign = 'start';
        ctx.restore();
      }
    } else if (item.kind === 'shape') {
      const shape = item.data;
      ctx.save();
      ctx.globalAlpha = shape.opacity;

      const cx = shape.x + shape.width / 2;
      const cy = shape.y + shape.height / 2;
      if (shape.rotation) {
        ctx.translate(cx, cy);
        ctx.rotate((shape.rotation * Math.PI) / 180);
        ctx.translate(-cx, -cy);
      }

      let fillStyle: string | CanvasGradient = shape.color;
      if (shape.gradient?.enabled && shape.gradient.stops.length >= 2) {
        if (shape.gradient.type === 'linear') {
          const rad = (shape.gradient.angle * Math.PI) / 180;
          const gcx = shape.x + shape.width / 2;
          const gcy = shape.y + shape.height / 2;
          const len = Math.max(shape.width, shape.height) / 2;
          const grad = ctx.createLinearGradient(
            gcx - Math.cos(rad) * len,
            gcy - Math.sin(rad) * len,
            gcx + Math.cos(rad) * len,
            gcy + Math.sin(rad) * len,
          );
          for (const s of shape.gradient.stops) grad.addColorStop(s.offset, s.color);
          fillStyle = grad;
        } else {
          const gcx = shape.x + shape.width / 2;
          const gcy = shape.y + shape.height / 2;
          const r = Math.max(shape.width, shape.height) / 2;
          const grad = ctx.createRadialGradient(gcx, gcy, 0, gcx, gcy, r);
          for (const s of shape.gradient.stops) grad.addColorStop(s.offset, s.color);
          fillStyle = grad;
        }
      }

      if (shape.type === 'circle') {
        ctx.beginPath();
        ctx.ellipse(
          shape.x + shape.width / 2,
          shape.y + shape.height / 2,
          shape.width / 2,
          shape.height / 2,
          0, 0, Math.PI * 2,
        );
        ctx.fillStyle = fillStyle;
        ctx.fill();
        if (shape.borderWidth > 0) {
          ctx.strokeStyle = shape.borderColor;
          ctx.lineWidth = shape.borderWidth;
          ctx.stroke();
        }
      } else if (shape.type === 'line') {
        ctx.strokeStyle = typeof fillStyle === 'string' ? fillStyle : shape.color;
        ctx.lineWidth = Math.max(shape.borderWidth, 2);
        ctx.beginPath();
        ctx.moveTo(shape.x, shape.y + shape.height / 2);
        ctx.lineTo(shape.x + shape.width, shape.y + shape.height / 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.roundRect(shape.x, shape.y, shape.width, shape.height, shape.borderRadius);
        ctx.fillStyle = fillStyle;
        ctx.fill();
        if (shape.borderWidth > 0) {
          ctx.strokeStyle = shape.borderColor;
          ctx.lineWidth = shape.borderWidth;
          ctx.stroke();
        }
      }

      ctx.restore();
    } else if (item.kind === 'logo') {
      const logo = item.data;
      ctx.save();
      ctx.globalAlpha = logo.opacity ?? 1;
      if (logo.blur && logo.blur > 0) {
        ctx.filter = `blur(${logo.blur}px)`;
      }
      // Clip to border-radius if set
      if (logo.borderRadius && logo.borderRadius > 0) {
        ctx.beginPath();
        ctx.roundRect(logo.x, logo.y, logo.width, logo.height, logo.borderRadius);
        ctx.clip();
      }
      // Draw with optional crop
      await drawLogoImg(ctx, logo.src, logo.x, logo.y, logo.width, logo.height, {
        cropX: logo.cropX, cropY: logo.cropY, cropW: logo.cropW, cropH: logo.cropH,
      });
      ctx.restore();
    } else {
      const text = item.data;
      const content = substituteFields(text.content, ctx2.fieldValues);
      ctx.fillStyle = text.color;
      ctx.font = `${text.fontStyle} ${text.fontWeight} ${text.fontSize}px ${text.fontFamily ?? 'Inter, sans-serif'}`;
      const align = text.textAlign ?? 'left';
      ctx.textAlign = align === 'left' ? 'start' : align === 'right' ? 'end' : 'center';
      ctx.textBaseline = 'alphabetic';
      let drawX = text.x;
      if (align === 'center') {
        drawX = design.width / 2;
      } else if (align === 'right') {
        drawX = design.width - text.x;
      }
      ctx.fillText(content, drawX, text.y + text.fontSize);
      ctx.textAlign = 'start';
    }
  }

  return canvas;
}

/** Replace {{Placeholder}} tokens with real values (case-insensitive key matching) */
function substituteFields(template: string, values?: Record<string, string>): string {
  if (!values) return template;
  // Build a lowercase lookup so {{Phone}} matches 'phone', '{{phone}}', 'Phone', '{{Phone}}', etc.
  const lowerMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    lowerMap[k.toLowerCase()] = v;
  }
  return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmed = key.trim();
    const lk = trimmed.toLowerCase();
    // Priority: exact with braces → exact plain → case-insensitive with braces → case-insensitive plain
    return values[`{{${trimmed}}}`] ?? values[trimmed] ?? lowerMap[`{{${lk}}}`] ?? lowerMap[lk] ?? match;
  });
}

function drawImg(
  ctx: CanvasRenderingContext2D,
  src: string,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => { resolve(); }, 3000);
    img.onload = () => { clearTimeout(timer); ctx.drawImage(img, x, y, w, h); resolve(); };
    img.onerror = () => { clearTimeout(timer); resolve(); };
    img.src = getProxiedUrl(src);
  });
}

/** Draw logo with optional crop fractions (0–1) */
function drawLogoImg(
  ctx: CanvasRenderingContext2D,
  src: string,
  x: number,
  y: number,
  w: number,
  h: number,
  crop?: { cropX?: number; cropY?: number; cropW?: number; cropH?: number },
): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => { resolve(); }, 3000);
    img.onload = () => {
      clearTimeout(timer);
      // Clamp crop fractions: cropX/Y in [0,1], cropW/H in (0,1], and
      // cropX+cropW <= 1 / cropY+cropH <= 1 so drawImage never reads past the
      // source. Out-of-range source rects produce transparent-black pixels in
      // the destination — the very symptom the user reported.
      const cwf = Math.max(0.001, Math.min(1, crop?.cropW ?? 1));
      const chf = Math.max(0.001, Math.min(1, crop?.cropH ?? 1));
      const cxf = Math.max(0, Math.min(1 - cwf, crop?.cropX ?? 0));
      const cyf = Math.max(0, Math.min(1 - chf, crop?.cropY ?? 0));
      const cx = cxf * img.naturalWidth;
      const cy = cyf * img.naturalHeight;
      const cw = cwf * img.naturalWidth;
      const ch = chf * img.naturalHeight;
      ctx.drawImage(img, cx, cy, cw, ch, x, y, w, h);
      resolve();
    };
    img.onerror = () => { clearTimeout(timer); resolve(); };
    img.src = getProxiedUrl(src);
  });
}

function getProxiedUrl(src: string): string {
  // If it's already a data URL or a local URL, use as-is
  if (src.startsWith('data:') || src.startsWith('/') || src.startsWith('blob:')) {
    return src;
  }
  // Convert Google Drive sharing URLs to direct image URLs
  let url = src;
  const m1 = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (m1) url = `https://lh3.googleusercontent.com/d/${m1[1]}`;
  const m2 = url.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (m2) url = `https://lh3.googleusercontent.com/d/${m2[1]}`;
  const m3 = url.match(/drive\.google\.com\/uc\?.*id=([^&]+)/);
  if (m3) url = `https://lh3.googleusercontent.com/d/${m3[1]}`;
  // Proxy external URLs through our API to avoid CORS issues
  return `/api/proxy-image?url=${encodeURIComponent(url)}`;
}

function drawImageInRect(
  ctx: CanvasRenderingContext2D,
  src: string,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  borderColor: string,
  borderWidth: number,
): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    // Do NOT set crossOrigin for data: / blob: URLs — it causes SVG load failures
    if (!src.startsWith('data:') && !src.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    const timer = setTimeout(() => { resolve(); }, 3000);
    img.onload = () => {
      clearTimeout(timer);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.clip();
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();
      if (borderWidth > 0) {
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = borderWidth;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, radius);
        ctx.stroke();
      }
      resolve();
    };
    img.onerror = () => {
      clearTimeout(timer);
      // Fallback: canvas-drawn person avatar (purple gradient)
      drawPersonAvatar(ctx, x, y, w, h, radius);
      resolve();
    };
    img.src = getProxiedUrl(src);
  });
}

/** Canvas-native person silhouette — used when no photo URL is available. */
function drawPersonAvatar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.clip();
  // gradient background
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, '#6366f1');
  grad.addColorStop(1, '#8b5cf6');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  // head circle
  const headR = Math.min(w, h) * 0.18;
  const headX = x + w / 2;
  const headY = y + h * 0.35;
  ctx.beginPath();
  ctx.arc(headX, headY, headR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fill();
  // body arc
  const bodyR = Math.min(w, h) * 0.3;
  ctx.beginPath();
  ctx.arc(headX, y + h * 0.95, bodyR, Math.PI, 0);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fill();
  ctx.restore();
}
