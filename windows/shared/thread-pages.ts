export interface ThreadPageLink {
  number: number;
  url: string;
}

export interface ThreadPaginationInput {
  page: number;
  pages?: readonly ThreadPageLink[];
  totalPages?: number;
  nextPage: number | null;
}

export type ThreadPageItem = number | 'ellipsis';

const isPage = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

/** Keep the first page reachable without treating an observed next page as the last. */
export function getThreadPagination(input: ThreadPaginationInput) {
  const page = isPage(input.page) ? input.page : 1;
  const totalPages = isPage(input.totalPages) && input.totalPages >= page ? input.totalPages : undefined;
  const nextPage = isPage(input.nextPage) && input.nextPage > page &&
    (totalPages === undefined || input.nextPage <= totalPages) ? input.nextPage : null;
  let visible: number[];

  if (totalPages !== undefined) {
    if (totalPages <= 7) {
      visible = Array.from({length: totalPages}, (_, index) => index + 1);
    } else {
      const start = Math.max(1, Math.min(page - 2, totalPages - 4));
      visible = [1, ...Array.from({length: 5}, (_, index) => start + index), totalPages];
    }
  } else {
    // Earlier sequential pages exist even when an older cached result has no page links.
    const known = new Set([1, page, Math.max(1, page - 1), Math.max(1, page - 2)]);
    if (nextPage !== null) known.add(nextPage);
    for (const link of input.pages || []) {
      if (isPage(link.number) && typeof link.url === 'string' && link.url.trim()) known.add(link.number);
    }
    const available = [...known].sort((left, right) => left - right);
    if (available.length <= 7) {
      visible = available;
    } else {
      const index = available.indexOf(page);
      const start = Math.max(0, Math.min(index - 2, available.length - 5));
      visible = [1, ...available.slice(start, start + 5), available[available.length - 1]];
    }
  }

  const numbers = [...new Set(visible)].sort((left, right) => left - right);
  const items: ThreadPageItem[] = [];
  for (const number of numbers) {
    const previous = items[items.length - 1];
    if (typeof previous === 'number' && number - previous > 1) items.push('ellipsis');
    items.push(number);
  }
  return {page, previousPage: page > 1 ? page - 1 : null, nextPage, items};
}
