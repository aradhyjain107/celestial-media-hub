/**
 * AudioTrimmer.test.tsx
 * Unit tests for app/tools/trimmer/page.tsx
 *
 * Mocks:
 *  - WaveformCanvas (canvas is not available in jsdom)
 *  - WaveformEngine.generateWaveform (async decode)
 *  - FileReader (to simulate readAsArrayBuffer)
 *  - HTMLAudioElement (jsdom does not implement play/pause)
 *  - global fetch (for POST assertions)
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock WaveformCanvas — canvas doesn't exist in jsdom
vi.mock('../../src/app/components/waveform/WaveformCanvas', () => ({
  default: (props: { left: Float32Array }) => (
    <div data-testid="waveform-canvas" data-samples={props.left.length} />
  ),
}));

// Mock WaveformEngine
vi.mock('../../src/app/components/waveform/WaveformEngine', () => ({
  generateWaveform: vi.fn().mockResolvedValue({
    left: new Float32Array(100).fill(0.5),
    right: undefined,
  }),
}));

// Mock FileReader
const mockReadAsArrayBuffer = vi.fn();
vi.stubGlobal('FileReader', class {
  onload: ((ev: ProgressEvent) => void) | null = null;
  onerror: ((ev: ProgressEvent) => void) | null = null;
  result: ArrayBuffer | null = new ArrayBuffer(8);
  readAsArrayBuffer(_file: Blob) {
    mockReadAsArrayBuffer(_file);
    // Immediately fire onload
    setTimeout(() => {
      this.result = new ArrayBuffer(8);
      this.onload?.({ target: this } as unknown as ProgressEvent);
    }, 0);
  }
});

// Mock Audio element
vi.stubGlobal('Audio', class {
  src = '';
  currentTime = 0;
  duration = 30;
  onloadedmetadata: (() => void) | null = null;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  addEventListener(event: string, handler: EventListener) {
    if (event === 'loadedmetadata') {
      // Trigger immediately
      setTimeout(() => handler({} as Event), 0);
    }
  }
  removeEventListener = vi.fn();
  remove = vi.fn();
});

// Mock URL.createObjectURL / revokeObjectURL
vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:http://localhost/mock-audio'),
  revokeObjectURL: vi.fn(),
});

// Mock fetch
const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
vi.stubGlobal('fetch', mockFetch);

// ── Import page after mocks are set up ────────────────────────────────────────
import AudioTrimmerPage from '../../src/app/tools/trimmer/page';
import { GlobalJobProvider } from '../../src/app/context/GlobalJobContext';
import { generateWaveform } from '../../src/app/components/waveform/WaveformEngine';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFile(name = 'test.mp3', type = 'audio/mpeg'): File {
  return new File(['audio bytes'], name, { type });
}

function dropFile(file: File) {
  const dropzone = screen.getByTestId('dropzone');
  fireEvent.drop(dropzone, {
    dataTransfer: { files: [file], types: ['Files'] },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AudioTrimmerPage', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    vi.mocked(generateWaveform).mockClear();
  });

  it('renders the dropzone in TRIM mode by default', () => {
    render(<GlobalJobProvider><AudioTrimmerPage /></GlobalJobProvider>);
    expect(screen.getByTestId('dropzone')).toBeInTheDocument();
    expect(screen.queryByTestId('waveform-canvas')).not.toBeInTheDocument();
  });

  it('mode toggle switches to MERGE and back to TRIM', () => {
    render(<GlobalJobProvider><AudioTrimmerPage /></GlobalJobProvider>);
    const modeSelect = screen.getByTestId('mode-select');

    // Switch to MERGE
    fireEvent.change(modeSelect, { target: { value: 'MERGE' } });
    expect(screen.getByDisplayValue('MERGE')).toBeInTheDocument();

    // Switch back to TRIM
    fireEvent.change(modeSelect, { target: { value: 'TRIM' } });
    expect(screen.getByDisplayValue('TRIM')).toBeInTheDocument();
  });

  it('displays waveform canvas after file is dropped in TRIM mode', async () => {
    render(<GlobalJobProvider><AudioTrimmerPage /></GlobalJobProvider>);
    dropFile(makeFile('song.mp3'));

    await waitFor(() => {
      expect(vi.mocked(generateWaveform)).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByTestId('waveform-canvas')).toBeInTheDocument();
    });
  });

  it('POSTs trim payload to /api/audio-trim in TRIM mode', async () => {
    render(<GlobalJobProvider><AudioTrimmerPage /></GlobalJobProvider>);
    dropFile(makeFile('song.mp3'));

    await waitFor(() => {
      expect(screen.getByTestId('waveform-canvas')).toBeInTheDocument();
    });

    // Click Initialize
    fireEvent.click(screen.getByTestId('initialize-btn'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/audio-trim',
        expect.objectContaining({ method: 'POST' })
      );
    });

    const body = mockFetch.mock.calls[0][1].body as FormData;
    expect(body.get('startTime')).not.toBeNull();
    expect(body.get('endTime')).not.toBeNull();
    expect(body.get('fadeIn')).not.toBeNull();
    expect(body.get('fadeOut')).not.toBeNull();
    expect(body.get('mode')).toBe('trim');
  });

  it('POSTs merge payload with all files in MERGE mode', async () => {
    render(<GlobalJobProvider><AudioTrimmerPage /></GlobalJobProvider>);

    // Switch to MERGE
    fireEvent.change(screen.getByTestId('mode-select'), { target: { value: 'MERGE' } });

    // Drop two files
    const dropzone = screen.getByTestId('dropzone');
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [makeFile('a.mp3'), makeFile('b.mp3')], types: ['Files'] },
    });

    // Both file names appear in merge list
    await waitFor(() => {
      const items = screen.getAllByTestId('merge-file-item');
      expect(items).toHaveLength(2);
    });

    // Initialize
    fireEvent.click(screen.getByTestId('initialize-btn'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/audio-trim',
        expect.objectContaining({ method: 'POST' })
      );
    });

    const body = mockFetch.mock.calls[0][1].body as FormData;
    expect(body.get('mode')).toBe('merge');
    const files = body.getAll('files');
    expect(files).toHaveLength(2);
  });

  it('fade controls update displayed values', async () => {
    render(<GlobalJobProvider><AudioTrimmerPage /></GlobalJobProvider>);
    dropFile(makeFile('song.mp3'));

    await waitFor(() => screen.getByTestId('waveform-canvas'));

    // Move fade-in slider to 3
    fireEvent.change(screen.getByTestId('fade-in-slider'), { target: { value: '3' } });
    expect(screen.getByTestId('fade-in-value').textContent).toBe('3s');

    // Move fade-out slider to 2
    fireEvent.change(screen.getByTestId('fade-out-slider'), { target: { value: '2' } });
    expect(screen.getByTestId('fade-out-value').textContent).toBe('2s');
  });

  it('trim input fields reflect canvas drag selection', async () => {
    render(<GlobalJobProvider><AudioTrimmerPage /></GlobalJobProvider>);
    dropFile(makeFile('song.mp3'));

    await waitFor(() => screen.getByTestId('waveform-canvas'));

    // Change trim-start input
    const startInput = screen.getByTestId('trim-start-input');
    fireEvent.change(startInput, { target: { value: '5' } });
    expect((startInput as HTMLInputElement).value).toBe('5');

    // Change trim-end input
    const endInput = screen.getByTestId('trim-end-input');
    fireEvent.change(endInput, { target: { value: '20' } });
    expect((endInput as HTMLInputElement).value).toBe('20');
  });
});
