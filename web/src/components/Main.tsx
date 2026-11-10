import type { ReactNode } from 'react';

/** Vùng nội dung chính: đích của liên kết "Bỏ qua tới nội dung chính" và là `<main>` duy nhất của trang. */
export function Main({ title, className = '', children }: { title?: string; className?: string; children: ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className={`min-w-0 grow outline-none ${className}`}>
      {title ? <h1 className="sr-only">{title}</h1> : null}
      {children}
    </main>
  );
}
