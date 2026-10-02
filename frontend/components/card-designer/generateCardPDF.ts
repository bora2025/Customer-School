import jsPDF from 'jspdf';
import { CardDesign, CARD_SIZE_PRESETS } from './types';
import { renderDesignToCanvas } from './renderDesignToCanvas';

interface CardEntry {
  name: string;
  fieldValues: Record<string, string>;
  qrDataUrl?: string;
  photoUrl?: string | null;
}

// Render scale 4× ≈ 400 DPI — high quality print
const RENDER_SCALE = 4;

/** Convert a canvas to a high-quality PNG data URL. */
function canvasToImage(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}

/**
 * Physical card sizes in mm for each preset.
 * These are the real-world print dimensions.
 */
const PHYSICAL_SIZES_MM: Record<string, { w: number; h: number }> = {
  'credit': { w: 85.6, h: 53.98 },
  'id-1':   { w: 85.6, h: 53.98 },
  'a7':     { w: 74,   h: 105 },
};

/** Convert a design's pixel dimensions to mm for PDF output. */
function designToMM(design: CardDesign): { wMM: number; hMM: number } {
  const physical = PHYSICAL_SIZES_MM[design.size];
  if (physical) {
    // Use exact physical size from preset
    return { wMM: physical.w, hMM: physical.h };
  }
  // Custom size: derive from the known credit-card ratio (340 px = 85.6 mm → 3.972 px/mm)
  const PX_PER_MM = CARD_SIZE_PRESETS['credit'].width / 85.6; // ≈ 3.972
  return { wMM: design.width / PX_PER_MM, hMM: design.height / PX_PER_MM };
}

/**
 * Generate a PDF with a single ID card, sized to match the card dimensions.
 */
export async function downloadSingleCardPDF(
  design: CardDesign,
  entry: CardEntry,
) {
  const canvas = await renderDesignToCanvas(design, {
    fieldValues: entry.fieldValues,
    qrDataUrl: entry.qrDataUrl,
    photoUrl: entry.photoUrl,
    scale: RENDER_SCALE,
  });

  const { wMM: cardWmm, hMM: cardHmm } = designToMM(design);

  const orientation = cardWmm > cardHmm ? 'l' : 'p';
  const pdf = new jsPDF({ orientation, unit: 'mm', format: [cardWmm, cardHmm], compress: true });

  const imgData = canvasToImage(canvas);
  pdf.addImage(imgData, 'PNG', 0, 0, cardWmm, cardHmm);

  const safeName = entry.name.replace(/[^a-zA-Z0-9]/g, '-');
  pdf.save(`${safeName}-id-card.pdf`);
}

/**
 * Generate an A4 PDF with multiple cards arranged in a grid with cut lines.
 */
export async function downloadA4CardsPDF(
  design: CardDesign,
  entries: CardEntry[],
  title?: string,
) {
  if (entries.length === 0) return;

  // A4 dimensions in mm
  const PAGE_W = 210;
  const PAGE_H = 297;
  const MARGIN = 10; // mm margin on each side
  const GAP = 3; // mm gap between cards
  const HEADER_H = 12; // mm space for title at top of first page

  // Card dimensions in mm — exact physical size
  const { wMM: cardWmm, hMM: cardHmm } = designToMM(design);

  // How many cards fit per row / column
  const usableW = PAGE_W - 2 * MARGIN;
  const usableH = PAGE_H - 2 * MARGIN;
  const cols = Math.max(1, Math.floor((usableW + GAP) / (cardWmm + GAP)));
  const rows = Math.max(1, Math.floor((usableH + GAP) / (cardHmm + GAP)));
  const perPage = cols * rows;

  // Center the grid on the page
  const gridW = cols * cardWmm + (cols - 1) * GAP;
  const gridH = rows * cardHmm + (rows - 1) * GAP;
  const offsetX = (PAGE_W - gridW) / 2;
  const offsetY = (PAGE_H - gridH) / 2;

  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });

  // Render all card canvases in batches and convert to compact JPEG
  const BATCH = 10;
  const images: string[] = [];
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const canvases = await Promise.all(
      batch.map((e) =>
        renderDesignToCanvas(design, {
          fieldValues: e.fieldValues,
          qrDataUrl: e.qrDataUrl,
          photoUrl: e.photoUrl,
          scale: RENDER_SCALE,
        }),
      ),
    );
    images.push(...canvases.map((c) => canvasToImage(c)));
  }

  const totalPages = Math.ceil(entries.length / perPage);

  for (let page = 0; page < totalPages; page++) {
    if (page > 0) pdf.addPage('a4', 'p');

    // Title on first page
    if (page === 0 && title) {
      pdf.setFontSize(11);
      pdf.setTextColor(30, 41, 59);
      pdf.text(title, PAGE_W / 2, MARGIN + 6, { align: 'center' });
    }

    const startBaseY = page === 0 && title ? offsetY + HEADER_H / 2 : offsetY;

    const startIdx = page * perPage;
    const endIdx = Math.min(startIdx + perPage, entries.length);

    for (let i = startIdx; i < endIdx; i++) {
      const localIdx = i - startIdx;
      const col = localIdx % cols;
      const row = Math.floor(localIdx / cols);
      const x = offsetX + col * (cardWmm + GAP);
      const y = startBaseY + row * (cardHmm + GAP);

      // Draw card image
      pdf.addImage(images[i], 'PNG', x, y, cardWmm, cardHmm);

      // Cut guide (light dashed border)
      pdf.setDrawColor(200, 200, 200);
      pdf.setLineWidth(0.15);
      pdf.setLineDashPattern([1.5, 1.5], 0);
      pdf.rect(x, y, cardWmm, cardHmm);
    }

    // Page number
    pdf.setFontSize(8);
    pdf.setTextColor(160, 160, 160);
    pdf.text(`Page ${page + 1} / ${totalPages}`, PAGE_W / 2, PAGE_H - 5, { align: 'center' });
  }

  const safeTitle = (title || 'id-cards').replace(/[^a-zA-Z0-9]/g, '-');
  pdf.save(`${safeTitle}-A4.pdf`);
}
