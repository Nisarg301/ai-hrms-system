import { describe, expect, it } from 'vitest';
import { antdTheme } from './antdTheme';
import { tokens } from './tokens';

describe('antdTheme', () => {
  it('uses the brand primary color as the AntD primary token', () => {
    expect(antdTheme.token?.colorPrimary).toBe(tokens.colorPrimary);
  });

  it('uses the brand layout background color', () => {
    expect(antdTheme.token?.colorBgLayout).toBe(tokens.colorBgLayout);
  });

  it('uses the brand border color', () => {
    expect(antdTheme.token?.colorBorder).toBe(tokens.colorBorder);
  });
});
