import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach, describe } from 'vitest';
import UniversalCompressor from '../../src/app/tools/hevc/page';
import { GlobalJobProvider } from '../../src/app/context/GlobalJobContext';

const mockFetch = vi.fn();
global.fetch = mockFetch;
global.URL.createObjectURL = vi.fn(() => 'blob:mock');
global.URL.revokeObjectURL = vi.fn();
if (typeof window !== 'undefined') {
  window.alert = vi.fn();
}

describe('Universal Compressor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders dropzone supporting Video, Audio, and Photo formats', () => {
    render(<GlobalJobProvider><UniversalCompressor /></GlobalJobProvider>);
    expect(screen.getAllByText(/Universal/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Compressor/i).length).toBeGreaterThan(0);
  });

  test('CRF slider updates value on change', () => {
    render(<GlobalJobProvider><UniversalCompressor /></GlobalJobProvider>);
    const slider = screen.getByTestId('crf-slider') as HTMLInputElement;
    expect(slider.value).toBe('28');
    expect(screen.getByTestId('crf-value')).toHaveTextContent('28');

    fireEvent.change(slider, { target: { value: '24' } });
    expect(screen.getByTestId('crf-value')).toHaveTextContent('24');
  });

  test('batch uploading mixed files (MP4 video, MP3 audio, PNG photo) populates queue cards with media badges', async () => {
    render(<GlobalJobProvider><UniversalCompressor /></GlobalJobProvider>);
    const input = screen.getByTestId('file-input');

    const videoFile = new File(['x'.repeat(10 * 1024 * 1024)], 'sample.mp4', { type: 'video/mp4' });
    const audioFile = new File(['y'.repeat(5 * 1024 * 1024)], 'track.mp3', { type: 'audio/mp3' });
    const photoFile = new File(['z'.repeat(2 * 1024 * 1024)], 'image.png', { type: 'image/png' });

    Object.defineProperty(input, 'files', { value: [videoFile, audioFile, photoFile], configurable: true });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByTitle('sample.mp4')).toHaveTextContent('sample.mp4');
      expect(screen.getByTitle('track.mp3')).toHaveTextContent('track.mp3');
      expect(screen.getByTitle('image.png')).toHaveTextContent('image.png');

      const items = screen.getAllByTestId('batch-file-item');
      expect(items).toHaveLength(3);
    });
  });

  test('parameter switching adjusts estimated reduction accurately per media category', async () => {
    render(<GlobalJobProvider><UniversalCompressor /></GlobalJobProvider>);
    const input = screen.getByTestId('file-input');
    const videoFile = new File(['x'.repeat(10 * 1024 * 1024)], 'video.mp4', { type: 'video/mp4' });

    Object.defineProperty(input, 'files', { value: [videoFile], configurable: true });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByTestId('estimated-reduction')).toBeInTheDocument();
    });

    const initialReduction = screen.getByTestId('estimated-reduction').textContent;

    // Switch CRF slider to 35 (higher compression)
    const crfSlider = screen.getByTestId('crf-slider');
    fireEvent.change(crfSlider, { target: { value: '35' } });

    await waitFor(() => {
      const updatedReduction = screen.getByTestId('estimated-reduction').textContent;
      expect(updatedReduction).not.toBe(initialReduction);
    });

    // Switch tab to AUDIO and adjust bitrate
    const audioTab = screen.getByTestId('tab-audio');
    fireEvent.click(audioTab);

    await waitFor(() => {
      expect(screen.getByTestId('bitrate-64k')).toBeInTheDocument();
    });

    const b64Btn = screen.getByTestId('bitrate-64k');
    fireEvent.click(b64Btn);

    expect(b64Btn).toHaveAttribute('aria-pressed', 'true');
  });

  test('handles batch initialization and sends request to /api/compress', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"progress":100}\n\n'));
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({ ok: true, body: stream });

    render(<GlobalJobProvider><UniversalCompressor /></GlobalJobProvider>);

    const input = screen.getByTestId('file-input');
    const file = new File(['test'], 'demo.mp4', { type: 'video/mp4' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    await waitFor(() => screen.getByTestId('initialize-btn'));
    fireEvent.click(screen.getByTestId('initialize-btn'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/compress'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  test('disables image quality slider for lossless PNG and updates estimate dynamically for lossy photo formats', async () => {
    render(<GlobalJobProvider><UniversalCompressor /></GlobalJobProvider>);
    const input = screen.getByTestId('file-input');
    const jpgFile = new File(['x'.repeat(4 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [jpgFile], configurable: true });
    fireEvent.change(input);

    // Default photo format is WEBP: quality slider is enabled and changes estimated size
    await waitFor(() => {
      expect(screen.getByTestId('image-quality-slider')).not.toBeDisabled();
    });
    const webpEstAt80 = screen.getByTestId('estimated-output-size').textContent;
    fireEvent.change(screen.getByTestId('image-quality-slider'), { target: { value: '30' } });
    await waitFor(() => {
      expect(screen.getByTestId('estimated-output-size').textContent).not.toBe(webpEstAt80);
    });

    // Switch to PNG (lossless): quality slider becomes disabled, shows LOSSLESS + expansion explanation
    fireEvent.click(screen.getByTestId('image-format-png'));
    await waitFor(() => {
      expect(screen.getByTestId('image-quality-slider')).toBeDisabled();
      expect(screen.getByTestId('image-quality-value')).toHaveTextContent('LOSSLESS');
      expect(screen.getByTestId('png-lossless-note')).toBeInTheDocument();
      expect(screen.getByTestId('expansion-explanation')).toBeInTheDocument();
    });
  });
});
