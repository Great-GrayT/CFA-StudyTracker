// Turns a dialogue key + vars + plan data into an actual email: inline-styled,
// table-laid-out HTML plus a plain-text alternative. No DB, no network - pure
// string assembly - but it is not core/ because its whole reason to exist is
// the email-client constraint list in the design doc, not a reusable algorithm.
//
// Every constraint below is load bearing, not a style preference:
//   - inline styles only (Gmail strips <style> in forwarded mail)
//   - tables for layout (Outlook renders through Word's engine: no flex, no grid)
//   - no SVG (Gmail blocks it outright)
//   - every cell gets an explicit background + color (dark mode inverts a
//     transparent one unpredictably)
//   - no image carries anything load-bearing (images are blocked by default)
//   - a plain-text alternative that survives with no layout (spam filters and
//     watches read it, not the HTML)
import type { DialogueKey, DialogueVars, LineContext } from "../core/coach-dialogue";
import { renderDialogue } from "../core/coach-dialogue";
import type { PushPayload } from "./FUNC-push";

export type MailTask = { title: string; minutes: number; done: boolean };

export type MailData = {
  tasks: MailTask[];
  coveragePercent: number;
  daysToExam: number;
  planUrl: string;
  /**
   * One-click unsubscribe link for THIS channel, shown in the footer and also
   * sent as a List-Unsubscribe header. Optional only so the renderer stays
   * usable in tests and previews that do not have a plan id; every real send
   * supplies it, because an email a recipient cannot leave gets reported as
   * spam, and a handful of those cost the sending domain every other email the
   * app sends.
   */
  unsubscribeUrl?: string;
};

const COLORS = {
  bg: "#ffffff",
  text: "#1a1a1a",
  muted: "#5a5a5a",
  accent: "#1452cc",
  barFilled: "#1452cc",
  barEmpty: "#e4e8f0",
  border: "#dddddd",
  buttonBg: "#1452cc",
  buttonText: "#ffffff",
};

/** HTML-escapes an interpolated string. Provider/task titles are third-party
 * or user-entered data; an unescaped "<" or "&" is an injection, not a
 * cosmetic bug, so every piece of dynamic text goes through this. */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clampPercent(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function tdStyle(extra = ""): string {
  return `background:${COLORS.bg};color:${COLORS.text};${extra}`;
}

function progressBarHtml(percent: number): string {
  const filled = clampPercent(percent);
  const empty = 100 - filled;
  // A two-cell table row IS the bar chart: one cell's width is the
  // percentage, with a background colour; the other fills the rest. No
  // image, no script, renders in every client including Outlook.
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
      <tr>
        <td width="${filled}%" style="width:${filled}%;background:${COLORS.barFilled};color:${COLORS.barFilled};height:14px;font-size:1px;line-height:14px;">&nbsp;</td>
        <td width="${empty}%" style="width:${empty}%;background:${COLORS.barEmpty};color:${COLORS.barEmpty};height:14px;font-size:1px;line-height:14px;">&nbsp;</td>
      </tr>
    </table>`;
}

function taskRowHtml(task: MailTask): string {
  const mark = task.done ? "&#10003;" : "&#9675;"; // checkmark or open circle, text glyphs not images
  return `
    <tr>
      <td style="${tdStyle("padding:8px;border-bottom:1px solid " + COLORS.border + ";width:24px;")}">${mark}</td>
      <td style="${tdStyle("padding:8px;border-bottom:1px solid " + COLORS.border + ";")}">${escapeHtml(task.title)}</td>
      <td style="${tdStyle("padding:8px;border-bottom:1px solid " + COLORS.border + ";width:48px;text-align:right;")}">${task.minutes}m</td>
    </tr>`;
}

function tasksTableHtml(tasks: MailTask[]): string {
  if (tasks.length === 0) {
    return `<p style="color:${COLORS.muted};background:${COLORS.bg};">Nothing on today's list.</p>`;
  }
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${COLORS.bg};">
      ${tasks.map(taskRowHtml).join("")}
    </table>`;
}

function buttonHtml(label: string, url: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="background:${COLORS.buttonBg};border-radius:4px;">
          <a href="${escapeHtml(url)}" style="display:block;padding:12px 20px;color:${COLORS.buttonText};background:${COLORS.buttonBg};text-decoration:none;font-weight:bold;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>`;
}

