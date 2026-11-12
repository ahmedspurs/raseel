/**
 * Developer tools for trying Raseel without a Meta account.
 *
 *   pnpm --filter @raseel/api dev:mock-graph
 *     Starts a fake Graph API on :4010. Connect WhatsApp in Settings with:
 *       Phone Number ID 100000000000001 · WABA ID 200000000000001
 *       Access token  mock-access-token-for-local-development
 *       App secret    the value of MOCK_APP_SECRET below
 *     and run the API with WHATSAPP_GRAPH_URL=http://localhost:4010
 *
 *   pnpm --filter @raseel/api dev:simulate -- --from 966500000001 --name "سارة" --text "مرحبا"
 *   pnpm --filter @raseel/api dev:simulate -- --from 966500000001 --file ./photo.jpg --caption "صورة"
 *     Sends a signed inbound webhook to the local API as if a customer wrote.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { inboundPayload, textMessage } from '../whatsapp/fixtures.js'
import { signWebhookBody } from '../whatsapp/signature.js'
import { MockGraph } from './mock-graph.js'

const APP_SECRET = process.env.MOCK_APP_SECRET ?? '0123456789abcdef0123456789abcdef'
const API_URL = process.env.RASEEL_API_URL ?? 'http://localhost:4000'
const GRAPH_URL = process.env.MOCK_GRAPH_URL ?? 'http://localhost:4010'
const PHONE_NUMBER_ID = '100000000000001'

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
}

async function mockGraph() {
  const mock = new MockGraph({
    webhookUrl: `${API_URL}/webhooks/whatsapp`,
    appSecret: APP_SECRET,
    autoApproveTemplates: true,
  })
  const url = await mock.start(Number(process.env.PORT ?? 4010), '0.0.0.0')
  console.log(`Mock Graph API listening on ${url}`)
  console.log(`  Phone Number ID: ${mock.phoneNumberId}`)
  console.log(`  WABA ID:         ${mock.wabaId}`)
  console.log(`  Access token:    ${mock.accessToken}`)
  console.log(`  App secret:      ${APP_SECRET}`)
}

async function simulate(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      from: { type: 'string', default: '966500000001' },
      name: { type: 'string', default: 'Test Customer' },
      text: { type: 'string' },
      file: { type: 'string' },
      caption: { type: 'string' },
    },
  })
  const env = { phoneNumberId: PHONE_NUMBER_ID, from: values.from!, name: values.name }

  let message: Record<string, unknown> & { type: string }
  if (values.file) {
    const data = await readFile(values.file)
    const filename = path.basename(values.file)
    const mime = MIME_BY_EXT[path.extname(filename).toLowerCase()] ?? 'application/octet-stream'
    const form = new FormData()
    form.append('file', new Blob([data], { type: mime }), filename)
    const res = await fetch(`${GRAPH_URL}/__mock/media`, { method: 'POST', body: form })
    const { id } = (await res.json()) as { id: string }
    const kind = mime.startsWith('image/')
      ? 'image'
      : mime.startsWith('video/')
        ? 'video'
        : mime.startsWith('audio/')
          ? 'audio'
          : 'document'
    message = {
      type: kind,
      [kind]: {
        id,
        mime_type: mime,
        ...(kind === 'document' ? { filename } : {}),
        ...(values.caption && kind !== 'audio' ? { caption: values.caption } : {}),
        ...(kind === 'audio' ? { voice: true } : {}),
      },
    }
  } else {
    message = textMessage(values.text ?? 'السلام عليكم، عندي استفسار')
  }

  const raw = JSON.stringify(inboundPayload(env, message))
  const res = await fetch(`${API_URL}/webhooks/whatsapp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signWebhookBody(raw, APP_SECRET),
    },
    body: raw,
  })
  console.log(`Webhook → ${res.status} ${await res.text()}`)
}

const [command, ...rest] = process.argv.slice(2)
if (command === 'mock-graph') await mockGraph()
else if (command === 'simulate') await simulate(rest.filter((a) => a !== '--'))
else {
  console.error('Usage: cli.ts mock-graph | simulate [--from] [--name] [--text | --file --caption]')
  process.exit(1)
}
