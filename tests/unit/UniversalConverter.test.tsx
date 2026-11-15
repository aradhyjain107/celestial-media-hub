import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach, describe } from 'vitest';
import UniversalConverter from '../../app/tools/converter/page';
import { GlobalJobProvider } from '../../app/context/GlobalJobContext';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Universal Converter Component', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  /* ── Format selection ── */
  test('format tile grid renders active tab formats and updates state on tab switch', async () => {
    render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

    const formatGrid = screen.getByTestId('format-grid');
    expect(formatGrid).toBeInTheDocument();

    // In default VIDEO tab, video formats are rendered
    const videoFormats = ['mp4', 'mkv', 'mov', 'webm', 'gif'];
    videoFormats.forEach(fmt => {
      expect(screen.getByTestId(`format-${fmt}`)).toBeInTheDocument();
    });

    // Default is mp4
    const mp4Tile = screen.getByTestId('format-mp4');
    expect(mp4Tile.style.borderColor || mp4Tile.style.border).toContain('var(--accent)');

    // Switch to AUDIO tab
    fireEvent.click(screen.getByTestId('tab-audio'));
    await waitFor(() => {
      expect(screen.getByTestId('format-mp3')).toBeInTheDocument();
      expect(screen.getByTestId('format-wav')).toBeInTheDocument();
    });

    // Click wav
    fireEvent.click(screen.getByTestId('format-wav'));
    const wavTile = screen.getByTestId('format-wav');
    expect(wavTile.style.border).toContain('var(--accent)');

    // Switch to PHOTO tab
    fireEvent.click(screen.getByTestId('tab-photo'));
    await waitFor(() => {
      expect(screen.getByTestId('format-png')).toBeInTheDocument();
      expect(screen.getByTestId('format-webp')).toBeInTheDocument();
    });
  });

  /* ── Audio & Image format hides video-specific options ── */
  test('selecting audio or image tab hides platform preset and video-specific advanced options', () => {
    render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

    // Presets visible in default (VIDEO tab) 
    expect(screen.getByTestId('preset-grid')).toBeInTheDocument();

    // Switch to AUDIO tab
    fireEvent.click(screen.getByTestId('tab-audio'));
    expect(screen.queryByTestId('preset-grid')).not.toBeInTheDocument();

    // Switch to PHOTO tab
    fireEvent.click(screen.getByTestId('tab-photo'));
    expect(screen.queryByTestId('preset-grid')).not.toBeInTheDocument();
  });

  /* ── Platform preset application ── */
  test('selecting a preset updates the preset indicator text', () => {
    render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

    // Default preset is 'high'
    const presetGrid = screen.getByTestId('preset-grid');
    expect(presetGrid).toBeInTheDocument();

    // Click WhatsApp preset
    fireEvent.click(screen.getByTestId('preset-whatsapp'));
    
    // The preset header mono-data span should show WHATSAPP
    const whatsappTexts = screen.getAllByText('WHATSAPP');
    expect(whatsappTexts.length).toBeGreaterThanOrEqual(1);
    // The mono-data header element should be one of them
    const headerSpan = whatsappTexts.find(el => el.classList.contains('mono-data'));
    expect(headerSpan).toBeTruthy();
  });

  /* ── Custom override clears preset ── */
  test('changing advanced options clears preset to custom', () => {
    render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);
    
    // Select a preset first
    fireEvent.click(screen.getByTestId('preset-discord'));
    const discordTexts = screen.getAllByText('DISCORD');
    expect(discordTexts.length).toBeGreaterThanOrEqual(1);

    // Open advanced options
    fireEvent.click(screen.getByTestId('advanced-toggle'));
    expect(screen.getByTestId('advanced-section')).toBeInTheDocument();

    // Change resolution to 360p — should clear preset to CUSTOM
    fireEvent.click(screen.getByTestId('resolution-360p'));

    // Preset should now be CUSTOM
    expect(screen.getByText('CUSTOM')).toBeInTheDocument();
  });

  /* ── Advanced options collapsed by default ── */
  test('advanced options section is collapsed by default', () => {
    render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);
    expect(screen.queryByTestId('advanced-section')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('advanced-toggle'));
    expect(screen.getByTestId('advanced-section')).toBeInTheDocument();
  });

  /* ── GIF options visibility ── */
  test('GIF options only visible when GIF format is selected', () => {
    render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

    // GIF options should not be visible with mp4
    expect(screen.queryByTestId('gif-options')).not.toBeInTheDocument();

    // Select GIF format
    fireEvent.click(screen.getByTestId('format-gif'));

    // GIF options should now be visible
    expect(screen.getByTestId('gif-options')).toBeInTheDocument();
    expect(screen.getByTestId('gif-fps-10')).toBeInTheDocument();
    expect(screen.getByTestId('gif-fps-15')).toBeInTheDocument();
    expect(screen.getByTestId('gif-fps-24')).toBeInTheDocument();
    expect(screen.getByTestId('gif-palette-toggle')).toBeInTheDocument();
  });

  /* ── GIF FPS selection ── */
  test('GIF frame rate chips are selectable', () => {
    render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);
    fireEvent.click(screen.getByTestId('format-gif'));

    const fps24 = screen.getByTestId('gif-fps-24');
    fireEvent.click(fps24);
    expect(fps24.style.border).toContain('var(--accent)');
  });

  /* ── POST payload structure ── */
  test('initialize button POSTs correct payload with FormData', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/octet-stream' }),
      blob: async () => new Blob(['test'], { type: 'application/octet-stream' }),
    });

    render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

    // Drop a file
    const dropzone = screen.getByTestId('file-input');
    const file = new File(['testcontent'], 'sample.mp4', { type: 'video/mp4' });
    Object.defineProperty(dropzone, 'files', { value: [file] });
    fireEvent.change(dropzone);

    // Select MKV format
    await waitFor(() => {
      expect(screen.getByTestId('clear-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('format-mkv'));

    // Click initialize
    const initBtn = screen.getByTestId('initialize-btn');
    fireEvent.click(initBtn);

    await waitFor(() => {
      const convertCall = mockFetch.mock.calls.find(([url]) => String(url).includes('/api/convert'));
      expect(convertCall).toBeDefined();
      const [url, opts] = convertCall!;
      expect(url).toContain('/api/convert');
      expect(opts.method).toBe('POST');
      expect(opts.body instanceof FormData).toBe(true);
      const fd = opts.body as FormData;
      expect(fd.get('outputFormat')).toBe('mkv');
      expect(fd.get('preset')).toBe('high');
      expect(fd.get('speed')).toBe('1');
      expect(fd.get('stripAudio')).toBe('false');
      expect(fd.get('stripMetadata')).toBe('false');
    });
  });

  /* ── Initialize button disabled without file ── */
  test('initialize button is disabled when no file is loaded', () => {
    render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);
    const btn = screen.getByTestId('initialize-btn');
    expect(btn).toBeDisabled();
  });

  /* ── Speed chips ── */
  test('speed chip selection works in advanced options', () => {
    render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);
    fireEvent.click(screen.getByTestId('advanced-toggle'));

    const speed2 = screen.getByTestId('speed-2');
    fireEvent.click(speed2);
    expect(speed2.style.border).toContain('var(--accent)');
  });

  /* ── Strip metadata toggle ── */
  test('strip metadata checkbox toggles on click', () => {
    render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);
    fireEvent.click(screen.getByTestId('advanced-toggle'));

    const toggle = screen.getByTestId('strip-metadata-toggle');
    fireEvent.click(toggle);
    const checkboxInput = toggle.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkboxInput).toBeChecked();
  });

  /* ── Multi-file batch selection ── */
  test('supports selecting multiple files for batch conversion up to 50 files', async () => {
    render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

    const dropzone = screen.getByTestId('file-input');
    const file1 = new File(['1'], 'one.mp4', { type: 'video/mp4' });
    const file2 = new File(['2'], 'two.mp4', { type: 'video/mp4' });
    Object.defineProperty(dropzone, 'files', { value: [file1, file2] });
    fireEvent.change(dropzone);

    await waitFor(() => {
      expect(screen.getAllByTestId('batch-file-item').length).toBe(2);
      expect(screen.getByText(/BATCH QUEUE/i)).toBeInTheDocument();
    });
  });
});
