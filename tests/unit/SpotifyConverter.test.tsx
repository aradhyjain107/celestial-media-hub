import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, vi, beforeEach, expect } from 'vitest';
import SpotifyConverter from '../../app/tools/spotify/page';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock EventSource with instance tracking
class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }
  close() {}
  // Helper to emit messages
  emit(data: any) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

// @ts-ignore – replace global EventSource
global.EventSource = MockEventSource as any;

// Mock clipboard
Object.assign(navigator, {
  clipboard: { readText: vi.fn().mockResolvedValue('https://open.spotify.com/playlist/12345'), writeText: vi.fn() },
});

describe('Spotify Converter Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // reset mock fetch implementations
    mockFetch.mockReset();
  });

  test('URL validation shows error for invalid input', async () => {
    render(<SpotifyConverter />);
    const urlInput = screen.getByTestId('url-input');
    fireEvent.change(urlInput, { target: { value: 'invalid-url' } });
    fireEvent.click(screen.getByTestId('extract-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('url-error')).toBeInTheDocument();
    });
  });

  test('Successful extraction renders playlist info and track list', async () => {
    const mockPlaylist = {
      name: 'My Playlist',
      tracks: [
        { id: 't1', name: 'Track One' },
        { id: 't2', name: 'Track Two' },
      ],
    };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ playlist: mockPlaylist }) });

    render(<SpotifyConverter />);
    const urlInput = screen.getByTestId('url-input');
    fireEvent.change(urlInput, { target: { value: 'https://open.spotify.com/playlist/abc' } });
    fireEvent.click(screen.getByTestId('extract-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('playlist-info')).toBeInTheDocument();
      expect(screen.getByText('My Playlist')).toBeInTheDocument();
      expect(screen.getByText('2 tracks')).toBeInTheDocument();
    });

    // Track list should be rendered with checkboxes and pending badges
    const trackItems = screen.getAllByTestId(/^track-item-/);
    expect(trackItems).toHaveLength(2);
    trackItems.forEach(item => {
      expect(item.querySelector('input[type="checkbox"]')).toBeInTheDocument();
      expect(item.querySelector('[data-testid^="badge-"]')).toBeInTheDocument();
    });
  });

  test('Select all / deselect all functionality', async () => {
    const mockPlaylist = {
      name: 'Playlist',
      tracks: [{ id: 't1', name: 'A' }, { id: 't2', name: 'B' }],
    };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ playlist: mockPlaylist }) });
    render(<SpotifyConverter />);
    fireEvent.change(screen.getByTestId('url-input'), { target: { value: 'https://open.spotify.com/playlist/xyz' } });
    fireEvent.click(screen.getByTestId('extract-btn'));
    await waitFor(() => screen.getByTestId('track-list'));

    fireEvent.click(screen.getByTestId('deselect-all'));
    expect(screen.getByTestId('track-checkbox-t1')).not.toBeChecked();
    expect(screen.getByTestId('track-checkbox-t2')).not.toBeChecked();

    fireEvent.click(screen.getByTestId('select-all'));
    expect(screen.getByTestId('track-checkbox-t1')).toBeChecked();
    expect(screen.getByTestId('track-checkbox-t2')).toBeChecked();
  });

  test('Format and quality selection updates state', async () => {
    render(<SpotifyConverter />);
    fireEvent.click(screen.getByTestId('format-m4a'));
    fireEvent.click(screen.getByTestId('quality-256'));
    // internal state not directly observable; ensure buttons get selected class
    expect(screen.getByTestId('format-m4a')).toHaveClass('selected');
    expect(screen.getByTestId('quality-256')).toHaveClass('selected');
  });

  test('Initialize conversion sets up SSE and updates track status', async () => {
    const mockPlaylist = {
      name: 'List',
      tracks: [{ id: 't1', name: 'One' }],
    };
    // extraction response
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ playlist: mockPlaylist }) });
    // initialize response
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-123' }) });

    render(<SpotifyConverter />);
    fireEvent.change(screen.getByTestId('url-input'), { target: { value: 'https://open.spotify.com/playlist/abc' } });
    fireEvent.click(screen.getByTestId('extract-btn'));
    await waitFor(() => screen.getByTestId('track-list'));

    fireEvent.click(screen.getByTestId('initialize-btn'));
    await waitFor(() => {
      // after SSE message, status should change to processing then done
      const esInstance = (global.EventSource as any).instances[0] as MockEventSource;
      esInstance.emit({ trackId: 't1', status: 'processing' });
      esInstance.emit({ trackId: 't1', status: 'done' });
    });
    const badge = screen.getByTestId('badge-done');
    expect(badge).toBeInTheDocument();
  });

  test('Retry button appears on error and triggers retry fetch', async () => {
    const mockPlaylist = { name: 'List', tracks: [{ id: 't1', name: 'One' }] };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ playlist: mockPlaylist }) });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-1' }) });
    render(<SpotifyConverter />);
    fireEvent.change(screen.getByTestId('url-input'), { target: { value: 'https://open.spotify.com/playlist/abc' } });
    fireEvent.click(screen.getByTestId('extract-btn'));
    await waitFor(() => screen.getByTestId('track-list'));
    fireEvent.click(screen.getByTestId('initialize-btn'));
    await waitFor(() => {
      const es = (global.EventSource as any).instances[0] as MockEventSource;
      es.emit({ trackId: 't1', status: 'error' });
    });
    const retryBtn = screen.getByTestId('retry-t1');
    expect(retryBtn).toBeInTheDocument();
    // mock retry endpoint
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    fireEvent.click(retryBtn);
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/spotify-convert/retry'), expect.any(Object));
  });

  test('Download All button appears when all selected tracks are done', async () => {
    const mockPlaylist = { name: 'List', tracks: [{ id: 't1', name: 'One' }, { id: 't2', name: 'Two' }] };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ playlist: mockPlaylist }) });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-99' }) });
    render(<SpotifyConverter />);
    fireEvent.change(screen.getByTestId('url-input'), { target: { value: 'https://open.spotify.com/playlist/abc' } });
    fireEvent.click(screen.getByTestId('extract-btn'));
    await waitFor(() => screen.getByTestId('track-list'));
    fireEvent.click(screen.getByTestId('initialize-btn'));
    await waitFor(() => {
      const es = (global.EventSource as any).instances[0] as MockEventSource;
      es.emit({ trackId: 't1', status: 'done' });
      es.emit({ trackId: 't2', status: 'done' });
    });
    await waitFor(() => {
      expect(screen.getByTestId('download-all')).toBeInTheDocument();
    });
  });
});
