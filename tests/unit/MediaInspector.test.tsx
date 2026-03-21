import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, vi, beforeEach, expect } from 'vitest';
import MediaInspector from '../../app/tools/inspector/page';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock clipboard
Object.assign(navigator, {
  clipboard: { writeText: vi.fn() },
});

describe('Media Inspector Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders dropzone with correct instruction text', () => {
    render(<MediaInspector />);
    expect(screen.getByText(/Drop media to begin/i)).toBeInTheDocument();
    expect(screen.getByText(/Drop any media file here to extract telemetry mapping./i)).toBeInTheDocument();
  });

  test('file drop triggers POST, metadata renders, copy works, clear resets', async () => {
    const mockMetadata = {
      filename: 'video.mp4',
      size: 1048576,
      format: 'mov,mp4',
      duration: 12.3,
      videoCodec: 'h264',
      resolution: '1920x1080',
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ metadata: mockMetadata }),
    });

    render(<MediaInspector />);
    const dropzone = screen.getByTestId('file-input');
    const file = new File(['mock'], 'video.mp4', { type: 'video/mp4' });
    Object.defineProperty(dropzone, 'files', { value: [file] });
    fireEvent.change(dropzone);

    // Should show analyzing state
    expect(screen.getAllByText('ANALYZING...').length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.getByText('COMPLETE')).toBeInTheDocument();
      expect(screen.getByText('video.mp4')).toBeInTheDocument();
      expect(screen.getByText('1.00 MB')).toBeInTheDocument();
      expect(screen.getByText('h264')).toBeInTheDocument();
    });

    const copyBtn = screen.getByText('COPY JSON');
    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('video.mp4'));

    const clearBtn = screen.getByText('CLEAR');
    fireEvent.click(clearBtn);
    expect(screen.getByText('READY')).toBeInTheDocument();
    expect(screen.queryByText('video.mp4')).not.toBeInTheDocument();
  });

  test('error state renders on failed POST', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Invalid Format Provided' }),
    });

    render(<MediaInspector />);
    const dropzone = screen.getByTestId('file-input');
    const file = new File(['mock'], 'bad.txt', { type: 'text/plain' });
    Object.defineProperty(dropzone, 'files', { value: [file] });
    fireEvent.change(dropzone);

    await waitFor(() => {
      expect(screen.getAllByText('ERROR').length).toBeGreaterThan(0);
      expect(screen.getByText('Invalid Format Provided')).toBeInTheDocument();
    });
  });
});
