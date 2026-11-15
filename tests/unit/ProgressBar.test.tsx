import { render, screen, act } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ProgressBar } from '../../src/app/components/ui/ProgressBar';

describe('ProgressBar', () => {
  test('renders manual progress and queue count', () => {
    render(<ProgressBar manualProgress={45} queueCount={3} />);
    expect(screen.getByTestId('queue-status').textContent).toBe('QUEUE: 3 FILES');
    expect(screen.getByTestId('progress-text').textContent).toBe('45');
    expect(screen.getByTestId('progress-fill')).toHaveAttribute('value', '45');
  });

  test('connects to SSE and updates progress state', () => {
    let messageCallback: any = null;
    const mockConstructorCall = vi.fn();

    class MockEventSource {
      url: string;
      close: any;
      set onmessage(cb: any) { messageCallback = cb; }
      constructor(url: string) {
        this.url = url;
        this.close = vi.fn();
        mockConstructorCall(url);
      }
    }
    vi.stubGlobal('EventSource', MockEventSource);

    render(<ProgressBar sseUrl="/api/progress/123" queueCount={1} />);
    
    expect(mockConstructorCall).toHaveBeenCalledWith('/api/progress/123');
    
    act(() => {
      messageCallback({ data: JSON.stringify({ progress: 85 }) });
    });
    
    expect(screen.getByTestId('progress-text').textContent).toBe('85');
    
    vi.unstubAllGlobals();
  });
});
