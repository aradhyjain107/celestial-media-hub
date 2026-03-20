import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach, describe } from 'vitest';
import HEVCCompressor from '../../app/tools/hevc/page';

const mockFetch = vi.fn();
global.fetch = mockFetch;
global.URL.createObjectURL = vi.fn(() => 'blob:mock');
global.URL.revokeObjectURL = vi.fn();

describe('HEVC Compressor', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  test('renders dropzone with accepted format text', () => {
    render(<HEVCCompressor />);
    expect(screen.getByText(/MOV/i)).toBeInTheDocument();
    expect(screen.getByText(/MP4/i)).toBeInTheDocument();
    expect(screen.getByText(/MKV/i)).toBeInTheDocument();
  });

  test('CRF slider defaults to 28 and updates on change', () => {
    render(<HEVCCompressor />);
    const slider = screen.getByTestId('crf-slider') as HTMLInputElement;
    expect(slider.value).toBe('28');
    expect(screen.getByTestId('crf-value')).toHaveTextContent('28');

    fireEvent.change(slider, { target: { value: '24' } });
    expect(screen.getByTestId('crf-value')).toHaveTextContent('24');
  });

  test('preset selector defaults to fast and changes correctly', () => {
    render(<HEVCCompressor />);
    const select = screen.getByTestId('preset-select') as HTMLSelectElement;
    expect(select.value).toBe('fast');
    fireEvent.change(select, { target: { value: 'slow' } });
    expect(select.value).toBe('slow');
  });

  test('hardware accel checkbox defaults checked and toggles', () => {
    render(<HEVCCompressor />);
    const toggle = screen.getByTestId('hw-accel-toggle');
    // Default: checked class present
    expect(toggle.querySelector('.checkbox.checked')).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.querySelector('.checkbox:not(.checked)')).toBeTruthy();
  });

  test('file drop populates queue and shows size estimate', async () => {
    render(<HEVCCompressor />);
    const input = screen.getByTestId('file-input');
    const file = new File(['x'.repeat(10 * 1024 * 1024)], 'big.mp4', { type: 'video/mp4' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByText('big.mp4')).toBeInTheDocument();
      expect(screen.getByTestId('estimated-size')).toBeInTheDocument();
      // At CRF 28, ~50% reduction
      expect(screen.getByText(/~50%/)).toBeInTheDocument();
    });
  });

  test('options changes update POST body — CRF and preset sent correctly', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode('data: {"progress":100,"zipBase64":"AAEC"}\n\n'));
        c.close();
      },
    });
    mockFetch.mockResolvedValueOnce({ ok: true, body: stream });

    render(<HEVCCompressor />);

    // Set CRF to 22 and preset to slow
    fireEvent.change(screen.getByTestId('crf-slider'), { target: { value: '22' } });
    fireEvent.change(screen.getByTestId('preset-select'), { target: { value: 'slow' } });

    // Drop a file
    const input = screen.getByTestId('file-input');
    const file = new File(['mock'], 'video.mp4', { type: 'video/mp4' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    await waitFor(() => screen.getByTestId('initialize-btn'));
    fireEvent.click(screen.getByTestId('initialize-btn'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/hevc'),
        expect.objectContaining({ method: 'POST' })
      );
      // Verify formData has correct values by checking the call args
      const [, opts] = mockFetch.mock.calls[0];
      const fd = opts.body as FormData;
      expect(fd.get('crf')).toBe('22');
      expect(fd.get('preset')).toBe('slow');
      expect(fd.get('hardwareAccel')).toBe('true');
    });
  });

  test('SSE progress updates fill bar', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode('data: {"progress":67}\n\n'));
        c.enqueue(encoder.encode('data: {"progress":100,"zipBase64":"AAEC"}\n\n'));
        c.close();
      },
    });
    mockFetch.mockResolvedValueOnce({ ok: true, body: stream });

    render(<HEVCCompressor />);
    const input = screen.getByTestId('file-input');
    const file = new File(['mock'], 'video.mp4', { type: 'video/mp4' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    fireEvent.click(screen.getByTestId('initialize-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('progress-fill')).toHaveStyle({ width: '100%' });
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

    render(<HEVCCompressor />);
    const input = screen.getByTestId('file-input');
    const file = new File(['mock'], 'video.mp4', { type: 'video/mp4' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    fireEvent.click(screen.getByTestId('initialize-btn'));

    await waitFor(() => {
      expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    }, { timeout: 3000 });
  });

  test('error state renders error badge', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode('data: {"error":"Encoder failed"}\n\n'));
        c.close();
      },
    });
    mockFetch.mockResolvedValueOnce({ ok: true, body: stream });

    render(<HEVCCompressor />);
    const input = screen.getByTestId('file-input');
    const file = new File(['mock'], 'video.mp4', { type: 'video/mp4' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    fireEvent.click(screen.getByTestId('initialize-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('badge-error')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  test('clear button resets state to initial', async () => {
    render(<HEVCCompressor />);
    const input = screen.getByTestId('file-input');
    const file = new File(['mock'], 'video.mp4', { type: 'video/mp4' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    const clearBtn = await waitFor(() => screen.getByTestId('clear-btn'));
    fireEvent.click(clearBtn);

    await waitFor(() => {
      expect(screen.queryByText('video.mp4')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('queue-count')).toHaveTextContent('QUEUE: 0 FILE');
  });
});
