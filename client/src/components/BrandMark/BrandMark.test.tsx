import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandMark } from './BrandMark';

describe('BrandMark', () => {
  it('renders the product name', () => {
    render(<BrandMark />);
    expect(screen.getByText('Sentinel')).toBeInTheDocument();
  });

  it('renders regardless of variant', () => {
    render(<BrandMark variant="default" />);
    expect(screen.getByText('Sentinel')).toBeInTheDocument();
  });
});
