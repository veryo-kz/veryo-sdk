import * as Application from 'expo-application'
import * as Device from 'expo-device'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

/** Matches `signals` of `@veryo/node`. Send it to YOUR backend, which adds `ip` and calls VERYO. */
export interface DeviceSignals {
  device_id: string
  device_platform: 'android' | 'ios' | 'web'
  device_model?: string
  os_version?: string
  app_version?: string
}

const KEY = 'veryo.device_id'
let deviceId: Promise<string> | undefined

/** Device signals for antifraud. `device_id` is a random UUID generated once and kept in SecureStore. */
export async function getSignals(): Promise<DeviceSignals> {
  deviceId ??= loadDeviceId()
  return {
    device_id: await deviceId,
    device_platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web',
    device_model: Device.modelName ?? undefined,
    os_version: Device.osVersion ?? undefined,
    app_version: Application.nativeApplicationVersion ?? undefined,
  }
}

async function loadDeviceId(): Promise<string> {
  try {
    const saved = await SecureStore.getItemAsync(KEY)
    if (saved) return saved
    const id = uuid()
    await SecureStore.setItemAsync(KEY, id)
    return id
  } catch {
    return uuid() // SecureStore unavailable (web): id lives until reload
  }
}

function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  // ponytail: Hermes has no crypto by default; Math.random is fine for an identifier, not for secrets
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 3) | 8).toString(16)
  })
}
