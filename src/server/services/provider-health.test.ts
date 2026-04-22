import { describe, expect, test } from 'bun:test'
import { ProviderHealthService } from './provider-health'

describe('ProviderHealthService', () => {
  test('healthy status when testConnection succeeds', async () => {
    const service = new ProviderHealthService()
    const mockAdapter = {
      async testConnection() {
        return { connected: true, latencyMs: 42 }
      },
    }

    const result = await service.checkProvider('telephony', 'active', mockAdapter)
    expect(result.status).toBe('healthy')
    expect(result.latencyMs).toBe(42)
    expect(result.consecutiveFailures).toBe(0)
    expect(result.error).toBeUndefined()
    expect(result.provider).toBe('active')

    const status = service.getHealthStatus()
    expect(status.telephony).not.toBeNull()
    expect(status.telephony?.status).toBe('healthy')
  })

  test('degraded after first failure, down after 3 consecutive failures', async () => {
    const service = new ProviderHealthService()

    const healthyAdapter = {
      async testConnection() {
        return { connected: true, latencyMs: 10 }
      },
    }
    await service.checkProvider('telephony', 'active', healthyAdapter)

    const failingAdapter = {
      async testConnection() {
        return { connected: false, latencyMs: 0, error: 'timeout' }
      },
    }

    const r1 = await service.checkProvider('telephony', 'active', failingAdapter)
    expect(r1.status).toBe('degraded')
    expect(r1.consecutiveFailures).toBe(1)

    const r2 = await service.checkProvider('telephony', 'active', failingAdapter)
    expect(r2.status).toBe('degraded')
    expect(r2.consecutiveFailures).toBe(2)

    const r3 = await service.checkProvider('telephony', 'active', failingAdapter)
    expect(r3.status).toBe('down')
    expect(r3.consecutiveFailures).toBe(3)
    expect(r3.error).toBe('timeout')

    const status = service.getHealthStatus()
    expect(status.telephony?.status).toBe('down')
  })

  test('recovery from down to healthy resets failure count', async () => {
    const service = new ProviderHealthService()

    const failingAdapter = {
      async testConnection() {
        return { connected: false, latencyMs: 0, error: 'timeout' }
      },
    }
    for (let i = 0; i < 3; i++) {
      await service.checkProvider('telephony', 'active', failingAdapter)
    }
    expect(service.getHealthStatus().telephony?.status).toBe('down')

    const healthyAdapter = {
      async testConnection() {
        return { connected: true, latencyMs: 15 }
      },
    }
    const recovered = await service.checkProvider('telephony', 'active', healthyAdapter)
    expect(recovered.status).toBe('healthy')
    expect(recovered.consecutiveFailures).toBe(0)
    expect(recovered.latencyMs).toBe(15)
  })

  test('messaging channels tracked separately', async () => {
    const service = new ProviderHealthService()

    const smsAdapter = {
      async testConnection() {
        return { connected: true, latencyMs: 20 }
      },
    }
    const whatsappAdapter = {
      async testConnection() {
        return { connected: false, latencyMs: 0, error: 'not configured' }
      },
    }

    await service.checkProvider('messaging', 'sms', smsAdapter)
    await service.checkProvider('messaging', 'whatsapp', whatsappAdapter)

    const status = service.getHealthStatus()
    expect(status.messaging.sms.status).toBe('healthy')
    expect(status.messaging.whatsapp.status).toBe('degraded')
    expect(status.telephony).toBeNull()
  })

  test('start and stop control periodic checks', async () => {
    const service = new ProviderHealthService()

    let checkCount = 0
    const checkFn = async () => {
      checkCount++
    }

    service.start(checkFn, 50)
    await new Promise((r) => setTimeout(r, 120))
    expect(checkCount).toBeGreaterThanOrEqual(2)

    const countBefore = checkCount
    service.stop()

    await new Promise((r) => setTimeout(r, 100))
    expect(checkCount).toBeLessThanOrEqual(countBefore + 1)
  })
})
