import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import '../styles/vision-search.css';

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 19V5M5 12l7-7 7 7"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface VisionSearchProps {
  isSearchVisible: boolean;
  isPanelVisible: boolean;
  searchRef: RefObject<HTMLDivElement>;
  searchUrl: string;
  isSearchExpanded: boolean;
  isSearchSoftExiting: boolean;
  isAgentRunning: boolean;
  isSearchExiting: boolean;
  onSearchClick: (event: ReactMouseEvent<HTMLElement>) => void;
}

function VisionSearch({
  isSearchVisible,
  isPanelVisible,
  searchRef,
  searchUrl,
  isSearchExpanded,
  isSearchSoftExiting,
  isAgentRunning,
  isSearchExiting,
  onSearchClick,
}: VisionSearchProps) {
  const isSearchFadingOut = isSearchSoftExiting || isSearchExiting;
  const className = [
    'vision-search',
    isSearchVisible && 'vision-search--mounted',
    isPanelVisible && 'vision-search--visible',
    searchUrl && 'vision-search--has-value',
    isSearchExpanded && !isSearchFadingOut && 'vision-search--expanded',
    isAgentRunning && !isSearchFadingOut && 'vision-search--running vision-search--condensing',
    isSearchSoftExiting && 'vision-search--soft-exiting',
    isSearchExiting && 'vision-search--exiting',
  ]
    .filter(Boolean)
    .join(' ');

  const handleActionClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onSearchClick(event);
  };

  return (
    <div ref={searchRef} className={className} onClick={onSearchClick}>
      <div className="vision-search__top-line" />

      <button className="vision-search__plus" type="button" aria-label="Add source" onClick={handleActionClick}>
        <PlusIcon />
      </button>

      <input
        className="vision-search__input"
        type="text"
        placeholder=""
        value={searchUrl}
        readOnly
        aria-label="Vision audit URL"
        aria-readonly="true"
        tabIndex={-1}
      />

      <div className="vision-search__action">
        <div className="vision-search__status-dot" aria-hidden="true">
          <SendIcon />
        </div>

        <button className="vision-search__send" type="button" aria-label="Start audit" onClick={handleActionClick}>
          <SendIcon />
        </button>
      </div>
    </div>
  );
}

export default VisionSearch;
