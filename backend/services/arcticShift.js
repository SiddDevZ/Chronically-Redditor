const DEFAULT_BASE_URL = 'https://arctic-shift.photon-reddit.com';
const DEFAULT_AVATAR = 'https://www.redditstatic.com/avatars/avatar_default_01_FF4500.png';

function getBaseUrl() {
  return (process.env.ARCTIC_SHIFT_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

async function fetchJsonWithRetry(url, { retries = 1, timeoutMs = 3000 } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let retryable = true;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'web:reddit-profile-roaster:v1.0.1 (by /u/Sidharth-09)',
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.ok) {
        return await response.json();
      }

      lastError = new Error(`Arctic Shift request failed: ${response.status}`);
      retryable = response.status === 429 || response.status >= 500;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      retryable = true;
    }

    if (!retryable || attempt >= retries) {
      throw lastError;
    }

    const backoffMs = 300 * Math.pow(2, attempt);
    await new Promise(resolve => setTimeout(resolve, backoffMs));
  }

  throw lastError || new Error('Arctic Shift request failed');
}

function isUsableComment(raw) {
  return Boolean(
    raw &&
    typeof raw.body === 'string' &&
    raw.body !== '[deleted]' &&
    raw.body !== '[removed]' &&
    raw.body.trim() !== ''
  );
}

function normalizeComment(raw) {
  let extractedPath = raw.permalink || '';
  try {
    const permalink = raw.permalink
      ? (raw.permalink.startsWith('http') ? raw.permalink : `https://reddit.com${raw.permalink}`)
      : '';
    const match = permalink.match(/\/r\/([^\/]+\/comments\/[^\/]+\/[^\/]+)\//);
    extractedPath = match ? match[1] : (raw.permalink || '');
  } catch (error) {
    extractedPath = raw.permalink || '';
  }

  const subreddit = raw.subreddit_name_prefixed
    || (raw.subreddit ? `r/${raw.subreddit}` : undefined);

  return {
    body: raw.body,
    upvotes: typeof raw.score === 'number' ? raw.score : 0,
    permalink: extractedPath,
    subreddit,
    created_utc: raw.created_utc,
    author_icon_img: raw.profile_img || raw.author_icon_img || null,
  };
}

function dedupeComments(comments, maxComments) {
  const seen = new Set();
  const result = [];

  for (const comment of comments) {
    if (result.length >= maxComments) break;
    if (seen.has(comment.body)) continue;
    seen.add(comment.body);
    result.push(comment);
  }

  return result;
}

async function fetchArcticComments(username, maxComments = 500) {
  const baseUrl = getBaseUrl();
  const comments = [];
  const seenBodies = new Set();
  let before = null;
  let attempts = 0;
  const maxAttempts = 12;
  const pageLimit = 100;

  while (attempts < maxAttempts && comments.length < maxComments) {
    attempts++;

    const params = new URLSearchParams({
      author: username,
      limit: String(pageLimit),
      sort: 'desc',
    });
    if (before) {
      params.set('before', String(before));
    }

    const url = `${baseUrl}/api/comments/search?${params.toString()}`;
    const data = await fetchJsonWithRetry(url);
    const items = Array.isArray(data?.data) ? data.data : [];

    if (items.length === 0) {
      break;
    }

    for (const raw of items) {
      if (comments.length >= maxComments) break;
      if (!isUsableComment(raw)) continue;

      const comment = normalizeComment(raw);
      if (seenBodies.has(comment.body)) continue;

      seenBodies.add(comment.body);
      comments.push(comment);
    }

    const last = items[items.length - 1];
    const nextBefore = last?.created_utc;

    if (!nextBefore || nextBefore === before) {
      break;
    }
    before = nextBefore;

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return comments;
}

async function fetchArcticProfile(username, comments = []) {
  const baseUrl = getBaseUrl();
  let profile = null;

  try {
    const params = new URLSearchParams({ author: username, limit: '5' });
    const data = await fetchJsonWithRetry(`${baseUrl}/api/users/search?${params.toString()}`);
    const matches = Array.isArray(data?.data) ? data.data : [];
    const user = matches.find(u => (u.author || u.name || '').toLowerCase() === username.toLowerCase()) || matches[0];

    if (user) {
      profile = {
        name: `u/${user.author || user.name || username}`,
        avatar: null,
        created_utc: user._meta?.earliest_comment_at || user._meta?.earliest_post_at || null,
        comment_karma: user._meta?.comment_karma ?? user.comment_karma ?? null,
        link_karma: user._meta?.post_karma ?? user.link_karma ?? null,
      };
    }
  } catch (error) {
    profile = null;
  }

  if (!profile) {
    profile = {
      name: `u/${username}`,
      avatar: null,
      created_utc: null,
      comment_karma: null,
      link_karma: null,
    };
  }

  if (!profile.avatar) {
    const commentAvatar = comments.find(c => c.author_icon_img)?.author_icon_img;
    profile.avatar = commentAvatar || DEFAULT_AVATAR;
  }

  if (profile.avatar && !profile.avatar.includes('i.redd.it') && !profile.avatar.includes('redditstatic.com') && !profile.avatar.includes('redditmedia.com')) {
    profile.avatar = DEFAULT_AVATAR;
  }

  return profile;
}

export {
  fetchArcticComments,
  fetchArcticProfile,
  normalizeComment,
  isUsableComment,
  dedupeComments,
  fetchJsonWithRetry,
  getBaseUrl,
};
