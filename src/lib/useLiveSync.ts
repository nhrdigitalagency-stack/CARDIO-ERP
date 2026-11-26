import { useEffect, useRef } from 'react';
import { getAuthHeaders, getSessionToken } from './api';

type SyncListener = (scopes: string[]) => void;

let activeAbort: AbortController | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let retryCount = 0;
let hasConnectedOnce = false;
let windowListenersAttached = false;
const listeners = new Set<SyncListener>();
let activeSubscribers = 0;

function notifyAllSubscribers(scopes: string[]) {
  listeners.forEach((fn) => fn(scopes));
}

function scheduleReconnect() {
  if (reconnectTimer || activeSubscribers <= 0) return;
  const delayMs = Math.min(15000, 1500 * Math.pow(2, retryCount));
  retryCount = Math.min(retryCount + 1, 4);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    ensureSseStream();
  }, delayMs);
}

function attachBrowserListeners() {
  if (typeof window === 'undefined' || windowListenersAttached) return;
  windowListenersAttached = true;

  window.addEventListener('online', () => {
    if (activeSubscribers > 0) {
      ensureSseStream();
      notifyAllSubscribers(['system']);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && activeSubscribers > 0) {
      if (!activeAbort) {
        ensureSseStream();
      }
      notifyAllSubscribers(['system']);
    }
  });
}

function handleSseBlock(block: string) {
  const lines = block.split(/\r?\n/);
  let eventName = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (eventName === 'connected') {
    const isReconnect = hasConnectedOnce;
    hasConnectedOnce = true;
    retryCount = 0;
    if (isReconnect) {
      notifyAllSubscribers(['system']);
    }
    return;
  }

  if (eventName === 'sync' && dataLines.length > 0) {
    try {
      const parsed = JSON.parse(dataLines.join('\n')) as { scopes?: string[] };
      notifyAllSubscribers(parsed.scopes || []);
    } catch {
      // Ignore malformed frame
    }
  }
}

async function ensureSseStream() {
  if (typeof window === 'undefined' || activeSubscribers <= 0) return;
  attachBrowserListeners();
  if (activeAbort) return;

  const controller = new AbortController();
  activeAbort = controller;

  try {
    const res = await fetch('/api/events', {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'text/event-stream',
        ...getAuthHeaders(),
      },
      signal: controller.signal,
    });

    if (res.status === 401 || res.status === 403) {
      // Not authenticated: stop reconnecting until login calls resetLiveSyncConnection()
      if (activeAbort === controller) activeAbort = null;
      return;
    }

    if (!res.ok || !res.body) {
      if (activeAbort === controller) activeAbort = null;
      scheduleReconnect();
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        if (block.trim()) handleSseBlock(block);
      }
    }

    if (activeAbort === controller) {
      activeAbort = null;
      if (activeSubscribers > 0 && getSessionToken()) {
        scheduleReconnect();
      }
    }
  } catch {
    if (activeAbort === controller) {
      activeAbort = null;
      if (!controller.signal.aborted && activeSubscribers > 0) {
        scheduleReconnect();
      }
    }
  }
}

function releaseStreamIfUnused() {
  if (activeSubscribers <= 0) {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (activeAbort) {
      activeAbort.abort();
      activeAbort = null;
    }
    hasConnectedOnce = false;
    retryCount = 0;
  }
}

export function resetLiveSyncConnection() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }
  hasConnectedOnce = false;
  retryCount = 0;
  if (activeSubscribers > 0) {
    ensureSseStream();
  }
}

export function useLiveSync(scopes: string[], onSync: () => void) {
  const callbackRef = useRef(onSync);
  callbackRef.current = onSync;
  const scopeKey = scopes.join(',');

  useEffect(() => {
    const watched = new Set(scopeKey.split(',').filter(Boolean));
    let timer: ReturnType<typeof setTimeout> | null = null;

    const handler: SyncListener = (incomingScopes) => {
      if (incomingScopes.includes('system') || incomingScopes.some((s) => watched.has(s))) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          callbackRef.current();
        }, 180);
      }
    };

    activeSubscribers += 1;
    listeners.add(handler);
    ensureSseStream();

    return () => {
      if (timer) clearTimeout(timer);
      listeners.delete(handler);
      activeSubscribers = Math.max(0, activeSubscribers - 1);
      releaseStreamIfUnused();
    };
  }, [scopeKey]);
}
