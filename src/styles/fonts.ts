/**
 * Self-hosted fonts (no external requests). Each weight file declares all
 * subsets with `unicode-range`, so the browser downloads only Latin + Cyrillic.
 *
 * Cormorant Garamond — antiqua headings / inscriptions
 * Spectral           — subtitles and the letter text
 * Inter (variable)   — small UI labels
 */
import '@fontsource/cormorant-garamond/400.css'
import '@fontsource/cormorant-garamond/500.css'
import '@fontsource/cormorant-garamond/600.css'
import '@fontsource/cormorant-garamond/400-italic.css'
import '@fontsource/spectral/300.css'
import '@fontsource/spectral/400.css'
import '@fontsource/spectral/400-italic.css'
import '@fontsource-variable/inter'

export const FONT_ANTIQUA = "'Cormorant Garamond', 'Cormorant', Garamond, 'Times New Roman', serif"
export const FONT_TEXT = "'Spectral', 'Iowan Old Style', Georgia, serif"
export const FONT_UI = "'Inter Variable', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif"
