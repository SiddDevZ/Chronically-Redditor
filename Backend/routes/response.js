import { Hono } from 'hono'
import { rateLimiter } from 'hono-rate-limiter'
import Roast from '../models/Roast.js'
import { fetchRedditComments, fetchUserProfile } from '../services/redditApi.js'

const router = new Hono()

const limiter = rateLimiter({
  windowMs: 40 * 60 * 1000,
  limit: 20, 
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (c) => c.req.header('x-forwarded-for') || c.req.ip,
})

async function getGeminiResponse(prompt, retryCount = 0, useProModel = false) {
  const API_KEYS = process.env.API_KEYS 
    ? process.env.API_KEYS.split(',').map(key => key.trim()).filter(Boolean)
    : []
  
  if (API_KEYS.length === 0) {
    throw new Error('No API keys configured. Please set API_KEYS environment variable.')
  }
  
  const shuffledKeys = [...API_KEYS].sort(() => Math.random() - 0.5)
  
  const payload = {
    contents: [
      {
        parts: [
          {
            text: prompt
          }
        ]
      }
    ]
  }
  
  const headers = {
    "Content-Type": "application/json"
  }
  
  const modelName = useProModel ? "gemini-2.5-pro" : "gemini-2.5-flash"
  
  for (let i = 0; i < shuffledKeys.length; i++) {
    const apiKey = shuffledKeys[i]
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
      })
      
      if (response.ok) {
        const result = await response.json()
        return result.candidates[0].content.parts[0].text
      } else {
        console.error(`API Key ${i + 1} failed with status:`, response.status)
        if (i === shuffledKeys.length - 1) {
          throw new Error(`All API keys failed. Last error: ${response.status}`)
        }
      }
    } catch (error) {
      console.error(`Error with API Key ${i + 1}:`, error.message)
      if (i === shuffledKeys.length - 1) {
        throw error
      }
    }
  }
}

