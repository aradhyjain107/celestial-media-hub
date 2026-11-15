import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { StatusBadge } from '../../src/app/components/ui/StatusBadge';

describe('StatusBadge', () => {
  test('renders all enum variants correctly with explicit tests', () => {
    const { rerender } = render(<StatusBadge status="pending" />);
    expect(screen.getByTestId('badge-pending').textContent).toBe('PENDING');
    
    rerender(<StatusBadge status="processing" />);
    expect(screen.getByTestId('badge-processing').textContent).toBe('PROCESSING');

    rerender(<StatusBadge status="done" />);
    expect(screen.getByTestId('badge-done').textContent).toBe('DONE');

    rerender(<StatusBadge status="error" />);
    expect(screen.getByTestId('badge-error').textContent).toBe('ERROR');
  });
});
