// Shared font/size/line-spacing option lists for text-formatting toolbars — kept in
// one place so RichTextEditor's question-text toolbar and Fill in the Blanks' prompt
// toolbar always offer the same choices.

export const FONT_FAMILIES = [
  { label: 'Default', value: '' },
  { label: 'Sans Serif', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Monospace', value: '"Courier New", monospace' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Comic Sans', value: '"Comic Sans MS", cursive' },
] as const

export const FONT_SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px'] as const

export const LINE_HEIGHTS = [
  { label: 'Single', value: '1' },
  { label: '1.15', value: '1.15' },
  { label: '1.5', value: '1.5' },
  { label: 'Double', value: '2' },
] as const

// Block-level (whole-box) presentation style for plain-text prompt boxes that can't
// use the full TipTap rich text editor — Fill in the Blanks' sentence needs to stay
// plain text so its *word*-markup parsing (source of truth for blanks/answers/grading)
// isn't disturbed by inline HTML formatting. Keys double as valid React inline-style
// props, so this can be spread straight into a `style` attribute with no conversion.
export interface BlockTextStyle {
  fontFamily?: string
  fontSize?: string
  textAlign?: 'left' | 'center' | 'right' | 'justify'
  lineHeight?: string
}
