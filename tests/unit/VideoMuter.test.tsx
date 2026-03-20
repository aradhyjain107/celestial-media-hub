import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { expect, test, vi, beforeEach, describe } from 'vitest';
import VideoMuter from '../../app/tools/muter/page';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock URL methods for download
global.URL.createObjectURL = vi.fn(() => 'blob:mock');
global.URL.revokeObjectURL = vi.fn();

describe('Video Muter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders dropzone with correct accepted formats text', () => {
    render(<VideoMuter />);
    expect(screen.getByText(/MOV.*MP4.*MKV.*WebM/i)).toBeInTheDocument();
  });

  test('file drop populates queue and shows file count', async () => {
    render(<VideoMuter />);
    const input = screen.getByTestId('file-input');
    const file = new File(['mock'], 'clip.mp4', { type: 'video/mp4' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByTestId('queue-count')).toHaveTextContent('QUEUE: 1 FILE');
      expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    });
  });

  test('mode selector toggles between remove and silence', async () => {
    render(<VideoMuter />);
    // Drop a file first to see options
    const input = screen.getByTestId('file-input');
    const file = new File(['mock'], 'clip.mp4', { type: 'video/mp4' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    // Click silence mode
    const silenceBtn = screen.getByTestId('mode-silence');
    fireEvent.click(silenceBtn);
    // Mode text should update — "SILENCE" appears in the summary
    await waitFor(() => {
      expect(screen.getByText('SILENCE')).toBeInTheDocument();
    });

    // Click remove mode
    const removeBtn = screen.getByTestId('mode-remove');
    fireEvent.click(removeBtn);
    await waitFor(() => {
      expect(screen.getByText('REMOVE')).toBeInTheDocument();
    });
  });

  test('initialize button POSTs files + mode and SSE progress updates UI', async () => {
    // Build a fake SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"progress":50}\n\n'));
        controller.enqueue(encoder.encode('data: {"progress":100,"zipBase64":"AAEC"}\n\n'));
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({ ok: true, body: stream });

    render(<VideoMuter />);

    const input = screen.getByTestId('file-input');
    const file = new File(['mock'], 'test.mp4', { type: 'video/mp4' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    await waitFor(() => screen.getByTestId('initialize-btn'));
    fireEvent.click(screen.getByTestId('initialize-btn'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/mute'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    // SSE drives progress fill to 100%
    await waitFor(() => {
      const fill = screen.getByTestId('progress-fill');
      expect(fill).toHaveStyle({ width: '100%' });
    }, { timeout: 3000 });
  });

  test('completion triggers ZIP download — createObjectURL called with Blob', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode('data: {"progress":100,"zipBase64":"AAEC"}\n\n'));
        c.close();
      },
    });
    mockFetch.mockResolvedValueOnce({ ok: true, body: stream });

    render(<VideoMuter />);
    const input = screen.getByTestId('file-input');
    const file = new File(['mock'], 'test.mp4', { type: 'video/mp4' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    fireEvent.click(screen.getByTestId('initialize-btn'));

    await waitFor(() => {
      // createObjectURL is called with a Blob when download is triggered
      expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    }, { timeout: 3000 });
  });

  test('error state sets all items to error status', async () => {
    // Simulate a stream that emits an error payload
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode('data: {"error":"FFmpeg crashed"}\n\n'));
        c.close();
      },
    });
    mockFetch.mockResolvedValueOnce({ ok: true, body: stream });

    render(<VideoMuter />);
    const input = screen.getByTestId('file-input');
    const file = new File(['mock'], 'fail.mp4', { type: 'video/mp4' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    fireEvent.click(screen.getByTestId('initialize-btn'));

    // Error thrown inside the loop sets all items to 'error'
    await waitFor(() => {
      expect(screen.getByTestId('badge-error')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  test('clear button resets state to empty queue', async () => {
    render(<VideoMuter />);
    const input = screen.getByTestId('file-input');
    const file = new File(['mock'], 'clip.mp4', { type: 'video/mp4' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    // Wait for the clear button to appear (it shows after files are added)
    const clearBtn = await waitFor(() => screen.getByTestId('clear-btn'));
    fireEvent.click(clearBtn);

    await waitFor(() => {
      // After clear, dropzone should re-appear (no file names)
      expect(screen.queryByText('clip.mp4')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('queue-count')).toHaveTextContent('QUEUE: 0 FILE');
  });
});
