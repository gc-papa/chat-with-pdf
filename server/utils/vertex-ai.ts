import { GoogleAuth } from 'google-auth-library'

const TEXT_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
const DEFAULT_CHAT_MODEL = 'gemini-1.5-flash-002'
const DEFAULT_EMBED_MODEL = 'text-embedding-004'

type VertexMessage = { role: string; parts: Array<{ text: string }> }

type RunOptions = {
  messages?: Array<{ role: string; content: any }>
  text?: string | string[]
  stream?: boolean
}

let cachedProject: string | null = null
let cachedAuthClient: Promise<any> | null = null

const textPart = (s: string): { text: string } => ({ text: s ?? '' })

const normalizeMessages = (messages: RunOptions['messages'] = []): VertexMessage[] =>
  (messages || []).map((message) => {
    const role =
      message.role === 'assistant'
        ? 'model'
        : message.role === 'system'
          ? 'system'
          : 'user'
    const parts: VertexMessage['parts'] = []

    if (Array.isArray(message.content)) {
      for (const c of message.content) {
        if (typeof c === 'string') parts.push(textPart(c))
        else if (typeof c?.text === 'string') parts.push(textPart(c.text))
        else if (c && typeof (c as any).content === 'string') parts.push(textPart((c as any).content))
      }
    }
    else if (typeof message.content === 'string') parts.push(textPart(message.content))
    else if (message.content?.text) parts.push(textPart(message.content.text))

    if (parts.length === 0) parts.push(textPart(''))

    return { role, parts }
  })

const normalizeText = (text: string | string[] | undefined): VertexMessage[] => {
  if (typeof text === 'undefined') return [{ role: 'user', parts: [textPart('')] }]
  const joined = Array.isArray(text) ? text.join('\n') : text
  return [{ role: 'user', parts: [textPart(joined ?? '')] }]
}

const extractText = (payload: any): string => {
  try {
    const parts = payload?.candidates?.[0]?.content?.parts || payload?.response?.candidates?.[0]?.content?.parts
    if (!Array.isArray(parts)) return ''
    return parts.map((p: any) => p?.text || '').join('')
  }
  catch {
    return ''
  }
}

const cleanModel = (modelId?: string, fallback?: string) => {
  const candidate = (modelId || '').trim()
  if (!candidate) return fallback
  if (candidate.startsWith('@cf/')) return fallback
  return candidate
}

async function resolveProjectId(): Promise<string> {
  if (cachedProject) return cachedProject
  const env =
    process.env.GCP_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GEMINI_PROJECT ||
    process.env.VERTEX_PROJECT_ID
  if (env) {
    cachedProject = env
    return env
  }
  const auth = new GoogleAuth({ scopes: [TEXT_SCOPE] })
  const project = await auth.getProjectId()
  if (!project) throw new Error('Unable to determine Google Cloud project. Set GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT.')
  cachedProject = project
  return project
}

function resolveLocation(): string {
  return (
    process.env.GCP_LOCATION ||
    process.env.GCLOUD_REGION ||
    process.env.GOOGLE_CLOUD_REGION ||
    process.env.GEMINI_LOCATION ||
    process.env.VERTEX_LOCATION ||
    'us-central1'
  )
}

async function getAuthClient() {
  if (!cachedAuthClient) {
    const auth = new GoogleAuth({ scopes: [TEXT_SCOPE] })
    cachedAuthClient = auth.getClient()
  }
  return await cachedAuthClient
}

async function vertexRequest(path: string, body: any) {
  const project = await resolveProjectId()
  const location = resolveLocation()
  const client = await getAuthClient()
  const baseUrl = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}`

  const response = await client.request({
    url: `${baseUrl}/${path}`,
    method: 'POST',
    data: body,
  })

  return response.data
}

async function generateContent(modelId: string | undefined, options: RunOptions) {
  const model = cleanModel(modelId, process.env.VERTEX_CHAT_MODEL || process.env.GEMINI_MODEL || DEFAULT_CHAT_MODEL)
  const contents = options.messages ? normalizeMessages(options.messages) : normalizeText(undefined)
  const payload = await vertexRequest(`publishers/google/models/${model}:generateContent`, { contents })
  return { response: extractText(payload) }
}

async function embedContent(modelId: string | undefined, text: string | string[]) {
  const model = cleanModel(modelId, process.env.VERTEX_EMBED_MODEL || process.env.GEMINI_EMBED_MODEL || DEFAULT_EMBED_MODEL)
  const texts = Array.isArray(text) ? text : [text]
  const vectors: number[][] = []

  for (const value of texts) {
    const request = { content: { parts: [textPart(value ?? '')] } }
    const payload = await vertexRequest(`publishers/google/models/${model}:embedContent`, request)
    const embedding =
      payload?.embedding?.values ||
      payload?.embeddings?.[0]?.values ||
      payload?.data?.[0]?.embedding?.values ||
      []
    vectors.push(embedding)
  }

  return { data: vectors }
}

export async function vertexAI() {
  return {
    async run(modelId: string | undefined, options: RunOptions = {}) {
      if (options.messages) {
        const response = await generateContent(modelId, options)
        if (options.stream) {
          async function* streamOnce() {
            yield JSON.stringify({ response: response.response })
          }
          return streamOnce()
        }
        return response
      }
      if (typeof options.text !== 'undefined') {
        return await embedContent(modelId, options.text)
      }
      return { response: '' }
    },
  }
}

export type VertexAIClient = Awaited<ReturnType<typeof vertexAI>>
