import { UPLOAD_TIMEOUT_MS } from '@/constants/config';
import { ensureFreshAccessToken, buildUrl } from './client';
import { getSessionBridge } from './bridge';
import { ApiError, kindForStatus, messageFromBody } from './errors';

/** A picked file (from expo-image-picker or expo-document-picker), enough to build a FormData part. */
export interface PickedFile {
  uri: string;
  name: string;
  /** MIME type; falls back to a generic binary type when the picker doesn't provide one. */
  type?: string;
}

/**
 * Uploads a file as multipart/form-data and returns the parsed JSON response. Separate from
 * apiRequest() in client.ts, which always JSON-serializes the body and sets
 * Content-Type: application/json - a FormData body needs fetch to set its own
 * Content-Type (with the multipart boundary), and uploads need a longer timeout than a
 * normal API call.
 */
export async function uploadFile<T = unknown>(
  path: string,
  file: PickedFile,
  fields: Record<string, string> = {},
  fieldName = 'file',
): Promise<T> {
  await ensureFreshAccessToken();

  const form = new FormData();
  // React Native's fetch/FormData accepts this {uri, name, type} shape in place of a
  // real File/Blob - it streams the file from disk rather than reading it into JS memory.
  form.append(fieldName, { uri: file.uri, name: file.name, type: file.type || 'application/octet-stream' } as unknown as Blob);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, UPLOAD_TIMEOUT_MS);

  try {
    const token = getSessionBridge().getAccessToken();
    const response = await fetch(buildUrl(path), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: form,
      credentials: 'omit',
      signal: controller.signal,
    });

    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: text.slice(0, 200) };
      }
    }

    if (response.status < 200 || response.status >= 300) {
      const { message, details } = messageFromBody(body, `Upload failed (${response.status})`);
      throw new ApiError({ kind: kindForStatus(response.status), message, status: response.status, details, body });
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) throw new ApiError({ kind: 'timeout', message: 'Upload timed out' });
    throw new ApiError({ kind: 'network', message: error instanceof Error ? error.message : 'Upload failed' });
  } finally {
    clearTimeout(timer);
  }
}