function extractSubreddits(comments) {
  const subredditCounts = {}
  
  comments.forEach(comment => {
    if (comment.permalink) {
      const subreddit = comment.permalink.split('/')[0]
      if (subreddit) {
        subredditCounts[subreddit] = (subredditCounts[subreddit] || 0) + 1
      }
    }
  })
  
  const subredditArray = Object.entries(subredditCounts)
    .map(([name, count]) => ({
      name,
      count,
      percentage: Math.round((count / comments.length) * 100)
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
  
  return subredditArray.map(({ name, percentage }) => ({ name, percentage }))
}

async function generateRoastQuestions(comments, username) {
  const recentComments = comments.slice(0, 150); // Keep limited for questions
  const roastPrompt = `Based on the Reddit posts and comments below, generate exactly two playful or sarcastic yes/no questions about this person's behavior, habits, or interests.

Each question must feel like something a roasting friend would casually ask, witty, slightly judgmental, a bit sarcastic, but still fun. Use really basic english to make them understand, Gen Z energy, but don't overdo it. Think teasing, not trying too hard.

The questions should clearly relate to patterns in how they post or behave. This could include their posting style, subreddit choices, recurring phrases, obsessions, contradictions, or anything they clearly do way too often without realizing it.

Return the result as a JSON array of two objects with exactly these keys:
- question: the question text
- yes_response: the response if the user answers "yes"  
- no_response: the response if the user answers "no"

Example structure (match this format EXACTLY, not even a single character more or less nothing else other than values in it, don't even add the \`\`\`json and \`\`\` at the start and end):
[
{
"question": "",
"yes_response": "",
"no_response": ""
},
{
"question": "",
"yes_response": "",
"no_response": ""
}
]

Here's the Reddit activity to analyze:
${JSON.stringify(recentComments)}

Generate the JSON response:`

  try {
    const response = await getGeminiResponse(roastPrompt)

    await Roast.findOneAndUpdate(
      { username },
      { questions: response },
      { upsert: true, new: true }
    )
    
    return response
  } catch (error) {
    console.error('Error generating roast questions:', error)
    throw error
  }
}

async function generateCombinedRoast(comments, username) {
    const combinedRoastPrompt = `
You are an AI assistant. Your task is to analyze the user's Reddit activity provided below and generate a multi-part roast.
Your response MUST be a single, well-formed JSON object and nothing else. Do not include any text, markdown, or formatting outside of the JSON object. It is critical that all property names (keys) are enclosed in double quotes.

The JSON object must have the following keys: "detailedRoast", "strengthAnalysis", "weaknessAnalysis", "loveLifeAnalysis", "lifePurposeAnalysis".

**Reddit Activity to Analyze:**
\`\`\`json
${JSON.stringify(comments)}
\`\`\`

Now, generate the content for each key in the JSON object by following these individual prompts EXACTLY as described.

1. "detailedRoast"
PROMPT:
Based on the Reddit posts and comments above, write a long-form roast of this person.
Be witty, sarcastic, slightly unhinged, and observant. This should feel like a friend who has spent way too much time scrolling their profile and now can't unsee the patterns.

Roast their posting habits, tone, subreddit choices, obsessions, contradictions, energy, coping mechanisms, and the way they clearly use Reddit as therapy but pretend they don't.
You're allowed to exaggerate, speculate, and creatively connect dots, as long as it feels emotionally accurate.

Use Gen Z / internet slang where it fits. Grammar can be loose.
No formal language. No safe corporate tone.
Sharp, clever, chaotic, but not cruel.
Strictly around 400 words.

2. "strengthAnalysis"
PROMPT:
Now roast them lovingly.
Call out their strengths in a way that sounds sarcastic but is actually respect.
If they're smart, oddly insightful, helpful, resilient, funny, self-aware, or quietly competent, highlight it — but do it like someone who's impressed but refuses to say it normally.

If they operate on sleep deprivation but still make sense, say it.
If they're mentally messy but effective, say it.
If they give good advice while clearly being a little unhinged, say it.

Casual tone. Minimal grammar. Human voice.
Borderline feral admiration.
Strictly around 150 words.

3. "weaknessAnalysis"
PROMPT:
Time to call them out.
Identify their weak spots based on how they post and interact.
Oversharing, doomscrolling, arguing with strangers, validation seeking, spiraling, pretending not to care while clearly caring — whatever shows up, drag it into the light.

This should feel like a friend saying “be so serious right now” while still caring.
Funny, spicy, honest.
Not just insults — actual insight wrapped in jokes.
Loose grammar, TikTok brain energy allowed.
Strictly around 150 words.

4. "loveLifeAnalysis"
PROMPT:
Make funny, dark, or suspicious guesses about their love life based on their Reddit behavior.
Maybe they overthink texts. Maybe they avoid attachment. Maybe they flirt like an NPC. Maybe they have lore.

Be entertaining and a little uncomfortably accurate.
Speculate, exaggerate, joke — but also sneak in insight about how they probably act in relationships or what they actually want.

Casual, chaotic tone. No formal analysis.
Strictly around 150 words.

5. "lifePurposeAnalysis"
PROMPT:
Based on everything above, guess what actually drives this person.
What keeps them posting? What are they subconsciously chasing?
Validation? Understanding? Control? Peace? Chaos? A villain arc?

Be creative. Be sarcastic. Be slightly philosophical but not corny.
This should read like a bored but perceptive friend guessing their destiny at 2am.
Raw, funny, a little unhinged, but meaningful.
Strictly around 150 words.

**Universal Rule:**
For all generated text values in the JSON object: DO NOT USE ANY MARKDOWN FORMATTING. This means no asterisks, no bolding, no italics, no headers, and no bullet points. All responses must be plain text. Sometimes the context won't be fully visible from the comment so you can make things up, but don't just assume anything based off just one (sometimes people say things that need more context or in a fun way, or they might be trolling), use really basic english, You are allowed to use swear words but not directly towards the user. Start directly with the roast DO NOT write any intro like "Alright", "Okay", or "Here's the roast" etc. Do not refer to the user by any name or even as user, It should be like a friend talking to another friend. Your goal should be to roast them but not make them feel bad. DO NOT WRITE ANY INTRO GET STARTED DIRECTLY WITH THE ROAST IN EACH.
`;

    try {
        // Use the flash model (gemini-2.5-flash)
        const response = await getGeminiResponse(combinedRoastPrompt);
        
        if (!response) {
            throw new Error("No response received from AI.");
        }
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("No valid JSON object found in the AI response.");
        }
        const jsonString = jsonMatch[0];
        const parsedResponse = JSON.parse(jsonString);

        await Roast.findOneAndUpdate(
            { username },
            { 
                roast: parsedResponse.detailedRoast,
                strength: parsedResponse.strengthAnalysis,
                weakness: parsedResponse.weaknessAnalysis,
                loveLife: parsedResponse.loveLifeAnalysis,
                lifePurpose: parsedResponse.lifePurposeAnalysis,
            },
            { upsert: true, new: true }
        );
    
        return parsedResponse;
    } catch (error) {
        console.error('Error generating combined roast:', error);
        throw error;
    }
}

router.post('/', limiter, async (c) => {
  try {
    const { username } = await c.req.json()

    if (!username || !username.trim()) {
      return c.json({
        success: false,
        message: 'Username is required'
      }, 400)
    }

    const cleanUsername = username.trim().startsWith('u/') ? username.trim().slice(2) : username.trim()

    try {
      const existingUser = await Roast.findOne({ 
        username: { $regex: new RegExp(`^${cleanUsername}$`, 'i') }
      });

      if (existingUser) {
        return c.json({
          success: true,
          redirect: true,
          username: existingUser.username,
          message: 'User already exists in database'
        }, 200)
      }

      const userProfile = await fetchUserProfile(cleanUsername);
      const comments = await fetchRedditComments(cleanUsername, 500);

      if (comments.length === 0) {
        return c.json({
          success: false,
          message: 'No comments found for this user'
        }, 404)
      }

      const subreddits = extractSubreddits(comments)

      try {
        await Roast.findOneAndUpdate(
          { username: cleanUsername },
          { 
            username: cleanUsername,
            avatar: userProfile.avatar,
            subreddits: subreddits,
            updatedAt: new Date()
          },
          { 
            upsert: true,
            new: true 
          }
        )
      } catch (dbError) {
        console.error('Error updating basic data in MongoDB:', dbError)
      }

      try {

        generateCombinedRoast(comments, cleanUsername).catch(error => {
          console.error('Background roast generation failed:', error);
        });
        
        await generateRoastQuestions(comments, cleanUsername);

        return c.json({
          success: true,
          redirect: false,
          message: 'Questions generated successfully, roast analysis generating in background',
        }, 200);

      } catch (questionsError) {
        console.error('Error generating questions:', questionsError);
        return c.json({
          success: false,
          message: 'Failed to generate roast questions',
          error: questionsError.message
        }, 500);
      }

    } catch (redditError) {
      console.error('Reddit fetch error:', redditError)
      
      return c.json({
        success: false,
        message: redditError.message || 'Failed to fetch Reddit data'
      }, 404)
    }
    
  } catch (error) {
    console.error('Error in roast generation:', error)
    return c.json({
      success: false,
      message: 'Failed to process roast request',
      error: error.message
    }, 500)
  }
})

export default router