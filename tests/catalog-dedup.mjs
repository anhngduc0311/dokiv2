import assert from 'node:assert/strict';
import { deduplicateCatalogItems } from '../frontend-next/src/lib/chapter-source-sync.ts';

const manga = (id, title, extra = {}) => ({
  id, title, alternativeTitle: '', author: 'Đang cập nhật', country: 'ja', chapters: [], ...extra
});
const short = manga('short', 'Gia Đình Vui Vẻ ~ Mẹ Thuê Báo Oán ~', {totalChapters: 30});
const full = manga('full', 'Gia Đình Vui Vẻ - Mẹ Thuê Báo Oán', {
  totalChapters: 90, chapters: [{id: 'real-chapter', mangaId: 'full', number: 33.2}]
});
assert.deepEqual(deduplicateCatalogItems([short, full]), [full], 'Punctuation variants keep the more complete edition');
assert.deepEqual(deduplicateCatalogItems([full, short]), [full], 'More complete edition wins regardless of source order');
const sequel = manga('sequel', full.title + ' Phần 2');
const differentAuthor = manga('author-a', 'Same title', {author: 'Author A'});
const otherAuthor = manga('author-b', 'Same title', {author: 'Author B'});
assert.equal(deduplicateCatalogItems([full, sequel, differentAuthor, otherAuthor]).length, 4, 'Preserve sequels and distinct authors');
assert.equal(deduplicateCatalogItems([full, manga('korean', full.title, {country: 'ko'})]).length, 2, 'Conflicting origins must not be merged');
const page1 = Array.from({length: 30}, (_, i) => manga('id-' + i, 'Story ' + i));
const page2 = [manga('duplicate', 'Story - 29'), ...Array.from({length: 30}, (_, i) => manga('next-' + i, 'Next ' + i))];
const unique = deduplicateCatalogItems([...page1, ...page2]);
assert.equal(unique.length, 60);
assert.equal(unique.slice(30, 60).length, 30, 'Backfilled page stays full without repeating the previous page');
assert.equal(unique[30].id, 'next-0');
assert.equal(deduplicateCatalogItems([short, full])[0].chapters[0].id, 'real-chapter', 'Keep real chapter links');
console.log('Catalog duplicate titles, edition selection and pagination checks passed');
