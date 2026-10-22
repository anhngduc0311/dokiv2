import type { MangaCard, ChapterCard } from './catalog-service';

export function normalizeStoryTitle(title: string): string {
  return title.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').replace(/[×✕✖]/g, 'x')
    .toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
function titleKeys(manga: Pick<MangaCard, 'title' | 'alternativeTitle'>): Set<string> {
  return new Set([manga.title, ...manga.alternativeTitle.split(/[;/|\n]/)]
    .map(normalizeStoryTitle).filter(key => key.length >= 4));
}
export function sameStoryTitle(a: Pick<MangaCard, 'title' | 'alternativeTitle'>, b: Pick<MangaCard, 'title' | 'alternativeTitle'>): boolean {
  const keys = titleKeys(a); return [...titleKeys(b)].some(key => keys.has(key));
}
function knownAuthors(author: string): string[] {
  return author.split(/[/;|]/).map(name => name.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase()
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean).sort().join(' '))
    .filter(name => name && !['cap dang nhat', 'chua ro', 'unknown', 'updating', 'chua gia ro tac'].includes(name));
}
export function canLinkChapterSource(manga: MangaCard, candidate: MangaCard): boolean {
  if (!sameStoryTitle(manga, candidate)) return false;
  const aliases: Record<string, string> = { jp: 'ja', cn: 'zh', 'zh-hk': 'zh' };
  const a = aliases[manga.country] || manga.country; const b = aliases[candidate.country] || candidate.country;
  if (a && b && a !== b) return false;
  const authors = knownAuthors(manga.author); const candidateAuthors = knownAuthors(candidate.author);
  if (authors.length && candidateAuthors.length && !authors.some(author => candidateAuthors.includes(author))) return false;
  return true;
}
export function mergeChapterSources(primary: ChapterCard[], supplemental: ChapterCard[]): ChapterCard[] {
  const selected = new Map<string, ChapterCard>();
  const key = (chapter: ChapterCard) => chapter.number > 0 ? String(chapter.number) : chapter.title.trim().toLowerCase();
  // Preserve source IDs for existing MangaDex chapters. Supplemental chapters only fill gaps.
  for (const chapter of supplemental) if (!selected.has(key(chapter))) selected.set(key(chapter), chapter);
  for (const chapter of primary) selected.set(key(chapter), chapter);
  return [...selected.values()].sort((a, b) => a.number - b.number || a.publishedAt.localeCompare(b.publishedAt));
}
export function sourceChapterAliases(canonicalId: string, chapters: ChapterCard[], identify: (key: string) => string): ChapterCard[] {
  return chapters.map(chapter => ({ ...chapter, id: identify('truyengg:alias:' + canonicalId + ':' + chapter.id), mangaId: canonicalId }));
}

export function uniqueChapterSourceMatch(manga: MangaCard, candidates: MangaCard[]): MangaCard | null {
  const matches = [...new Map(candidates.filter(candidate => canLinkChapterSource(manga, candidate)).map(candidate => [candidate.id, candidate])).values()];
  return matches.length === 1 ? matches[0] : null;
}
