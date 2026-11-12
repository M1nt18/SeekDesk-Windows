import test from 'node:test';
import assert from 'node:assert/strict';
import { getThreadPagination } from '../shared/thread-pages';

const links = (...numbers: number[]) => numbers.map(number => ({number, url: `/post-123-${number}.html`}));

test('a four-page thread shows all four real page links on the first and last pages', () => {
  const pages = links(1, 2, 3, 4);
  assert.deepEqual(getThreadPagination({page: 1, pages, nextPage: 2}).items, [1, 2, 3, 4]);
  const last = getThreadPagination({page: 4, pages, nextPage: null});
  assert.deepEqual(last.items, [1, 2, 3, 4]);
  assert.equal(last.previousPage, 3);
  assert.equal(last.nextPage, null);
});

test('large known totals keep the first, neighboring and last pages with non-page gaps', () => {
  const middle = getThreadPagination({page: 500, totalPages: 1_000_000, nextPage: 501});
  assert.deepEqual(middle.items, [1, 'ellipsis', 498, 499, 500, 501, 502, 'ellipsis', 1_000_000]);
  assert.equal(middle.previousPage, 499);
  assert.equal(middle.nextPage, 501);
  assert.deepEqual(getThreadPagination({page: 1_000_000, totalPages: 1_000_000, nextPage: null}).items,
    [1, 'ellipsis', 999_996, 999_997, 999_998, 999_999, 1_000_000]);
});

test('unknown totals expose only observed future pages and never invent a last page', () => {
  const legacy = getThreadPagination({page: 40, nextPage: 41});
  assert.deepEqual(legacy.items, [1, 'ellipsis', 38, 39, 40, 41]);
  assert.ok(!legacy.items.includes(42));
  assert.deepEqual(getThreadPagination({page: 40, nextPage: null}).items, [1, 'ellipsis', 38, 39, 40]);
  assert.deepEqual(getThreadPagination({page: 1, nextPage: 2}).items, [1, 2]);
});

test('real distant page links stay reachable without fabricating missing intermediate links', () => {
  const result = getThreadPagination({page: 1, pages: links(1, 2, 3, 50), nextPage: 2});
  assert.deepEqual(result.items, [1, 2, 3, 'ellipsis', 50]);
  assert.ok(!result.items.includes(49));
  const middle = getThreadPagination({page: 50, pages: links(...Array.from({length: 100}, (_, index) => index + 1)), nextPage: 51});
  assert.deepEqual(middle.items, [1, 'ellipsis', 48, 49, 50, 51, 52, 'ellipsis', 100]);
});

test('invalid metadata cannot create invalid page targets or override the current page', () => {
  assert.deepEqual(getThreadPagination({page: 0, totalPages: -1, nextPage: Number.NaN, pages: links(0, -2, 1.5, Number.POSITIVE_INFINITY)}),
    {page: 1, previousPage: null, nextPage: null, items: [1]});
  assert.deepEqual(getThreadPagination({page: 8, totalPages: 4, nextPage: 9}).items, [1, 'ellipsis', 6, 7, 8, 9]);
  assert.equal(getThreadPagination({page: 4, totalPages: 4, nextPage: 5}).nextPage, null);
  assert.equal(getThreadPagination({page: 4, nextPage: 3}).nextPage, null);
});
