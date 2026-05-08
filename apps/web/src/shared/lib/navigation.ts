export interface SpaNavigationClickEvent {
  button: number;
  defaultPrevented: boolean;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  preventDefault: () => void;
}

export function shouldHandleSpaNavigationClick(event: SpaNavigationClickEvent) {
  return event.button === 0
    && !event.defaultPrevented
    && !event.metaKey
    && !event.altKey
    && !event.ctrlKey
    && !event.shiftKey;
}

export function replaceAppPath(path: string) {
  window.history.replaceState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function pushAppPath(path: string) {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function handleSpaNavigationClick(event: SpaNavigationClickEvent, path: string) {
  if (!shouldHandleSpaNavigationClick(event)) {
    return false;
  }

  event.preventDefault();
  pushAppPath(path);
  return true;
}
