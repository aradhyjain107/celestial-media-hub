import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import Dashboard from '../../app/page';

test('Dashboard renders 8 tool cards correctly mapped to routing paths', () => {
  render(<Dashboard />);
  
  expect(screen.getByText('SYSTEM // 01')).toBeInTheDocument();
  expect(screen.getByText('Dashboard')).toBeInTheDocument();

  expect(screen.getByText('02 //')).toBeInTheDocument();
  expect(screen.getByText('Video Muter')).toBeInTheDocument();

  expect(screen.getByText('07 //')).toBeInTheDocument();
  expect(screen.getByText('Spotify Converter')).toBeInTheDocument();

  expect(screen.getByText('08 //')).toBeInTheDocument();
  expect(screen.getByText('Media Inspector')).toBeInTheDocument();
});
