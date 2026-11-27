// The "printer" device of plugin screens: USB thermal receipt printers (ESC/POS), run by the school page.
//
// A screen sends a receipt as plain structured lines (never HTML). The school page draws them on a canvas
// with the browser's fonts (Khmer included: thermal printers have no Khmer font), turns the picture into
// black and white, and sends it to the printer as an ESC/POS raster image, then feeds and cuts. It can also
// open the cash drawer (the drawer is wired to the printer). The printer is chosen once per browser through
// WebUSB (the browser's own chooser; Chrome and Edge on Windows, macOS, Android, ChromeOS).

export type PrintLine =
  | { text: string; right?: string; align?: 'left' | 'center' | 'right'; bold?: boolean; size?: 1 | 2 }
  | { divider: true }
  | { image: string; width?: number }
  | { feed: number };
export type PrintJob = { width: 58 | 80; lines: PrintLine[]; cut: boolean; drawer: boolean };

export const PRINT_LIMITS = { lines: 400, text: 200, images: 3, imageBytes: 400 * 1024 };
const DOTS = { 58: 384, 80: 576 } as const; // printable dots per line at 203 dpi
const plain = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').slice(0, max) : '');

/** A validated print job from an untrusted message, or null. */
export function parsePrintJob(value: unknown): PrintJob | null {
  if (!value || typeof value !== 'object') return null;
  const job = value as Record<string, unknown>;
  if (!Array.isArray(job.lines) || job.lines.length > PRINT_LIMITS.lines) return null;
  let images = 0;
  const lines: PrintLine[] = [];
  for (const raw of job.lines as unknown[]) {
    if (!raw || typeof raw !== 'object') return null;
    const line = raw as Record<string, unknown>;
    if (line.divider === true) lines.push({ divider: true });
    else if (typeof line.feed === 'number') lines.push({ feed: Math.min(10, Math.max(1, Math.round(line.feed))) });
    else if (typeof line.image === 'string') {
      images += 1;
      if (images > PRINT_LIMITS.images || line.image.length > PRINT_LIMITS.imageBytes * 1.37 || !/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(line.image)) return null;
      lines.push({ image: line.image, width: typeof line.width === 'number' ? Math.min(1, Math.max(0.1, line.width)) : 0.6 });
    } else if (typeof line.text === 'string') {
      lines.push({
        text: plain(line.text, PRINT_LIMITS.text), ...(typeof line.right === 'string' ? { right: plain(line.right, 60) } : {}),
        align: line.align === 'center' || line.align === 'right' ? line.align : 'left', bold: line.bold === true, size: line.size === 2 ? 2 : 1,
      });
    } else return null;
  }
  return { width: job.width === 58 ? 58 : 80, lines, cut: job.cut !== false, drawer: job.drawer === true };
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });

/** Draws the job on a canvas exactly as wide as the paper's printable dots. */
export async function renderReceipt(job: PrintJob): Promise<HTMLCanvasElement> {
  const width = DOTS[job.width];
  const font = (size: number, bold: boolean) => `${bold ? '700' : '400'} ${size === 2 ? 34 : 24}px "Noto Sans Khmer", "Khmer OS", "Kantumruy Pro", system-ui, sans-serif`;
  const images = await Promise.all(job.lines.map((line) => ('image' in line ? loadImage(line.image) : Promise.resolve(null))));
  const scratch = document.createElement('canvas').getContext('2d')!;
  // first the height (text wraps to the paper width)
  const blocks: Array<{ h: number; draw: (ctx: CanvasRenderingContext2D, y: number) => void }> = [];
  job.lines.forEach((line, index) => {
    if ('divider' in line) { blocks.push({ h: 14, draw: (ctx, y) => { ctx.fillRect(0, y + 6, width, 2); } }); return; }
    if ('feed' in line) { blocks.push({ h: line.feed * 24, draw: () => undefined }); return; }
    if ('image' in line) {
      const img = images[index]!; const w = Math.round(width * (line.width || 0.6)); const h = Math.round(img.height * (w / img.width));
      blocks.push({ h: h + 6, draw: (ctx, y) => { ctx.drawImage(img, Math.round((width - w) / 2), y + 3, w, h); } });
      return;
    }
    const size = line.size || 1, lineHeight = size === 2 ? 42 : 30;
    scratch.font = font(size, Boolean(line.bold));
    const rightWidth = line.right ? scratch.measureText(line.right).width + 12 : 0;
    const words = line.text.split(/(\s+)/); const rows: string[] = []; let current = '';
    for (const word of words) {
      const next = current + word;
      if (scratch.measureText(next).width > width - rightWidth && current.trim()) { rows.push(current.trimEnd()); current = word.trimStart(); }
      else current = next;
    }
    rows.push(current);
    blocks.push({ h: rows.length * lineHeight, draw: (ctx, y) => {
      ctx.font = font(size, Boolean(line.bold)); ctx.textBaseline = 'top';
      rows.forEach((row, i) => {
        const top = y + i * lineHeight;
        if (line.align === 'center') { ctx.textAlign = 'center'; ctx.fillText(row, width / 2, top); }
        else if (line.align === 'right') { ctx.textAlign = 'right'; ctx.fillText(row, width, top); }
        else { ctx.textAlign = 'left'; ctx.fillText(row, 0, top); }
      });
      if (line.right) { ctx.textAlign = 'right'; ctx.fillText(line.right, width, y); }
    } });
  });
  const height = Math.max(24, blocks.reduce((sum, b) => sum + b.h, 0));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.fillStyle = '#000';
  let y = 0;
  for (const block of blocks) { block.draw(ctx, y); y += block.h; }
  return canvas;
}

