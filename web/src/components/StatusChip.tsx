import type { ReactNode } from 'react';

const TONES = {
  amber: 'bg-amber-soft text-amber-ink',
  red: 'bg-p1-soft text-[#7a1b12]',
  green: 'bg-[#dcf3e4] text-[#0f5132]',
  gray: 'bg-chip text-ink-2',
  blue: 'bg-brand text-white',
  p1: 'bg-p1 text-white',
} as const;

export type Tone = keyof typeof TONES;

/** Chip nhỏ. Ý nghĩa luôn nằm trong chữ, màu chỉ nhấn thêm. */
export function StatusChip({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-block whitespace-nowrap rounded px-[7px] py-0.5 text-[11px] font-semibold ${TONES[tone]}`}>
      {children}
    </span>
  );
}
