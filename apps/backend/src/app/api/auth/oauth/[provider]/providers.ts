// Per-provider OAuth endpoints/scopes, shared by the redirect and callback
// routes. Client id/secret are read lazily (only for a provider actually
// matched) so an unknown provider never trips a missing-env-var error on
// its way to a 404.

export interface ProviderConfig {
  authUrl: string;
  tokenUrl: string;
  scope: string;
  clientId: string;
  clientSecret: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}

export function getProviderConfig(provider: string): ProviderConfig | null {
  switch (provider) {
    case "google":
      return {
        authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        scope: "openid email profile",
        clientId: requiredEnv("GOOGLE_CLIENT_ID"),
        clientSecret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      };
    case "github":
      return {
        authUrl: "https://github.com/login/oauth/authorize",
        tokenUrl: "https://github.com/login/oauth/access_token",
        scope: "read:user user:email",
        clientId: requiredEnv("GITHUB_CLIENT_ID"),
        clientSecret: requiredEnv("GITHUB_CLIENT_SECRET"),
      };
    default:
      return null;
  }
}

export function redirectUriFor(provider: string): string {
  return `${requiredEnv("OAUTH_REDIRECT_BASE")}/api/auth/oauth/${provider}/callback`;
}
