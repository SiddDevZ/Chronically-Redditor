import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldFallbackToArchive } from '../services/redditApi.js';

test('shouldFallbackToArchive recognizes unavailable Reddit paths', () => {
  for (const message of [
    'User not found',
    'User profile is private or suspended',
    'Rate limit exceeded on all available keys',
    'Reddit OAuth authentication failed',
    'No comments found for this user',
  ]) {
    assert.equal(shouldFallbackToArchive(new Error(message)), true, message);
  }
  assert.equal(shouldFallbackToArchive(new Error('Failed to fetch user comments', { cause: new Error('OAuth authentication failed') })), true);
  assert.equal(shouldFallbackToArchive(new TypeError('fetch failed')), true);
});

test('shouldFallbackToArchive rejects unrelated application errors', () => {
  assert.equal(shouldFallbackToArchive(new Error('Invalid response payload')), false);
  assert.equal(shouldFallbackToArchive(new Error('Failed to fetch user comments')), false);
});
