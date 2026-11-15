// Import-free on purpose: middleware runs on the edge runtime and must not
// pull in session.ts, which imports next/headers.
// The whole point of the proxy: this cookie is httpOnly, so the bearer token is
// never readable from JavaScript. An XSS on this origin can still *send*
// requests while the page is open, but it cannot exfiltrate a credential that
// keeps working elsewhere afterwards. That difference in blast radius is why
// this costs a hop.
export const SESSION_COOKIE = "cfa_session";
