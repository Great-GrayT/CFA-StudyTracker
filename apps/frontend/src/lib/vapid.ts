// Reads the NEXT_PUBLIC_VAPID_PUBLIC_KEY environment variable. This one value
// is genuinely public: it is the public half of the VAPID asymmetric key pair,
// which the browser sends to the push service to prove the app's identity when
// subscribing. It is safe to distribute.

export function getVapidPublicKey(): string | null {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null;
}
