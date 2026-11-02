'use client';

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Manga } from '../../types';
import { api } from '../../lib/api';
import { compact, ago } from '../../lib/utils';
import { Icon } from './icon';
import { coverImage } from '../../lib/cover-image';

export interface MangaCardProps {
  manga: Manga;
  idPrefix?: string;
}

export function MangaCard({ manga, idPrefix = '' }: MangaCardProps) {
  const cover = coverImage(manga.cover);
  const [coverFailed, setCoverFailed] = useState(false);
  const prefetchedRef = useRef(false);

  const recentChapters = [...(manga.chapters || [])]
    .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0) || b.number - a.number)
    .slice(0, 3).map(chapter => ({
    ...chapter,
    relativeTime: Number.isFinite(Date.parse(chapter.publishedAt)) ? ago(chapter.publishedAt) : 'Đang cập nhật'
  }));

  const savePosition = () => {
    if (typeof window !== 'undefined') {
      const isSearch = window.location.pathname.includes('/tim-truyen-nang-cao');
      if (isSearch) {
        sessionStorage.setItem('search_scroll_y', window.scrollY.toString());
        sessionStorage.setItem('search_manga_id', manga.id);
      } else {
        sessionStorage.setItem('home_scroll_y', window.scrollY.toString());
        sessionStorage.setItem('home_manga_id', manga.id);
      }
      sessionStorage.setItem('last_scroll_y', window.scrollY.toString());
      sessionStorage.setItem('last_manga_id', manga.id);
    }
  };

  const prefetch = () => {
    if (prefetchedRef.current) return;
    prefetchedRef.current = true;
    api.prefetchDetail(manga.id);
  };

  const fallback = () => setCoverFailed(true);

  return (
    <article
      className="manga-card"
      id={`${idPrefix}manga-card-${manga.id}`}
      data-manga-id={manga.id}
    >
      <Link
        href={`/truyen-tranh/${manga.id}`}
        prefetch={false}
        className="cover-link"
        onClick={savePosition}
        onMouseEnter={prefetch}
        onTouchStart={prefetch}
        aria-label={manga.title}
      >
        <Image
          src={coverFailed ? '/cover-placeholder.svg' : cover}
          unoptimized={cover.startsWith('http') && !cover.startsWith('https://services.f-ck.me/v1/image/')}
          alt={manga.title}
          width={256}
          height={360}
          sizes="(max-width: 600px) 45vw, (max-width: 1024px) 25vw, 180px"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={fallback}
          className="loaded"
        />
        {(manga.contentRating === 'erotica' || manga.contentRating === 'pornographic') && (
          <span className="age-label">18+</span>
        )}
        {manga.rating > 0 && <span className="cover-rating">
          <Icon name="star" /> {manga.rating.toFixed(1)}
        </span>}
        <span className="cover-read" aria-hidden="true">
          <Icon name="book" />
        </span>
      </Link>
      <div className="manga-card-info">
        <div className="card-stats">
          <span>
            <Icon name="star" /> {manga.rating ? manga.rating.toFixed(1) : '0.0'}
          </span>
          <span>
            <Icon name="heart" /> {compact(manga.follows || 0)}
          </span>
        </div>
        <h3>
          <Link href={`/truyen-tranh/${manga.id}`} onClick={savePosition} title={manga.title}>
            {manga.title}
          </Link>
        </h3>
      </div>
      <div className="mini-chapters">
        {recentChapters.map(c => (
          <div key={c.id} className="mini-chap-item">
            <Link href={`/chuong/${c.id}`} onClick={savePosition} title={c.title}>
              {/oneshot/i.test(c.title) ? 'Oneshot' : `Chapter ${c.number}`}
            </Link>
            <time dateTime={c.publishedAt || undefined}>{c.relativeTime}</time>
          </div>
        ))}
        {(!manga.chapters || manga.chapters.length === 0) && (
          <div className="mini-chap-item">
            <span className="muted-author">Chưa có chương</span>
          </div>
        )}
      </div>
    </article>
  );
}