function buildHtml(
  dialogue: { subject: string; opening: string; pressure: string | null; close: string },
  data: MailData,
  coveragePercent: number,
  daysToExam: number,
): string {
  const pressureRow = dialogue.pressure
    ? `<tr><td style="${tdStyle("padding:0 16px 16px;")}">${escapeHtml(dialogue.pressure)}</td></tr>`
    : "";

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${COLORS.bg};">
  <tr>
    <td style="${tdStyle("padding:16px;border-bottom:1px solid " + COLORS.border + ";font-size:13px;color:" + COLORS.muted + ";")}">
      CFA Level II &middot; ${daysToExam} days to exam
    </td>
  </tr>
  <tr>
    <td style="${tdStyle("padding:16px 16px 0;")}">
      <h1 style="margin:0 0 8px;font-size:20px;color:${COLORS.text};background:${COLORS.bg};">${escapeHtml(dialogue.opening)}</h1>
    </td>
  </tr>
  ${pressureRow}
  <tr>
    <td style="${tdStyle("padding:0 16px 16px;")}">
      ${progressBarHtml(coveragePercent)}
      <div style="font-size:12px;color:${COLORS.muted};background:${COLORS.bg};margin-top:4px;">${clampPercent(coveragePercent)}% covered</div>
    </td>
  </tr>
  <tr>
    <td style="${tdStyle("padding:0 16px 8px;font-size:12px;letter-spacing:0.05em;color:" + COLORS.muted + ";")}">TODAY</td>
  </tr>
  <tr>
    <td style="${tdStyle("padding:0 16px 16px;")}">
      ${tasksTableHtml(data.tasks)}
    </td>
  </tr>
  <tr>
    <td style="${tdStyle("padding:0 16px 24px;")}">
      ${buttonHtml(dialogue.close, data.planUrl)}
    </td>
  </tr>
  ${footerHtml(data.unsubscribeUrl)}
</table>`;
}

/**
 * Visible unsubscribe, in the body as well as in the header.
 *
 * The List-Unsubscribe header gives Gmail and Outlook their native control, but
 * plenty of clients show nothing, and a recipient who cannot find a way out
 * uses the spam button instead. That costs the sending domain every other email
 * the app sends, password resets included, so this link is a deliverability
 * measure and not a courtesy.
 */
function footerHtml(unsubscribeUrl?: string): string {
  if (!unsubscribeUrl) return "";
  return `  <tr>
    <td style="${tdStyle(
      "padding:16px;border-top:1px solid " +
        COLORS.border +
        ";font-size:12px;line-height:1.5;color:" +
        COLORS.muted +
        ";",
    )}">
      You are receiving this because you switched the study coach on.
      <a href="${escapeHtml(unsubscribeUrl)}" style="color:${COLORS.muted};text-decoration:underline;">Stop these emails</a>.
      Your plan and your progress stay exactly as they are.
    </td>
  </tr>`;
}

function buildText(
  dialogue: { subject: string; opening: string; pressure: string | null; close: string },
  data: MailData,
  coveragePercent: number,
  daysToExam: number,
): string {
  const lines: string[] = [];
  lines.push(dialogue.opening);
  if (dialogue.pressure) lines.push(dialogue.pressure);
  lines.push("");
  lines.push(`${clampPercent(coveragePercent)}% covered, ${daysToExam} days to exam.`);
  lines.push("");
  lines.push("TODAY");
  if (data.tasks.length === 0) {
    lines.push("Nothing on today's list.");
  } else {
    for (const task of data.tasks) {
      lines.push(`${task.done ? "[x]" : "[ ]"} ${task.title} - ${task.minutes}m`);
    }
  }
  lines.push("");
  lines.push(dialogue.close);
  lines.push(data.planUrl);
  if (data.unsubscribeUrl) {
    // In the plain text as well as the HTML. Spam filters read this part rather
    // than the markup, and a recipient whose client blocks HTML still needs a
    // way out that they can see.
    lines.push("");
    lines.push(`Stop these emails: ${data.unsubscribeUrl}`);
  }
  return lines.join("\n");
}

/**
 * Longest body a notification shows before truncating. Android collapses at
 * roughly this point and iOS a little sooner, so the coach does its own
 * trimming rather than letting a platform cut a sentence mid-clause.
 */
const PUSH_BODY_LIMIT = 180;

const ELLIPSIS = "...";

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;

  // The ellipsis counts toward the limit. Cutting to `limit` and then appending
  // three characters is how the first version of this overshot by three, which
  // is the whole reason the length assertion in the tests is exact.
  const room = limit - ELLIPSIS.length;
  const cut = text.slice(0, room);
  const lastSpace = cut.lastIndexOf(" ");

  // Break on a word where one is reasonably near the end, otherwise take the
  // hard cut: a single very long token should not collapse the body to nothing.
  const body = lastSpace > room * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}${ELLIPSIS}`;
}

/**
 * Renders one dialogue into every channel it will be delivered on.
 *
 * Email and push come out of a SINGLE `renderDialogue` call on purpose. The
 * requirement is that the notification and the email say the same thing, and
 * two separate render calls would not guarantee that: the variant picker
 * rotates by date, so a second call could legitimately choose a different line
 * and the candidate would get a notification that contradicts their inbox.
 * One render, two shapes, no way for them to disagree.
 *
 * What push cannot carry is the layout. Tables, the progress bar and the task
 * list have no equivalent in a notification payload, so push gets the subject,
 * the arithmetic, and a deep link to the day view where the full thing lives.
 */
export function renderCoachMail(
  key: DialogueKey,
  vars: DialogueVars,
  data: MailData,
  localDate?: string,
  context?: LineContext,
  pushTag?: string,
): { subject: string; html: string; text: string; push: PushPayload } {
  // localDate is what rotates the variant. Passing it through is the whole
  // reason the candidate does not read the same joke every day for nine months.
  const dialogue = localDate === undefined
    ? renderDialogue(key, vars)
    : renderDialogue(key, vars, localDate, context);

  // The bar and the numeric caption read off `vars`, not `data`, because
  // the dialogue copy itself was already substituted from `vars` - a reader
  // seeing "62% covered" in the sentence and a different number in the bar
  // right below it would read as a bug, not a nuance.
  const pushBody = [dialogue.opening, dialogue.pressure ?? ""].join(" ").trim();

  return {
    subject: dialogue.subject,
    html: buildHtml(dialogue, data, vars.coveragePercent, vars.daysToExam),
    text: buildText(dialogue, data, vars.coveragePercent, vars.daysToExam),
    push: {
      title: dialogue.subject,
      body: truncate(pushBody, PUSH_BODY_LIMIT),
      url: data.planUrl,
      tag: pushTag,
    },
  };
}
