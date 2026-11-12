import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getThreadPagination, type ThreadPaginationInput } from '../../shared/thread-pages';
import './thread-pagination.css';

export interface ThreadPaginationProps extends ThreadPaginationInput {
  loading: boolean;
  onPage: (page: number) => void;
  label?: string;
}

export function ThreadPagination({loading, onPage, label = '帖子分页', ...input}: ThreadPaginationProps) {
  const {page, previousPage, nextPage, items} = getThreadPagination(input);
  const changePage = (target: number | null) => {
    if (!loading && target !== null && target !== page) onPage(target);
  };

  return <nav className="thread-page-nav" data-testid="thread-pagination" aria-label={label} aria-busy={loading}>
    <button type="button" className="thread-page-arrow" aria-label="上一页" title="上一页"
      disabled={loading || previousPage === null} onClick={() => changePage(previousPage)}>
      <ChevronLeft size={16} aria-hidden="true"/>
    </button>
    {items.map((item, index) => item === 'ellipsis'
      ? <span className="thread-page-ellipsis" key={`ellipsis-${index}`} aria-hidden="true">…</span>
      : <button type="button" key={item} className="thread-page-number" data-page={item}
          aria-label={item === page ? `第 ${item} 页，当前页` : `转到第 ${item} 页`}
          title={`第 ${item} 页`} aria-current={item === page ? 'page' : undefined}
          disabled={loading || item === page} onClick={() => changePage(item)}>{item}</button>)}
    <button type="button" className="thread-page-arrow" aria-label="下一页" title="下一页"
      disabled={loading || nextPage === null} onClick={() => changePage(nextPage)}>
      <ChevronRight size={16} aria-hidden="true"/>
    </button>
  </nav>;
}
