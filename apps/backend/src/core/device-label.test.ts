import { expect, test } from "vitest";
import { deviceLabel } from "./device-label";

const UA = {
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  samsung:
    "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  macFirefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:132.0) Gecko/20100101 Firefox/132.0",
};

test.each([
  [UA.androidChrome, "Android · Chrome"],
  [UA.samsung, "Android · Samsung Internet"],
  [UA.iphone, "iPhone · Safari"],
  [UA.windowsEdge, "Windows · Edge"],
  [UA.windowsChrome, "Windows · Chrome"],
  [UA.macFirefox, "Mac · Firefox"],
])("labels %s", (ua, label) => {
  expect(deviceLabel(ua)).toBe(label);
});

test("an unknown or missing agent gets no label rather than a wrong one", () => {
  expect(deviceLabel(undefined)).toBeNull();
  expect(deviceLabel("curl/8.0")).toBeNull();
});
