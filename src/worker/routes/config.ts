import { Hono } from 'hono'
import type { AppEnv } from '../types'

const config = new Hono<AppEnv>()

config.get('/', (c) => {
  return c.json({
    hotlineName: c.env.HOTLINE_NAME || 'Hotline',
    hotlineNumber: c.env.TWILIO_PHONE_NUMBER || '',
  })
})

export default config
