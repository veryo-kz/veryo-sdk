import { beforeEach, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (k: string) => store.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void store.set(k, v)),
}))
vi.mock('expo-device', () => ({ modelName: 'iPhone 17', osVersion: '26.1' }))
vi.mock('expo-application', () => ({ nativeApplicationVersion: '1.2.3' }))
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))

beforeEach(() => {
  store.clear()
  vi.resetModules()
})

it('generates device_id once and persists it', async () => {
  const { getSignals } = await import('../src/index')
  const [a, b] = await Promise.all([getSignals(), getSignals()])
  expect(a).toEqual({
    device_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    device_platform: 'ios',
    device_model: 'iPhone 17',
    os_version: '26.1',
    app_version: '1.2.3',
  })
  expect(b.device_id).toBe(a.device_id)
  expect(store.get('veryo.device_id')).toBe(a.device_id)

  vi.resetModules() // app restart: id comes back from SecureStore
  const again = await (await import('../src/index')).getSignals()
  expect(again.device_id).toBe(a.device_id)
})
