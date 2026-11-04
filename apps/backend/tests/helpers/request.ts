/**
 * Build a Request object with JSON body and Content-Type header.
 *
 * @param method HTTP method (GET, POST, PUT, DELETE, PATCH, etc.)
 * @param url Request URL or path
 * @param body Optional request body (will be JSON-stringified)
 * @param headers Optional additional headers
 * @returns Request object
 */
export function jsonRequest(
  method: string,
  url: string,
  body?: unknown,
  headers?: Record<string, string>
): Request {
  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };

  return new Request(url, {
    method,
    headers: requestHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * Parse JSON from a Response object.
 *
 * @param res Response object
 * @returns Parsed JSON response body
 */
export async function readJson(res: Response): Promise<any> {
  return res.json();
}
