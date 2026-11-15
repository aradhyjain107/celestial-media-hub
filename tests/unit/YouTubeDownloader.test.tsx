import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { expect, test, vi, beforeEach, describe, afterEach } from 'vitest';
import YouTubeDownloader from '../../src/app/tools/youtube/page';
import { GlobalJobProvider } from '../../src/app/context/GlobalJobContext';

const mockFetch = vi.fn();
global.fetch = mockFetch;

Object.assign(navigator, {
  clipboard: { readText: vi.fn().mockResolvedValue('https://www.youtube.com/watch?v=dQw4w9WgXcQ') },
});

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('YouTube Downloader Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  /* ── URL input renders ── */
  test('renders URL input with correct placeholder', () => {
    render(<GlobalJobProvider><YouTubeDownloader /></GlobalJobProvider>);
    const input = screen.getByTestId('url-input');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('placeholder', 'PASTE YOUTUBE OR INSTAGRAM URL');
  });

  /* ── URL validation — invalid URL keeps button disabled ── */
  test('initialize button is disabled with invalid URL', () => {
    render(<GlobalJobProvider><YouTubeDownloader /></GlobalJobProvider>);
    const input = screen.getByTestId('url-input');
    fireEvent.change(input, { target: { value: 'not-a-url' } });
    const btn = screen.getByTestId('initialize-btn');
    expect(btn).toBeDisabled();
  });

  /* ── URL validation — valid YouTube URL enables button ── */
  test('initialize button is enabled with valid YouTube URL', async () => {
    render(<GlobalJobProvider><YouTubeDownloader /></GlobalJobProvider>);
    const input = screen.getByTestId('url-input');
    fireEvent.change(input, { target: { value: 'https://www.youtube.com/watch?v=abc123' } });
    const btn = screen.getByTestId('initialize-btn');
    expect(btn).not.toBeDisabled();
  });

  /* ── Info fetch on valid URL ── */
  test('fetches video info on valid URL entry after debounce', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        title: 'Test Video',
        thumbnail: 'https://img.youtube.com/vi/abc/0.jpg',
        duration: '3:45',
      }),
    });

    render(<GlobalJobProvider><YouTubeDownloader /></GlobalJobProvider>);
    const input = screen.getByTestId('url-input');
    fireEvent.change(input, { target: { value: 'https://www.youtube.com/watch?v=abc123' } });

    // Advance past debounce
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [fetchUrl] = mockFetch.mock.calls[0];
      expect(fetchUrl).toContain('/api/youtube');
      expect(fetchUrl).toContain('action=info');
    });

    await waitFor(() => {
      expect(screen.getByTestId('video-info')).toBeInTheDocument();
      expect(screen.getByText('Test Video')).toBeInTheDocument();
      expect(screen.getByText('3:45')).toBeInTheDocument();
    });
  });

  /* ── Playlist mode toggle ── */
  test('playlist mode toggle switches state', () => {
    render(<GlobalJobProvider><YouTubeDownloader /></GlobalJobProvider>);
    const toggle = screen.getByTestId('playlist-toggle');
    expect(toggle).toBeInTheDocument();

    // Default: off (background should be var(--border))
    expect(toggle.style.background).toContain('var(--border)');

    fireEvent.click(toggle);
    // After click: on (background should be var(--accent))
    expect(toggle.style.background).toContain('var(--accent)');
  });

  /* ── Format selector ── */
  test('format tiles render all 4 formats and selection works', () => {
    render(<GlobalJobProvider><YouTubeDownloader /></GlobalJobProvider>);
    const formats = ['mp3', 'm4a', 'wav', 'mp4'];
    formats.forEach(f => {
      expect(screen.getByTestId(`format-${f}`)).toBeInTheDocument();
    });

    // Default is mp3
    const mp3Tile = screen.getByTestId('format-mp3');
    expect(mp3Tile.style.border).toContain('var(--accent)');

    // Select mp4
    fireEvent.click(screen.getByTestId('format-mp4'));
    const mp4Tile = screen.getByTestId('format-mp4');
    expect(mp4Tile.style.border).toContain('var(--accent)');
  });

  /* ── Quality chips change based on format ── */
  test('quality chips show audio kbps for audio formats and resolution for mp4', () => {
    render(<GlobalJobProvider><YouTubeDownloader /></GlobalJobProvider>);

    // Default format is mp3 (audio) — should show kbps
    expect(screen.getByTestId('quality-128')).toBeInTheDocument();
    expect(screen.getByTestId('quality-320')).toBeInTheDocument();
    expect(screen.queryByTestId('quality-1080p')).not.toBeInTheDocument();

    // Switch to mp4 (video) — should show resolution
    fireEvent.click(screen.getByTestId('format-mp4'));
    expect(screen.getByTestId('quality-1080p')).toBeInTheDocument();
    expect(screen.getByTestId('quality-720p')).toBeInTheDocument();
    expect(screen.queryByTestId('quality-128')).not.toBeInTheDocument();
  });

  /* ── Download history from localStorage ── */
  test('loads and displays download history from localStorage', () => {
    const mockHistory = [
      { title: 'Song A', format: 'MP3', date: '3/20/2026', size: '4.2 MB' },
      { title: 'Song B', format: 'WAV', date: '3/19/2026', size: '12.1 MB' },
    ];
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(mockHistory));

    render(<GlobalJobProvider><YouTubeDownloader /></GlobalJobProvider>);

    expect(screen.getByTestId('download-history')).toBeInTheDocument();
    expect(screen.getByText('Song A')).toBeInTheDocument();
    expect(screen.getByText('Song B')).toBeInTheDocument();
  });

  /* ── Clear history ── */
  test('clear history button removes all entries and clears localStorage', () => {
    const mockHistory = [
      { title: 'Song A', format: 'MP3', date: '3/20/2026', size: '4.2 MB' },
    ];
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(mockHistory));

    render(<GlobalJobProvider><YouTubeDownloader /></GlobalJobProvider>);
    expect(screen.getByText('Song A')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('clear-history-btn'));
    expect(screen.queryByText('Song A')).not.toBeInTheDocument();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('celestial-yt-history');
  });

  /* ── Paste from clipboard ── */
  test('paste button reads from clipboard and sets URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ title: 'Pasted Video', thumbnail: '', duration: '2:00' }),
    });

    render(<GlobalJobProvider><YouTubeDownloader /></GlobalJobProvider>);
    const pasteBtn = screen.getByTestId('paste-btn');
    
    await act(async () => {
      fireEvent.click(pasteBtn);
    });

    const input = screen.getByTestId('url-input') as HTMLInputElement;
    expect(input.value).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  /* ── POST payload structure ── */
  test('initialize button POSTs correct JSON payload', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/octet-stream' }),
      blob: async () => new Blob(['audio'], { type: 'audio/mpeg' }),
    });

    render(<GlobalJobProvider><YouTubeDownloader /></GlobalJobProvider>);
    const input = screen.getByTestId('url-input');
    fireEvent.change(input, { target: { value: 'https://www.youtube.com/watch?v=test123' } });

    // Select WAV format
    fireEvent.click(screen.getByTestId('format-wav'));

    // Click initialize
    fireEvent.click(screen.getByTestId('initialize-btn'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
      // Find the POST call (not the info GET)
      const postCall = mockFetch.mock.calls.find(
        (c: any[]) => c[1]?.method === 'POST'
      );
      expect(postCall).toBeTruthy();
      const [postUrl, opts] = postCall!;
      expect(postUrl).toContain('/api/youtube');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.url).toBe('https://www.youtube.com/watch?v=test123');
      expect(body.format).toBe('wav');
      expect(body.isPlaylist).toBe(false);
    });
  });

  /* ── Initialize disabled without URL ── */
  test('initialize button disabled when URL is empty', () => {
    render(<GlobalJobProvider><YouTubeDownloader /></GlobalJobProvider>);
    const btn = screen.getByTestId('initialize-btn');
    expect(btn).toBeDisabled();
  });

  /* ── Instagram URL support ── */
  test('valid Instagram reel URL enables initialize button and shows Instagram detection helper', async () => {
    render(<GlobalJobProvider><YouTubeDownloader /></GlobalJobProvider>);
    const input = screen.getByTestId('url-input');
    fireEvent.change(input, { target: { value: 'https://www.instagram.com/reel/C8abc123/' } });

    const btn = screen.getByTestId('initialize-btn');
    expect(btn).not.toBeDisabled();

    expect(screen.getByText(/DETECTED: INSTAGRAM REEL \/ POST/i)).toBeInTheDocument();
  });

  test('Instagram URL supports Carousel / Playlist mode and Multi-URL Batch Queue', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/octet-stream' }),
      blob: async () => new Blob(['video'], { type: 'video/mp4' }),
    });

    render(<GlobalJobProvider><YouTubeDownloader /></GlobalJobProvider>);
    const input = screen.getByTestId('url-input');

    // Add first Instagram Reel to batch queue
    fireEvent.change(input, { target: { value: 'https://www.instagram.com/reel/C8reel1/' } });
    fireEvent.click(screen.getByTestId('add-batch-btn'));

    // Add second Instagram Post to batch queue
    fireEvent.change(input, { target: { value: 'https://instagram.com/p/C9post2/' } });
    fireEvent.click(screen.getByTestId('add-batch-btn'));

    expect(screen.getByTestId('batch-url-queue')).toBeInTheDocument();
    expect(screen.getByTestId('batch-url-item-0')).toHaveTextContent('https://www.instagram.com/reel/C8reel1/');
    expect(screen.getByTestId('batch-url-item-1')).toHaveTextContent('https://instagram.com/p/C9post2/');

    // Enable carousel/playlist mode for batch
    fireEvent.click(screen.getByTestId('playlist-toggle'));

    fireEvent.click(screen.getByTestId('initialize-btn'));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        (c: any[]) => c[1]?.method === 'POST'
      );
      expect(postCall).toBeTruthy();
      const body = JSON.parse(postCall![1].body);
      expect(body.urls).toEqual([
        'https://www.instagram.com/reel/C8reel1/',
        'https://instagram.com/p/C9post2/'
      ]);
      expect(body.isPlaylist).toBe(true);
    });
  });

  test('rejects spoofed Instagram domain or private IP URLs', () => {
    render(<GlobalJobProvider><YouTubeDownloader /></GlobalJobProvider>);
    const input = screen.getByTestId('url-input');
    const btn = screen.getByTestId('initialize-btn');

    fireEvent.change(input, { target: { value: 'https://instagram.com.evil.com/reel/123' } });
    expect(btn).toBeDisabled();

    fireEvent.change(input, { target: { value: 'http://127.0.0.1:3000/reel/123' } });
    expect(btn).toBeDisabled();
  });
});
