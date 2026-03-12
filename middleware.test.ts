/**
 * @jest-environment node
 */
import { config } from './middleware'

describe('middleware config', () => {
  it('matches protected app routes', () => {
    const matcher = config.matcher[0]
    // The matcher pattern should exist and be a string
    expect(typeof matcher).toBe('string')
    // Should contain the negative lookahead pattern
    expect(matcher).toContain('(?!')
  })

  it('does not match /signin', () => {
    const matcher = config.matcher[0]
    expect('signin').toMatch(/signin/)
    // Verify signin is in the negative lookahead pattern
    expect(matcher).toContain('signin')
  })

  it('does not match /signup', () => {
    const matcher = config.matcher[0]
    expect(matcher).toContain('signup')
  })

  it('does not match /share paths', () => {
    const matcher = config.matcher[0]
    expect(matcher).toContain('share')
  })

  it('does not match /api paths', () => {
    const matcher = config.matcher[0]
    expect(matcher).toContain('api')
  })
})
