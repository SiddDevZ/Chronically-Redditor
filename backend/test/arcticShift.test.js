import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchArcticComments,
  fetchArcticProfile,
  normalizeComment,
  isUsableComment,
  dedupeComments,
  fetchJsonWithRetry,
} from '../services/arcticShift.js';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function withMockedFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test('isUsableComment filters deleted, removed and empty comments', () => {
  assert.equal(isUsableComment({ body: 'hello' }), true);
  assert.equal(isUsableComment({ body: '[deleted]' }), false);
  assert.equal(isUsableComment({ body: '[removed]' }), false);
  assert.equal(isUsableComment({ body: '   ' }), false);
  assert.equal(isUsableComment({ body: null }), false);
  assert.equal(isUsableComment(null), false);
});

test('normalizeComment maps raw archive comment to existing comment shape', () => {
  const raw = {
    body: 'this is a comment',
    score: 42,
    permalink: '/r/testsub/comments/abc123/some_title/def456/',
    subreddit: 'testsub',
    created_utc: 1700000000,
    profile_img: 'https://styles.redditmedia.com/avatar.png',
  };

  const normalized = normalizeComment(raw);

  assert.equal(normalized.body, 'this is a comment');
  assert.equal(normalized.upvotes, 42);
  assert.equal(normalized.subreddit, 'r/testsub');
  assert.equal(normalized.created_utc, 1700000000);
  assert.equal(normalized.permalink, 'testsub/comments/abc123/some_title');
  assert.equal(normalized.author_icon_img, 'https://styles.redditmedia.com/avatar.png');
});

test('dedupeComments removes duplicate bodies and respects the max limit', () => {
  const comments = [
    { body: 'a' },
    { body: 'b' },
    { body: 'a' },
    { body: 'c' },
  ];

  assert.deepEqual(dedupeComments(comments, 10).map(c => c.body), ['a', 'b', 'c']);
  assert.deepEqual(dedupeComments(comments, 2).map(c => c.body), ['a', 'b']);
});

test('fetchJsonWithRetry retries on failure then succeeds', async () => {
  let calls = 0;
  await withMockedFetch(async () => {
    calls++;
    if (calls < 3) {
      return jsonResponse({}, 503);
    }
    return jsonResponse({ ok: true });
  }, async () => {
    const result = await fetchJsonWithRetry('https://example.test/x', { retries: 3, timeoutMs: 100 });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 3);
  });
});

test('fetchJsonWithRetry throws after exhausting retries', async () => {
  let calls = 0;
  await withMockedFetch(async () => {
    calls++;
    return jsonResponse({}, 500);
  }, async () => {
    await assert.rejects(() => fetchJsonWithRetry('https://example.test/x', { retries: 2, timeoutMs: 50 }));
    assert.equal(calls, 3);
  });
});

test('fetchJsonWithRetry throws immediately on non-retryable status', async () => {
  let calls = 0;
  await withMockedFetch(async () => {
    calls++;
    return jsonResponse({}, 404);
  }, async () => {
    await assert.rejects(() => fetchJsonWithRetry('https://example.test/x', { retries: 3, timeoutMs: 50 }));
    assert.equal(calls, 1);
  });
});

test('fetchArcticComments paginates, normalizes, filters and deduplicates', async () => {
  const pageOne = {
    data: [
      { body: 'first comment', score: 1, permalink: '/r/a/comments/1/t/1/', subreddit: 'a', created_utc: 200 },
      { body: '[deleted]', score: 0, permalink: '/r/a/comments/2/t/2/', subreddit: 'a', created_utc: 190 },
      { body: 'first comment', score: 1, permalink: '/r/a/comments/1/t/1/', subreddit: 'a', created_utc: 200 },
    ],
  };
  const pageTwo = {
    data: [
      { body: 'second comment', score: 5, permalink: '/r/b/comments/3/t/3/', subreddit: 'b', created_utc: 100 },
    ],
  };
  const pageThree = { data: [] };

  let calls = 0;
  await withMockedFetch(async (url) => {
    calls++;
    assert.match(url, /author=someuser/);
    if (calls === 1) return jsonResponse(pageOne);
    if (calls === 2) return jsonResponse(pageTwo);
    return jsonResponse(pageThree);
  }, async () => {
    const comments = await fetchArcticComments('someuser', 10);
    assert.equal(comments.length, 2);
    assert.equal(comments[0].body, 'first comment');
    assert.equal(comments[1].body, 'second comment');
    assert.equal(calls, 3);
  });
});

test('fetchArcticComments stops at maxComments without extra requests', async () => {
  const page = {
    data: [
      { body: 'c1', score: 1, permalink: '/r/a/comments/1/t/1/', subreddit: 'a', created_utc: 300 },
      { body: 'c2', score: 1, permalink: '/r/a/comments/2/t/2/', subreddit: 'a', created_utc: 200 },
    ],
  };

  let calls = 0;
  await withMockedFetch(async () => {
    calls++;
    return jsonResponse(page);
  }, async () => {
    const comments = await fetchArcticComments('someuser', 1);
    assert.equal(comments.length, 1);
    assert.equal(calls, 1);
  });
});

test('fetchArcticProfile derives profile from user search results', async () => {
  await withMockedFetch(async (url) => {
    assert.match(url, /api\/users\/search/);
    return jsonResponse({
      data: [
        {
          author: 'someuser',
          _meta: {
            earliest_comment_at: 1000,
            comment_karma: 50,
            post_karma: 10,
          },
        },
      ],
    });
  }, async () => {
    const profile = await fetchArcticProfile('someuser', []);
    assert.equal(profile.name, 'u/someuser');
    assert.equal(profile.avatar, 'https://www.redditstatic.com/avatars/avatar_default_01_FF4500.png');
    assert.equal(profile.created_utc, 1000);
    assert.equal(profile.comment_karma, 50);
    assert.equal(profile.link_karma, 10);
  });
});

test('fetchArcticProfile falls back to comment avatar and default avatar', async () => {
  await withMockedFetch(async () => jsonResponse({ data: [] }), async () => {
    const withCommentAvatar = await fetchArcticProfile('nouser', [{ author_icon_img: 'https://i.redd.it/from-comment.png' }]);
    assert.equal(withCommentAvatar.avatar, 'https://i.redd.it/from-comment.png');

    const withoutAnyAvatar = await fetchArcticProfile('nouser', []);
    assert.equal(withoutAnyAvatar.avatar, 'https://www.redditstatic.com/avatars/avatar_default_01_FF4500.png');
  });
});

test('fetchArcticProfile never throws on network failure, returns default profile', async () => {
  await withMockedFetch(async () => {
    throw new TypeError('fetch failed');
  }, async () => {
    const profile = await fetchArcticProfile('unreachable', []);
    assert.equal(profile.name, 'u/unreachable');
    assert.equal(profile.avatar, 'https://www.redditstatic.com/avatars/avatar_default_01_FF4500.png');
  });
});
