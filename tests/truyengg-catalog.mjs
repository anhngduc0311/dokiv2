import assert from 'node:assert/strict';
import { ggId, ggPath, ggTime, parseGgGrid, parseGgSearch, parseGgDetail, parseGgReaderPages } from '../frontend-next/src/lib/truyengg-parser.ts';
import { sourceWindow, interleaveSourceItems } from '../frontend-next/src/lib/catalog-pagination.ts';

assert.equal(ggId('truyengg:manga:gacha-vo-han-13496'), 'b0dee5c3-6fa8-c9ff-2069-dff8850100d1', 'Preserve the existing ASP.NET manga ID');
assert.equal(ggPath('https://evil.example/truyen-tranh/title-1', 'manga'), null);
assert.equal(ggPath('//evil.example/truyen-tranh/title-1', 'manga'), null);
assert.equal(ggPath('/truyen-tranh/title-1-chap-3.html', 'manga'), null);
assert.equal(ggPath('/truyen-tranh/title-1-chap-3.html', 'chapter'), '/truyen-tranh/title-1-chap-3.html');
assert.equal(ggTime('2 Giờ Trước', Date.parse('2026-10-22T12:00:00Z')), '2026-10-22T10:00:00.000Z');
assert.equal(ggTime('21/10/2026'), '2026-10-21T00:00:00.000Z');
const grid = parseGgGrid('<ul class="list_grid"><li><div class="book_avatar"><img src="//i.hinhhinh.com/cover.jpg"></div><div class="book_name"><a href="/truyen-tranh/test-1">Truyện &amp; bạn</a></div><div class="title-more-other">Tên khác: Test</div><div class="list-tags"><p class="blue">Manhwa</p></div><div class="last_chapter"><a href="/truyen-tranh/test-1-chap-12.5.html">Chương 12.5</a></div><div class="time-ago">2 Giờ Trước</div></li></ul><div class="page_redirect"><a href="/tim-kiem-nang-cao/trang-445.html">Cuối</a></div>');
assert.equal(grid.items[0].title, 'Truyện & bạn');
assert.equal(grid.items[0].source, 'truyengg');
assert.equal(grid.items[0].country, 'ko');
assert.equal(grid.items[0].chapters[0].number, 12.5);
assert.equal(grid.refs.length, 2);
assert.equal(grid.lastPage, 445);
assert.match(grid.items[0].cover, /^\/api\/catalog\/image-proxy\?url=/);
const suggestions = parseGgSearch('<li><a href="/truyen-tranh/test-1"><p class="name">Truyện</p><p class="name_other">Test</p><p>Chương 12</p></a></li>');
assert.equal(suggestions.items[0].chapters.length, 0, 'Do not invent chapter IDs from suggestion labels');
const detail = parseGgDetail('<h1 itemprop="name">Truyện</h1><div class="works-chapter-item"><div class="name-chap"><a href="/truyen-tranh/test-1-chap-2.html">Chương 2</a></div><div class="time-chap">22/10/2026</div></div><div class="works-chapter-item"><div class="name-chap"><a href="/truyen-tranh/test-1-chap-1.html">Chương 1</a></div></div>', '/truyen-tranh/test-1');
assert.deepEqual(detail.chapters.map(c => c.number), [2, 1]);
assert.equal(detail.manga.id, grid.items[0].id);
assert.equal(detail.refs.length, 3);
const pages = parseGgReaderPages('<div class="ad"><img src="https://example.com/ad.jpg"></div><div class="page-chapter"><img src="/loader.gif" data-original="https://i178.truyenvua.com/13496/224/0.jpg"></div><div class="page-chapter"><img src="https://i.hinhhinh.com/19852/1/0.jpg"></div><div class="page-chapter"><img src="https://i178.truyenvua.com/13496/224/1.jpg"></div>');
assert.equal(pages.length, 2, 'Keep genuine page 0; remove only the known standalone banner');
assert.ok(decodeURIComponent(pages[0]).includes('/224/0.jpg'));

for (const counts of [[0, 0], [8, 0], [0, 9], [3, 12], [15, 2], [6, 6]]) {
  const a = Array.from({length: counts[0]}, (_, i) => 'a' + i);
  const b = Array.from({length: counts[1]}, (_, i) => 'b' + i);
  for (const pageSize of [1, 3, 4, 7]) {
    const output = [];
    for (let offset = 0; offset < counts[0] + counts[1] + pageSize; offset += pageSize) {
      const window = sourceWindow(counts, offset, pageSize);
      output.push(...interleaveSourceItems([a.slice(window.offsets[0], window.offsets[0] + window.limits[0]), b.slice(window.offsets[1], window.offsets[1] + window.limits[1])], window.order));
    }
    assert.equal(new Set(output).size, a.length + b.length, 'No duplicates across pages');
    assert.deepEqual([...output].sort(), [...a, ...b].sort(), 'No skipped items when one source runs out');
  }
}
console.log('TruyenGG parser, compatibility and federated pagination checks passed');
