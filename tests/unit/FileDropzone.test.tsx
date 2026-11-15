import { render, fireEvent, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { FileDropzone } from '../../app/components/ui/FileDropzone';

describe('FileDropzone', () => {
  test('renders accurately and triggers selection', () => {
    const onSelect = vi.fn();
    render(<FileDropzone onFilesSelected={onSelect} formatsListText="Accepted: MP4, MKV" />);
    
    expect(screen.getByText('Drop media to begin')).toBeInTheDocument();
    expect(screen.getByText('Accepted: MP4, MKV')).toBeInTheDocument();

    const file = new File(['mock content'], 'video.mp4', { type: 'video/mp4' });
    const input = screen.getByTestId('file-input');
    
    fireEvent.change(input, { target: { files: [file] } });
    
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0][0].name).toBe('video.mp4');
  });

  test('handles drag states correctly', () => {
    const onSelect = vi.fn();
    render(<FileDropzone onFilesSelected={onSelect} />);
    
    const zone = screen.getByTestId('dropzone');
    
    fireEvent.dragOver(zone);
    expect(zone.className).toContain('active');
    
    fireEvent.dragLeave(zone);
    expect(zone.className).not.toContain('active');
  });

  test('renders prominent add items icon and supports keyboard trigger', () => {
    const onSelect = vi.fn();
    render(<FileDropzone onFilesSelected={onSelect} />);
    
    const addIcon = screen.getByTestId('add-items-icon');
    expect(addIcon).toBeInTheDocument();

    const zone = screen.getByTestId('dropzone');
    const input = screen.getByTestId('file-input');
    const clickSpy = vi.spyOn(input, 'click');

    fireEvent.keyDown(zone, { key: 'Enter' });
    expect(clickSpy).toHaveBeenCalledTimes(1);

    fireEvent.keyUp(zone, { key: ' ' });
    expect(clickSpy).toHaveBeenCalledTimes(2);
  });
});
