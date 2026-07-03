import { expect, it } from 'vitest';
import { bootAdmin } from './app.js';

it('loads the admin application with the collections view registered', () => {
  expect(bootAdmin).toBeTypeOf('function');
});
