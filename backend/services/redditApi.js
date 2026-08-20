import { fetchArcticComments, fetchArcticProfile } from './arcticShift.js';

const REDDIT_OAUTH_URL = 'https://oauth.reddit.com';
const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';

const credentials = [
  {
    id: process.env.REDDIT_CLIENT_ID,
    secret: process.env.REDDIT_CLIENT_SECRET,
    accessToken: null,
    tokenExpiry: null,
  },
  {
    id: process.env.REDDIT_CLIENT_ID2,
    secret: process.env.REDDIT_CLIENT_SECRET2,
    accessToken: null,
    tokenExpiry: null,
  },
].filter(cred => cred.id && cred.secret);



if (credentials.length === 0) {
    console.error("CRITICAL: Reddit client ID or secret is not defined in .env file.");
}

async function getAccessToken(keyIndex = 0) {
  const creds = credentials[keyIndex];

  if (creds.accessToken && creds.tokenExpiry && Date.now() < creds.tokenExpiry) {
    return creds.accessToken;
  }

  const clientId = creds.id;
  const clientSecret = creds.secret;
  
  if (!clientId || !clientSecret) {
    console.error("CRITICAL: Reddit client ID or secret is not defined in .env file.");
    throw new Error('Reddit client credentials not found in environment variables');
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  try {
    const response = await fetch(REDDIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'web:reddit-profile-roaster:v1.0.1 (by /u/Sidharth-09)'
      },
      body: 'grant_type=client_credentials'
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Reddit OAuth Error:', `Status: ${response.status}`, `Body: ${errorText}`);
      throw new Error(`OAuth authentication failed: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.access_token) {
      throw new Error('No access token received from Reddit. Check your credentials and app type.');
    }
    
    creds.accessToken = data.access_token;
    creds.tokenExpiry = Date.now() + ((data.expires_in - 300) * 1000);
    
    // console.log('Successfully authenticated with Reddit OAuth API.');
    return creds.accessToken;
  } catch (error) {
    console.error('Failed to get Reddit access token:', error);
    throw new Error(`Reddit OAuth authentication failed: ${error.message}`);
  }
}

async function makeRedditRequest(endpoint, keyIndex = 0) {
  if (keyIndex >= credentials.length) {
    throw new Error('All available Reddit API keys are rate limited.');
  }

  const token = await getAccessToken(keyIndex);
  
  const response = await fetch(`${REDDIT_OAUTH_URL}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'web:reddit-profile-roaster:v1.0.1 (by /u/Sidharth-09)'
    }
  });

  if (!response.ok) {
    if (response.status === 401) {
      console.log(`Token for key ${keyIndex} may be expired, forcing refresh...`);
      credentials[keyIndex].accessToken = null;
      credentials[keyIndex].tokenExpiry = null;
      
      const newToken = await getAccessToken(keyIndex);
      const retryResponse = await fetch(`${REDDIT_OAUTH_URL}${endpoint}`, {
        headers: {
          'Authorization': `Bearer ${newToken}`,
          'User-Agent': 'web:reddit-profile-roaster:v1.0.1 (by /u/Sidharth-09)'
        }
      });
      
      if (!retryResponse.ok) {
        throw new Error(`Reddit API error after token refresh: ${retryResponse.status}`);
      }
      return retryResponse.json();
    }
    
    if (response.status === 429) {
        console.warn(`Rate limit exceeded on keyIndex ${keyIndex}.`);
        if (keyIndex + 1 < credentials.length) {
            console.log(`Switching to keyIndex ${keyIndex + 1}.`);
            return makeRedditRequest(endpoint, keyIndex + 1);
        } else {
            throw new Error('Rate limit exceeded on all available keys. Please try again later.');
        }
    }
    if (response.status === 404) {
      throw new Error('User not found');
    }
    if (response.status === 403) {
      throw new Error('User profile is private or suspended');
    }
    throw new Error(`Reddit API error: ${response.status}`);
  }

  return response.json();
}

function shouldFallbackToArchive(error) {
  const errors = [error, error?.cause].filter(Boolean);
  return errors.some(current => {
    const message = (current.message || '').toLowerCase();
    return (
      message.includes('user not found') ||
      message.includes('no comments found') ||
      message.includes('private or suspended') ||
      message.includes('rate limited') ||
      message.includes('rate limit exceeded') ||
      message.includes('credentials not found') ||
      message.includes('oauth authentication failed') ||
      message.includes('reddit api error') ||
      current instanceof TypeError ||
      current.name === 'AbortError'
    );
  });
}

