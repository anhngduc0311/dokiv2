'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Icon } from './icon';

export interface PaginationProps {
  page: number;
  total: number;
  size?: number;
  change: (n: number) => void;
  hover?: (n: number) => void;
}

export function Pagination({ page = 1, total = 0, size = 28, change, hover }: PaginationProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const crawlable = pathname === '/' || pathname === '/tim-truyen-nang-cao' || pathname.startsWith('/tac-gia/');
  const hrefFor = (target: number) => {
    if (!crawlable) return undefined;
    const query = new URLSearchParams(searchParams.toString());
    if (target === 1) query.delete('page'); else query.set('page', String(target));
    return pathname + (query.size ? '?' + query.toString() : '');
  };
  const totalPages = Math.max(1, Math.ceil(total / size));

  const onHover = (n: number) => {
    if (hover && n >= 1 && n <= totalPages && n !== page) {
      hover(n);
    }
  };

  const start = Math.max(1, page - 2);
  const count = Math.max(0, Math.min(start + 4, totalPages) - start + 1);
  const numbers = Array.from({ length: count }, (_, i) => start + i);

  return (
    <nav className="pagination" aria-label="Phân trang">
      <PageControl target={page - 1} href={hrefFor(page - 1)} navigate={change} hover={onHover}
        type="button"
        className="pag-btn"
        disabled={page <= 1}
        onClick={() => change(page - 1)}
        onMouseEnter={() => onHover(page - 1)}
        onTouchStart={() => onHover(page - 1)}
        aria-label="Trang trước"
      >
        <Icon name="arrowLeft" />
      </PageControl>

      {numbers.map(p => (
        <PageControl target={p} href={hrefFor(p)} navigate={change} hover={onHover}
          key={p}
          type="button"
          className={`pag-btn ${page === p ? 'active' : ''}`}
          aria-current={page === p ? 'page' : undefined}
          onClick={() => change(p)}
          onMouseEnter={() => onHover(p)}
          onTouchStart={() => onHover(p)}
        >
          {p}
        </PageControl>
      ))}

      {totalPages > page + 2 && (
        <>
          <span className="pag-ellipsis">…</span>
          <PageControl target={totalPages} href={hrefFor(totalPages)} navigate={change} hover={onHover}
            type="button"
            className="pag-btn"
            onClick={() => change(totalPages)}
            onMouseEnter={() => onHover(totalPages)}
            onTouchStart={() => onHover(totalPages)}
          >
            {totalPages}
          </PageControl>
        </>
      )}

      <PageControl target={page + 1} href={hrefFor(page + 1)} navigate={change} hover={onHover}
        type="button"
        className="pag-btn"
        disabled={page >= totalPages}
        onClick={() => change(page + 1)}
        onMouseEnter={() => onHover(page + 1)}
        onTouchStart={() => onHover(page + 1)}
        aria-label="Trang tiếp"
      >
        <Icon name="arrowRight" />
      </PageControl>
    </nav>
  );
}

function PageControl({ target, href, navigate, hover, disabled, children, ...props }: {
  target: number; href?: string; navigate: (page: number) => void; hover: (page: number) => void;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  if (href && !disabled) return <Link href={href} prefetch={false} className={props.className}
    aria-label={props['aria-label']} aria-current={props['aria-current']}
    onMouseEnter={() => hover(target)} onTouchStart={() => hover(target)}
    onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); navigate(target); } }}>{children}</Link>;
  return <button {...props} disabled={disabled}>{children}</button>;
}
