import { describe, it, expect } from 'vitest';
import { escHtml } from './utils.js';

describe('escHtml', () => {
  it('escapes HTML-significant characters', () => {
    expect(escHtml('<script>"&"</script>')).toBe('&lt;script&gt;&quot;&amp;&quot;&lt;/script&gt;');
  });

  it('handles null and undefined as empty string', () => {
    expect(escHtml(null)).toBe('');
    expect(escHtml(undefined)).toBe('');
  });

  it('leaves plain text untouched', () => {
    expect(escHtml('Katie Monroe')).toBe('Katie Monroe');
  });
});
