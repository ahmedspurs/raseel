import { spawn } from 'node:child_process'

export class TranscodeError extends Error {}

/**
 * Browsers record voice notes as WebM/Opus (Chrome) or MP4/AAC (Safari), but WhatsApp
 * plays voice notes as OGG/Opus. Re-encode with ffmpeg: mono, 32 kb/s, speech-tuned.
 */
export function toOggOpus(input: Uint8Array, ffmpegPath = 'ffmpeg', timeoutMs = 30_000) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const ff = spawn(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-vn',
        '-ac',
        '1',
        '-c:a',
        'libopus',
        '-b:a',
        '32k',
        '-application',
        'voip',
        '-f',
        'ogg',
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )
    const out: Buffer[] = []
    const err: Buffer[] = []
    const timer = setTimeout(() => {
      ff.kill('SIGKILL')
      reject(new TranscodeError('Audio conversion timed out'))
    }, timeoutMs)

    ff.stdout.on('data', (c: Buffer) => out.push(c))
    ff.stderr.on('data', (c: Buffer) => err.push(c))
    ff.on('error', (e) => {
      clearTimeout(timer)
      reject(new TranscodeError(`ffmpeg is not available: ${e.message}`))
    })
    ff.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0 && out.length) resolve(new Uint8Array(Buffer.concat(out)))
      else
        reject(new TranscodeError(Buffer.concat(err).toString().trim() || `ffmpeg exited ${code}`))
    })
    ff.stdin.on('error', () => undefined)
    ff.stdin.end(Buffer.from(input))
  })
}

/** Audio WhatsApp accepts as-is; anything else is converted before sending. */
export const WHATSAPP_AUDIO = new Set([
  'audio/aac',
  'audio/amr',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
])

export function needsTranscode(mime: string): boolean {
  const base = mime.split(';')[0]!.trim().toLowerCase()
  return (base.startsWith('audio/') || base === 'video/webm') && !WHATSAPP_AUDIO.has(base)
}