async function fetchRedditCommentsDirect(username, maxComments = 500) {
  try {
    const comments = [];
    let after = null;
    let attempts = 0;
    const maxAttempts = 12;

    while (attempts < maxAttempts && comments.length < maxComments) {
      attempts++;
      
      let endpoint = `/user/${username}/comments?limit=100&raw_json=1&sort=new`;
      if (after) {
        endpoint += `&after=${after}`;
      }

      const data = await makeRedditRequest(endpoint);

      if (!data || !data.data || !data.data.children || !Array.isArray(data.data.children)) {
        if (attempts === 1 && comments.length === 0) {
          throw new Error('User not found or no comments available');
        }
        break;
      }

      const children = data.data.children;
      
      if (children.length === 0) {
        break;
      }

      let newCommentsCount = 0;
      for (const item of children) {
        if (comments.length >= maxComments) break;
        
        const commentData = item.data;
        if (commentData.body && 
            commentData.body !== '[deleted]' && 
            commentData.body !== '[removed]' &&
            commentData.body.trim() !== '') {
          
          const isDuplicate = comments.some(c => c.body === commentData.body);
          if (!isDuplicate) {
            let extractedPath = '';
            try {
              const permalink = `https://reddit.com${commentData.permalink}`;
              const match = permalink.match(/\/r\/([^\/]+\/comments\/[^\/]+\/[^\/]+)\//);
              extractedPath = match ? match[1] : commentData.permalink;
            } catch (error) {
              extractedPath = commentData.permalink;
            }

            comments.push({
              body: commentData.body,
              upvotes: commentData.score,
              permalink: extractedPath,
              subreddit: commentData.subreddit_name_prefixed,
              created_utc: commentData.created_utc
            });
            newCommentsCount++;
          }
        }
      }

      const newAfter = data?.data?.after;
      if (!newAfter || newAfter === after || newCommentsCount === 0) {
        break;
      }
      after = newAfter;
      
    //   if (comments.length > 0 && comments.length % 100 === 0) {
        // console.log(`Fetched ${comments.length} comments for ${username}...`);
    //   }
      
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    if (comments.length === 0) {
      throw new Error('No comments found for this user');
    }

    // console.log(`Successfully fetched ${comments.length} comments for ${username}`);
    return comments;
  } catch (error) {
    console.error('Error fetching Reddit comments:', error);
    
    if (error.message.includes('User not found') || 
        error.message.includes('No comments found')) {
      throw error;
    }
    
    throw new Error('Failed to fetch user comments', { cause: error });
  }
}

async function fetchUserProfileDirect(username) {
  try {
    const endpoint = `/user/${username}/about?raw_json=1`;
    const data = await makeRedditRequest(endpoint);
    
    if (!data || !data.data) {
      throw new Error('User not found. Please try with a different username.');
    }

    const user = data.data;

    let avatar = null;
    if (user.subreddit && user.subreddit.icon_img) {
      avatar = user.subreddit.icon_img;
    } else if (user.subreddit && user.subreddit.community_icon) {
      avatar = user.subreddit.community_icon;
    } else if (user.icon_img) {
      avatar = user.icon_img;
    } else {
      avatar = 'https://www.redditstatic.com/avatars/avatar_default_01_FF4500.png';
    }

    if (avatar && !avatar.includes('i.redd.it') && !avatar.includes('redditstatic.com')) {
      avatar = 'https://www.redditstatic.com/avatars/avatar_default_01_FF4500.png';
    }

    return {
      name: user.subreddit ? (user.subreddit.display_name_prefixed || user.subreddit.display_name) : `u/${username}`,
      avatar: avatar,
      created_utc: user.created_utc,
      comment_karma: user.comment_karma,
      link_karma: user.link_karma
    };
  } catch (error) {
    console.error('Error fetching user profile:', error);
    
    if (error.message.includes('User not found')) {
      throw error;
    }
    
    throw new Error('Failed to fetch user profile', { cause: error });
  }
}

async function fetchRedditComments(username, maxComments = 500) {
  try {
    return await fetchRedditCommentsDirect(username, maxComments);
  } catch (error) {
    if (!shouldFallbackToArchive(error)) {
      throw error;
    }

    console.warn(`Falling back to Arctic Shift archive for comments of ${username}: ${error.message}`);

    try {
      const comments = await fetchArcticComments(username, maxComments);
      if (comments.length === 0) {
        throw new Error('User not found or no comments available');
      }
      return comments;
    } catch (arcticError) {
      console.error('Arctic Shift fallback failed for comments:', arcticError);
      if (arcticError.message.includes('User not found') || arcticError.message.includes('No comments')) {
        throw arcticError;
      }
      throw error;
    }
  }
}

async function fetchUserProfile(username) {
  try {
    return await fetchUserProfileDirect(username);
  } catch (error) {
    if (!shouldFallbackToArchive(error)) {
      throw error;
    }

    console.warn(`Falling back to Arctic Shift archive for profile of ${username}: ${error.message}`);

    try {
      let sampleComments = [];
      try {
        sampleComments = await fetchArcticComments(username, 25);
      } catch (sampleError) {
        sampleComments = [];
      }
      return await fetchArcticProfile(username, sampleComments);
    } catch (arcticError) {
      console.error('Arctic Shift fallback failed for profile:', arcticError);
      throw error;
    }
  }
}

export { fetchRedditComments, fetchUserProfile, shouldFallbackToArchive };
