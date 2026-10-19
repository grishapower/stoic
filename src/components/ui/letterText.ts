import { letterLines, lineText, script } from '../../data/narration'
import type { ScriptBlock } from '../../data/narration/types'

/** Read-only views of the letter for the UI (letter lines only; authored lines never appear here). */

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

export function roman(n: number): string {
  return ROMAN[n - 1] ?? String(n)
}

export interface LetterLineView {
  id: string
  ru: string
  latin: string
}

export interface LetterBlockView {
  block: ScriptBlock
  lines: LetterLineView[]
}

export const letterBlocks: LetterBlockView[] = script.blocks.map((block) => ({
  block,
  lines: letterLines
    .filter((l) => l.block === block.id)
    .map((l) => ({ id: l.id, ru: lineText(l), latin: l.latin ?? '' })),
}))

export const firstLetterLineId: string | null = letterLines[0]?.id ?? null
export const lastLetterLineId: string | null = letterLines[letterLines.length - 1]?.id ?? null

const blockByLine = new Map<string, ScriptBlock>()
for (const view of letterBlocks) for (const line of view.lines) blockByLine.set(line.id, view.block)

/** Block of the given line, or of the most recently heard letter line. */
export function currentBlock(lineId: string | null, heard: readonly string[]): ScriptBlock | null {
  if (lineId) {
    const b = blockByLine.get(lineId)
    if (b) return b
  }
  for (let i = heard.length - 1; i >= 0; i--) {
    const b = blockByLine.get(heard[i])
    if (b) return b
  }
  return null
}

/** Russian plural form: plural(3, ['запись', 'записи', 'записей']) → 'записи'. */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return forms[0]
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1]
  return forms[2]
}
