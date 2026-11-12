import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Cipher, maskSecret, parseKey, safeEqual } from './crypto.js'

describe('Cipher', () => {
  const cipher = new Cipher(randomBytes(32))

  it('round-trips unicode text', () => {
    const secret = 'EAAG-token-مرحبا-🔐'
    expect(cipher.decrypt(cipher.encrypt(secret))).toBe(secret)
  })

  it('uses a fresh IV per encryption', () => {
    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'))
  })

  it('rejects tampered ciphertext', () => {
    const parts = cipher.encrypt('secret').split(':')
    parts[3] = Buffer.from('tampered').toString('base64url')
    expect(() => cipher.decrypt(parts.join(':'))).toThrow()
  })

  it('cannot decrypt with another key', () => {
    const other = new Cipher(randomBytes(32))
    expect(() => other.decrypt(cipher.encrypt('secret'))).toThrow()
  })
})

describe('parseKey', () => {
  it('accepts base64 and hex 32-byte keys', () => {
    const key = randomBytes(32)
    expect(parseKey(key.toString('base64')).equals(key)).toBe(true)
    expect(parseKey(key.toString('hex')).equals(key)).toBe(true)
  })

  it('rejects short keys', () => {
    expect(() => parseKey('short')).toThrow()
  })
})

describe('helpers', () => {
  it('masks secrets', () => {
    expect(maskSecret('EAAGabcdef1234')).toBe('••••1234')
    expect(maskSecret('abc')).toBe('••••')
    expect(maskSecret(null)).toBeNull()
  })

  it('compares in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })
})
