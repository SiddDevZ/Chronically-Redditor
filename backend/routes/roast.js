import { Hono } from 'hono'
import Roast from '../models/Roast.js'

const router = new Hono()
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

router.get('/:username', async (c) => {
  const { username } = c.req.param()
  try {
    const roast = await Roast.findOne({
      username: { $regex: new RegExp(`^${escapeRegExp(username)}$`, 'i') },
    })

    if (!roast) {
      return c.json({ success: false, message: 'Roast not found' }, 404)
    }

    if (roast.questions && !roast.questionsSeen) {
      return c.json({
        success: true,
        type: 'questions',
        data: {
          questions: roast.questions,
          username: roast.username,
          avatar: roast.avatar,
        },
      })
    }

    return c.json({
      success: true,
      type: 'summaries',
      data: {
        username: roast.username,
        avatar: roast.avatar,
        subreddits: roast.subreddits,
        aiSummaries: {
          detailedRoast: roast.roast,
          strengthAnalysis: roast.strength,
          weaknessAnalysis: roast.weakness,
          loveLifeAnalysis: roast.loveLife,
          lifePurposeAnalysis: roast.lifePurpose,
        },
      },
    })
  } catch (error) {
    console.error('Error fetching roast data:', error)
    return c.json({ success: false, message: 'Server error' }, 500)
  }
})

router.post('/:username/seen', async (c) => {
  const { username } = c.req.param()
  try {
    const roast = await Roast.findOneAndUpdate(
      { username: { $regex: new RegExp(`^${escapeRegExp(username)}$`, 'i') } },
      { questionsSeen: true },
      { new: true }
    )

    if (!roast) {
      return c.json({ success: false, message: 'Roast not found' }, 404)
    }

    return c.json({ success: true, message: 'Questions marked as seen.' })
  } catch (error) {
    console.error('Error marking questions as seen:', error)
    return c.json({ success: false, message: 'Server error' }, 500)
  }
})

export default router
