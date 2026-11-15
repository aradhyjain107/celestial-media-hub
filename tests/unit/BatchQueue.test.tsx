import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { BatchQueue } from '../../app/components/BatchQueue';

describe('BatchQueue', () => {
  test('renders empty state correctly', () => {
    render(<BatchQueue items={[]} />);
    expect(screen.getByTestId('batch-queue-empty')).toBeInTheDocument();
    expect(screen.getByText('QUEUE EMPTY')).toBeInTheDocument();
  });

  test('renders queue items with formatted sizes and badges', () => {
    const items = [
      { id: '1', filename: 'video1.mp4', sizeBytes: 1024 * 1024 * 5, status: 'processing' as any, progress: 45 },
      { id: '2', filename: 'audio.wav', sizeBytes: 500, status: 'pending' as any, progress: 0 }
    ];
    
    render(<BatchQueue items={items} />);
    
    expect(screen.getByTitle('video1.mp4')).toHaveTextContent('video1.mp4');
    expect(screen.getByText('5 MB')).toBeInTheDocument();
    expect(screen.getByText('45%')).toBeInTheDocument();
    expect(screen.getByTestId('badge-processing')).toBeInTheDocument();

    expect(screen.getByTitle('audio.wav')).toHaveTextContent('audio.wav');
    expect(screen.getByText('500 B')).toBeInTheDocument();
    expect(screen.getByTestId('badge-pending')).toBeInTheDocument();
  });
});
