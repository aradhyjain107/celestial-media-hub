'use client';

/**
 * GlobalJobContext
 *
 * Lifts SSE stream reading out of tool components so active jobs survive
 * navigation between pages. Tool components call `startJob()` and then read
 * back state via `useJobState()`. The async stream loop runs in this context
 * and keeps updating state even while the tool page is unmounted.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { HardwareProfile, getClientHardwareProfile, fetchNativeHardwareProfile } from '../../lib/system/hardwareProfiler';
import { ensureSessionToken, appendAuthToken, getAuthTokenSync } from '../../lib/security/clientAuth';

// ── Types ───────────────────────────────────────────────────────────────────

export type JobStatus = 'idle' | 'processing' | 'complete' | 'error';

export interface JobState {
  toolId: string;
  status: JobStatus;
  progress: number;
  statusText: string;
  downloadUrl: string | null;
  error: string | null;
  strategy: string | null;
  strategyReason: string | null;
  files?: any[];
  generatedFiles?: Array<{ name: string; size: number; downloadUrl: string }>;
  queueItems?: any[];
  options?: any;
  url?: string;
}

interface GlobalJobContextValue {
  startJob: (toolId: string, source: Response | EventSource) => void;
  updateJob: (toolId: string, patch: Partial<JobState>) => void;
  clearJob: (toolId: string) => void;
  subscribe: (toolId: string, cb: () => void) => () => void;
  getSnapshot: (toolId: string) => JobState | null;
  hardwareProfile: HardwareProfile | null;
}

// ── Internal store (outside React so async loops can write to it) ────────────

const _store = new Map<string, JobState>();
const _listeners = new Map<string, Set<() => void>>();
const _trackedObjectUrls = new Set<string>();

export function safeCreateObjectURL(object: any): string {
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const url = URL.createObjectURL(object);
    _trackedObjectUrls.add(url);
    return url;
  }
  return '';
}

export function safeRevokeObjectURL(url: string | null | undefined): void {
  if (url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    _trackedObjectUrls.delete(url);
    try {
      URL.revokeObjectURL(url);
    } catch {}
  }
}

export function revokeAllObjectUrls(): void {
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    _trackedObjectUrls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    });
    _trackedObjectUrls.clear();
  }
}

export function resetGlobalJobStore() {
  _store.clear();
  _listeners.clear();
  revokeAllObjectUrls();
}

function notifyListeners(toolId: string) {
  _listeners.get(toolId)?.forEach((cb) => cb());
}

function isShallowEqual(a: any, b: any): boolean {
  try {
    if (a === b) return true;
    if (a === null || b === null || a === undefined || b === undefined) return a === b;

    // Handle File objects (crucial for tool state)
    if (typeof File !== 'undefined' && a instanceof File && b instanceof File) {
      return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
    }

    if (typeof a !== 'object' || typeof b !== 'object') return a === b;

    // Handle Arrays
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        // eslint-disable-next-line security/detect-object-injection
        if (!isShallowEqual(a[i], b[i])) return false;
      }
      return true;
    }
    if (Array.isArray(a) !== Array.isArray(b)) return false;

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      // eslint-disable-next-line security/detect-object-injection
      if (!isShallowEqual(a[key], b[key])) return false;
    }
    return true;
  } catch {
    return false;
  }
}


function setJobState(toolId: string, patch: Partial<JobState>) {
  const prev = _store.get(toolId) ?? {} as JobState;
  // Deep merge for 'options' and 'queueItems' to avoid overwriting them completely if patch is partial
  const next = { ...prev, ...patch, toolId } as JobState;
  
  // Extra care for nested objects like options
  if (patch.options && prev.options) {
    next.options = { ...prev.options, ...patch.options };
  }

  if (isShallowEqual(prev, next)) {
    return;
  }

  _store.set(toolId, next);
  notifyListeners(toolId);
}

// ── Context ─────────────────────────────────────────────────────────────────

const GlobalJobContext = createContext<GlobalJobContextValue | null>(null);


export function GlobalJobProvider({ children }: { children: React.ReactNode }) {
  const startJob = useCallback((toolId: string, source: Response | EventSource) => {
    const handlePayload = (parsed: any) => {
      const patch: Partial<JobState> = {};

      if (parsed.strategy) {
        const label = parsed.strategy === 'REMUX' ? 'REMUX — LOSSLESS'
          : parsed.strategy === 'COPY+VIDEO' ? 'SMART — COPY VIDEO'
          : parsed.strategy === 'COPY+AUDIO' ? 'SMART — COPY AUDIO'
          : 'ENCODING';
        patch.strategy = parsed.strategy;
        patch.strategyReason = parsed.strategyReason ?? null;
        patch.statusText = `[${label}] PROCESSING...`;
      }

      if (typeof parsed.progress === 'number') {
        const s = _store.get(toolId)?.strategy;
        const label = s === 'REMUX' ? 'REMUXING' : s ? `[${s}]` : 'PROCESSING';
        patch.progress = parsed.progress;
        patch.statusText = `${label} ${Math.round(parsed.progress)}%`;
        
        const current = _store.get(toolId);
        if (current?.queueItems) {
          patch.queueItems = current.queueItems.map(item => ({
            ...item,
            progress: parsed.progress,
            status: parsed.status === 'complete' ? 'done' : 'processing'
          }));
        }
      }

      // Spotify / Batch track handling
      if (parsed.trackId && parsed.status) {
        const current = _store.get(toolId);
        if (current?.options?.tracks) {
          const nextTracks = current.options.tracks.map((t: any) => 
            t.id === parsed.trackId ? { ...t, status: parsed.status } : t
          );
          patch.options = { ...current.options, tracks: nextTracks };
          
          const completed = nextTracks.filter((t: any) => t.status === 'done').length;
          const total = nextTracks.length;
          patch.progress = total > 0 ? Math.round((completed / total) * 100) : 0;
          patch.statusText = `CONVERTING ${completed}/${total}...`;
        }
      }

      if ((parsed.status === 'complete' || parsed.status === 'success') && parsed.downloadUrl) {
        patch.status = 'complete';
        patch.progress = 100;
        patch.statusText = 'COMPLETE';
        patch.downloadUrl = parsed.downloadUrl;
        if (Array.isArray(parsed.files)) {
          patch.generatedFiles = parsed.files;
        }

        const downloadTargetUrl = appendAuthToken(parsed.downloadUrl, getAuthTokenSync());
        
        // Trigger direct link navigation / download without buffering multi-GB blobs into RAM
        if (typeof window !== 'undefined' && typeof document !== 'undefined') {
          try {
            const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
            let downloadTarget = downloadTargetUrl.startsWith('http')
              ? downloadTargetUrl
              : `${apiBase}${downloadTargetUrl}`;

            let downloadFileName = parsed.filename;
            if (!downloadFileName && downloadTargetUrl.includes('file=')) {
              try {
                const urlObj = new URL(downloadTarget, 'http://localhost');
                const fileParam = urlObj.searchParams.get('file');
                if (fileParam) downloadFileName = fileParam;
              } catch {}
            }
            if (!downloadFileName) downloadFileName = 'download.zip';

            const a = document.createElement('a');
            a.href = downloadTarget;
            a.download = downloadFileName;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          } catch (e) {
            console.error('Direct download anchor click failed:', e);
          }
        }
      }

      if ((parsed.error || parsed.status === 'error') && !parsed.trackId) {
        patch.status = 'error';
        patch.statusText = `ERROR: ${parsed.error ?? 'FAILED'}`;
        
        const current = _store.get(toolId);
        if (current?.queueItems) {
          patch.queueItems = current.queueItems.map(item => ({
            ...item,
            status: 'error'
          }));
        }
      }

      if (Object.keys(patch).length > 0) {
        setJobState(toolId, patch);
      }
    };

    setJobState(toolId, {
      status: 'processing',
      progress: 0,
      statusText: 'INITIALIZING...',
      downloadUrl: null,
      error: null,
    });

    if (source instanceof Response || (source && typeof source === 'object' && 'body' in source)) {
      const reader = (source as any).body?.getReader();
      if (!reader) {
        setJobState(toolId, { status: 'error', statusText: 'EMPTY RESPONSE' });
        return;
      }
      const decoder = new TextDecoder();
      (async () => {
        let buffer = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split(/\r?\n\r?\n/);
            buffer = parts.pop() ?? '';
            for (const rawPart of parts) {
              const part = rawPart.replace(/\r/g, '').trim();
              if (!part.startsWith('data: ')) continue;
              try {
                handlePayload(JSON.parse(part.slice(6).trim()));
              } catch (e) {}
            }
          }
          if (buffer && buffer.trim().length > 0) {
            const part = buffer.replace(/\r/g, '').trim();
            if (part.startsWith('data: ')) {
              try {
                handlePayload(JSON.parse(part.slice(6).trim()));
              } catch (e) {}
            }
          }
          const finalState = _store.get(toolId);
          if (finalState?.status === 'processing') {
            setJobState(toolId, { status: 'error', statusText: 'STREAM TERMINATED UNEXPECTEDLY' });
          }
        } catch (err) {
          setJobState(toolId, { status: 'error', statusText: 'STREAM ERROR' });
        }
      })();
    } else {
      // EventSource
      source.onmessage = (e) => {
        try {
          const parsed = JSON.parse(e.data);
          handlePayload(parsed);
          if (parsed.status === 'complete' || parsed.status === 'error') {
            source.close();
          }
        } catch (e) {}
      };
      source.onerror = () => {
        const current = _store.get(toolId);
        if (current?.status !== 'complete') {
          setJobState(toolId, { status: 'error', statusText: 'EVENTSOURCE ERROR' });
        }
        source.close();
      };
    }
  }, []);

  const updateJob = useCallback((toolId: string, patch: Partial<JobState>) => {
    setJobState(toolId, patch);
  }, []);

  const clearJob = useCallback((toolId: string) => {
    const current = _store.get(toolId);
    if (current?.downloadUrl && current.downloadUrl.startsWith('blob:')) {
      safeRevokeObjectURL(current.downloadUrl);
    }
    _store.delete(toolId);
    notifyListeners(toolId);
    _listeners.delete(toolId);
  }, []);

  const subscribe = useCallback((toolId: string, cb: () => void) => {
    if (!_listeners.has(toolId)) {
      _listeners.set(toolId, new Set());
    }
    _listeners.get(toolId)!.add(cb);
    return () => {
      const set = _listeners.get(toolId);
      if (set) {
        set.delete(cb);
        if (set.size === 0) {
          _listeners.delete(toolId);
        }
      }
    };
  }, []);

  const [hardwareProfile, setHardwareProfile] = useState<HardwareProfile | null>(null);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      try {
        // Client-side UI authenticates API requests via Bearer header without writing non-HttpOnly document cookies.
      } catch {}
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
      setHardwareProfile(getClientHardwareProfile());
      return () => {
        isMounted = false;
        _listeners.clear();
        revokeAllObjectUrls();
      };
    }
    void ensureSessionToken();
    fetchNativeHardwareProfile().then((profile) => {
      if (isMounted) setHardwareProfile(profile);
    }).catch(() => {
      if (isMounted) setHardwareProfile(getClientHardwareProfile());
    });
    return () => {
      isMounted = false;
      _listeners.clear();
      revokeAllObjectUrls();
    };
  }, []);

  const getSnapshot = useCallback((toolId: string): JobState | null => {
    return _store.get(toolId) ?? null;
  }, []);

  return (
    <GlobalJobContext.Provider value={{ startJob, updateJob, clearJob, subscribe, getSnapshot, hardwareProfile }}>
      {children}
    </GlobalJobContext.Provider>
  );
}


export function useJobState(toolId: string): JobState | null {
  const ctx = useContext(GlobalJobContext);

  return useSyncExternalStore(
    (cb) => ctx ? ctx.subscribe(toolId, cb) : () => {},
    () => ctx ? ctx.getSnapshot(toolId) : null,
    () => null
  );
}

export function useHardwareProfile(): HardwareProfile | null {
  const ctx = useContext(GlobalJobContext);
  return ctx?.hardwareProfile ?? null;
}

export function useJob(toolId: string) {
  const ctx = useContext(GlobalJobContext);
  const jobState = useJobState(toolId);

  const startJob = useCallback((source: Response | EventSource) => {
    if (ctx) ctx.startJob(toolId, source);
  }, [ctx, toolId]);

  const updateJob = useCallback((patch: Partial<JobState>) => {
    if (ctx) ctx.updateJob(toolId, patch);
  }, [ctx, toolId]);

  const clearJob = useCallback(() => {
    if (ctx) ctx.clearJob(toolId);
  }, [ctx, toolId]);

  return {
    jobState,
    startJob,
    updateJob,
    clearJob,
  };
}
