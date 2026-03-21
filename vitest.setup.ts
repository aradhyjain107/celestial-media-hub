import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'

// Reset MockEventSource.instances before each test so instances[0] always
// refers to the EventSource created during the current test, not a stale one.
beforeEach(() => {
  const ES = (globalThis as any).EventSource
  if (ES && Array.isArray(ES.instances)) {
    ES.instances.length = 0
  }
})
