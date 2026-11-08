import { redirect } from "next/navigation";
import { getToken, backendBase } from "@/lib/session";

// The root decides where a visitor belongs: signed out to /login, signed in
// without a plan to /onboarding, otherwise to Today. Doing it server side means
// no authenticated screen ever flashes before a redirect.
export default async function RootPage() {
  const token = await getToken();
  if (!token) redirect("/login");

  const res = await fetch(`${backendBase()}/api/plans`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (res.status === 401) redirect("/login");
  // 404 is the backend's "no active plan", which is onboarding's cue, not an error.
  if (res.status === 404) redirect("/onboarding");
  if (!res.ok) throw new Error(`Could not load the plan (${res.status})`);

  redirect("/today");
}
