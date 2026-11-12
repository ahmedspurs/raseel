import { execFileSync, spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { needsTranscode, toOggOpus, TranscodeError } from './transcode.js'

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0

describe('needsTranscode', () => {
  it('converts browser recordings but keeps WhatsApp formats', () => {
    expect(needsTranscode('audio/webm;codecs=opus')).toBe(true)
    expect(needsTranscode('audio/wav')).toBe(true)
    expect(needsTranscode('audio/ogg; codecs=opus')).toBe(false)
    expect(needsTranscode('audio/mp4')).toBe(false)
    expect(needsTranscode('image/png')).toBe(false)
  })
})

describe.skipIf(!hasFfmpeg)('toOggOpus', () => {
  it('turns a WebM/Opus recording into an OGG/Opus voice note', async () => {
    const webm = execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-c:a',
      'libopus',
      '-f',
      'webm',
      'pipe:1',
    ])
    const ogg = await toOggOpus(new Uint8Array(webm))
    expect(Buffer.from(ogg.subarray(0, 4)).toString()).toBe('OggS')
    expect(Buffer.from(ogg).includes(Buffer.from('OpusHead'))).toBe(true)
  })

  it('rejects data that is not audio', async () => {
    await expect(toOggOpus(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(TranscodeError)
  })
})
