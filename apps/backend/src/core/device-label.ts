// A human name for a push device, from its browser's user-agent string.
//
// Only coarse OS and browser, which is all a "which of these is my phone"
// list needs. Order matters: Edge, Samsung Internet and Opera all claim to be
// Chrome, and every Chromium browser claims to be Safari.

const OS: Array<[RegExp, string]> = [
  [/Android/, "Android"],
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/CrOS/, "ChromeOS"],
  [/Windows/, "Windows"],
  [/Macintosh|Mac OS X/, "Mac"],
  [/Linux/, "Linux"],
];

const BROWSER: Array<[RegExp, string]> = [
  [/Edg(A|iOS)?\//, "Edge"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/OPR\//, "Opera"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

export function deviceLabel(userAgent: string | undefined | null): string | null {
  if (!userAgent) return null;
  const os = OS.find(([re]) => re.test(userAgent))?.[1];
  const browser = BROWSER.find(([re]) => re.test(userAgent))?.[1];
  if (!os || !browser) return null;
  return `${os} · ${browser}`;
}
