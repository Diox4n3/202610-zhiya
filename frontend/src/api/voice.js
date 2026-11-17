import { apiRequest } from './client'

export async function transcribe(blob, { readingSessionId, pageNumber, revision }) {
  const form = new FormData()
  const extension = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm'
  form.append('file', blob, `question.${extension}`)
  form.append('readingSessionId', String(readingSessionId))
  form.append('pageNumber', String(pageNumber))
  form.append('revision', String(revision))
  const result = await apiRequest('/voice/transcriptions', {
    method: 'POST',
    body: form,
  })
  return result.data
}

export async function synthesize({ readingSessionId, pageNumber, revision }) {
  const result = await apiRequest('/voice/syntheses', {
    method: 'POST',
    body: { readingSessionId, pageNumber, revision },
  })
  return result.data
}
