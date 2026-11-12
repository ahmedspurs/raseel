import { createReadStream } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/amr': '.amr',
  'audio/webm': '.webm',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
}

export function extensionFor(mime: string | null, filename?: string | null): string {
  const fromName = filename ? path.extname(filename).toLowerCase() : ''
  if (/^\.[a-z0-9]{1,8}$/.test(fromName)) return fromName
  const base = mime?.split(';')[0]?.trim().toLowerCase() ?? ''
  return EXTENSIONS[base] ?? '.bin'
}

/** Stores media files on the local volume (data stays on the server, SRS §5.1). */
export class MediaStorage {
  private readonly root: string

  constructor(root: string) {
    this.root = path.resolve(root)
  }

  /** Saves a file and returns its path relative to the media root. */
  async save(id: string, data: Uint8Array, mime: string | null, filename?: string | null) {
    const now = new Date()
    const dir = path.join(
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
    )
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '')
    const relative = path.join(dir, `${safeId}${extensionFor(mime, filename)}`)
    await mkdir(path.join(this.root, dir), { recursive: true })
    await writeFile(path.join(this.root, relative), data)
    return relative
  }

  /** Resolves a stored path, refusing anything outside the media root. */
  resolve(relative: string): string {
    const full = path.resolve(this.root, relative)
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid media path')
    return full
  }

  async open(relative: string) {
    const full = this.resolve(relative)
    const info = await stat(full)
    return { stream: createReadStream(full), size: info.size }
  }

  /** Deletes stored files; missing files are ignored. */
  async removeMany(relativePaths: string[]): Promise<void> {
    await Promise.all(
      relativePaths.map((p) => rm(this.resolve(p), { force: true }).catch(() => undefined)),
    )
  }
}