/** ESC/POS bytes: initialise, the picture as raster bands (GS v 0), feed, cut; the drawer pulse if asked. */
export function encodeEscPos(canvas: HTMLCanvasElement, options: { cut: boolean; drawer: boolean }): Uint8Array {
  const { width, height } = canvas;
  const pixels = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height).data;
  const bytesPerRow = Math.ceil(width / 8);
  const out: number[] = [0x1b, 0x40]; // ESC @ initialise
  const BAND = 256; // rows per raster command (some printers cannot take one tall image)
  for (let top = 0; top < height; top += BAND) {
    const rows = Math.min(BAND, height - top);
    out.push(0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8);
    for (let y = top; y < top + rows; y += 1) {
      for (let byte = 0; byte < bytesPerRow; byte += 1) {
        let bits = 0;
        for (let bit = 0; bit < 8; bit += 1) {
          const x = byte * 8 + bit;
          if (x >= width) continue;
          const i = (y * width + x) * 4;
          const luminance = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
          if (pixels[i + 3] > 127 && luminance < 150) bits |= 0x80 >> bit;
        }
        out.push(bits);
      }
    }
  }
  out.push(0x1b, 0x64, 0x04); // feed 4 lines
  if (options.cut) out.push(0x1d, 0x56, 0x42, 0x00); // partial cut
  if (options.drawer) out.push(0x1b, 0x70, 0x00, 0x19, 0xfa); // pulse drawer pin 2
  return new Uint8Array(out);
}
export const DRAWER_PULSE = new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa]);

// ---------- WebUSB ----------
type UsbEndpoint = { endpointNumber: number; direction: 'in' | 'out'; type: string };
type UsbInterface = { interfaceNumber: number; claimed: boolean; alternate: { interfaceClass: number; endpoints: UsbEndpoint[] } };
export type UsbPrinter = { productName?: string; opened: boolean; configuration: { interfaces: UsbInterface[] } | null; open(): Promise<void>; selectConfiguration(n: number): Promise<void>; claimInterface(n: number): Promise<void>; transferOut(endpoint: number, data: BufferSource): Promise<unknown> };
type Usb = { getDevices(): Promise<UsbPrinter[]>; requestDevice(options: { filters: Array<{ classCode?: number }> }): Promise<UsbPrinter> };
const usb = (): Usb | null => (typeof navigator !== 'undefined' && (navigator as unknown as { usb?: Usb }).usb) || null;

export const usbPrintingAvailable = () => Boolean(usb());
/** The printer this browser was given before (no prompt), or null. */
export async function rememberedPrinter(): Promise<UsbPrinter | null> {
  const api = usb(); if (!api) return null;
  const devices = await api.getDevices();
  return devices.find((d) => d.configuration?.interfaces.some((i) => i.alternate.interfaceClass === 7)) || devices[0] || null;
}
/** Asks the person to choose the printer (needs a click: the browser shows its own chooser). */
export async function choosePrinter(): Promise<UsbPrinter> {
  const api = usb(); if (!api) throw new Error('This browser cannot reach USB printers (use Chrome or Edge), or print through the browser instead.');
  return api.requestDevice({ filters: [{ classCode: 7 }, {}] });
}
/** Sends bytes to the printer's bulk OUT endpoint, in chunks. */
export async function sendToPrinter(device: UsbPrinter, data: Uint8Array): Promise<void> {
  if (!device.opened) await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  const interfaces = device.configuration!.interfaces;
  const chosen = interfaces.find((i) => i.alternate.interfaceClass === 7) || interfaces.find((i) => i.alternate.endpoints.some((e) => e.direction === 'out' && e.type === 'bulk'));
  if (!chosen) throw new Error('This USB device is not a printer.');
  if (!chosen.claimed) await device.claimInterface(chosen.interfaceNumber);
  const endpoint = chosen.alternate.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
  if (!endpoint) throw new Error('The printer has no output endpoint.');
  for (let start = 0; start < data.length; start += 16384) await device.transferOut(endpoint.endpointNumber, data.slice(start, start + 16384));
}
