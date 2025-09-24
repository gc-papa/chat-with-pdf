import type { Part, GenerateContentRequest } from '@google-cloud/vertexai'
import { VertexAI } from '@google-cloud/vertexai'
import { GoogleAuth } from 'google-auth-library'

/* ---------- utils ---------- */
const textPart = (s: string): Part => ({ text: s ?? '' })

const normalizeMessagesToContents = (messages: Array<{ role: string; content: any }>) =>
  (messages || []).map(m => {
    const role = m.role === 'assistant' ? 'model' : m.role === 'system' ? 'system' : 'user'
    const parts: Part[] = []
    if (Array.isArray(m.content)) {
      for (const c of m.content) {
        if (typeof c === 'string') parts.push(textPart(c))
        else if (typeof c?.text === 'string') parts.push(textPart(c.text))
        else if (c && typeof (c as any).content === 'string') parts.push(textPart((c as any).content))
      }
    } else if (typeof m.content === 'string') parts.push(textPart(m.content))
    else if (m.content?.text) parts.push(textPart(m.content.text))
    if (parts.length === 0) parts.push(textPart(''))
    return { role, parts }
  })

const normalizeTextToContents = (text: string | string[]) => {
  const joined = Array.isArray(text) ? text.join('\n') : (text ?? '')
  return [{ role: 'user' as const, parts: [textPart(joined)] }]
}

const extractText = (resp: any): string => {
  try { return (resp?.response?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || '').join('') } catch { return '' }
}

const cleanModel = (m?: string) =>
  (m || '').trim()
    .replace(/^models\//, '')
    .replace(/^publishers\/google\/models\//, '')

const isModelParamError = (err: unknown) =>
  String((err as any)?.message || (err as any)).includes('model parameter must be either a Model Garden model ID or a full resource name')

/* ---------- env/project/region ---------- */
async function resolveProjectId(): Promise<string> {
  const env =
    process.env.GCP_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GEMINI_PROJECT
  if (env) return env
  const pid = await new GoogleAuth().getProjectId()
  if (!pid) throw new Error('GCP project id missing. Set GCP_PROJECT_ID or run: gcloud config set project <id>')
  return pid
}

function resolveLocation(): string {
  return (
    process.env.GCP_LOCATION ||
    process.env.GCLOUD_REGION ||
    process.env.GOOGLE_CLOUD_REGION ||
    process.env.GEMINI_LOCATION ||
    'europe-west6'
  )
}

/* ---------- adapter ---------- */
export async function createGeminiAdapter() {
  const project = await resolveProjectId()
  const location = resolveLocation()
  const defaultModel = cleanModel(process.env.GEMINI_MODEL) || 'gemini-1.5-flash-002'
  const vertex = new VertexAI({ project, location })

  async function generateWithBestModel(request: GenerateContentRequest, modelOrId?: string) {
    const id = cleanModel(modelOrId) || defaultModel

    // Try valid forms in a safe order for mixed SDKs:
    const candidates = [
      `publishers/google/models/${id}`,                                             // Model Garden ID
      `projects/${project}/locations/${location}/publishers/google/models/${id}`,   // Full resource
      id,                                                                           // Bare ID
    ]

    let lastErr: any
    for (const name of candidates) {
      try {
        const model = vertex.getGenerativeModel({ model: name })
        const resp = await model.generateContent(request)
        return resp
      } catch (e) {
        lastErr = e
        if (isModelParamError(e)) continue
        throw e // other errors (permissions, quota) should not be masked
      }
    }
    throw lastErr
  }

  return {
    async run(modelOrId: string, opts: { messages?: any[]; text?: string | string[] }) {
      let request: GenerateContentRequest
      if (opts?.messages) request = { contents: normalizeMessagesToContents(opts.messages) }
      else if (typeof opts?.text !== 'undefined') request = { contents: normalizeTextToContents(opts.text as any) }
      else request = { contents: [{ role: 'user', parts: [textPart('')] }] }

      const resp = await generateWithBestModel(request, modelOrId)
      return { response: extractText(resp) }
    },
  }
}

export default createGeminiAdapter
