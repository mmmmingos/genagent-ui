// Small helpers: escaping, a tiny Markdown renderer, and human-friendly numbers and times.
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function kt(n) { if (n == null) return "—"; return n >= 1000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + "k" : String(n); }
export const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function ago(t) {
  if (!t) return "";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// Enough Markdown for agent replies: code blocks, inline code, bold, italics, links, lists, headings, tables as text.
export function md(src) {
  const blocks = [];
  let s = String(src || "").replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code) => { blocks.push(`<pre class="code">${esc(code.replace(/\n$/, ""))}</pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  const inline = (t) => esc(t)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1<i>$2</i>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(`<${list.t}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.t}>`); list = null; } };
  for (const line of s.split("\n")) {
    const b = line.match(/^\u0000(\d+)\u0000$/);
    if (b) { flush(); out.push(blocks[+b[1]]); continue; }
    const ul = line.match(/^\s*[-*•]\s+(.*)/), ol = line.match(/^\s*\d+[.)]\s+(.*)/), h = line.match(/^#{1,4}\s+(.*)/);
    if (ul) { if (!list || list.t !== "ul") { flush(); list = { t: "ul", items: [] }; } list.items.push(ul[1]); continue; }
    if (ol) { if (!list || list.t !== "ol") { flush(); list = { t: "ol", items: [] }; } list.items.push(ol[1]); continue; }
    flush();
    if (h) { out.push(`<p class="h">${inline(h[1])}</p>`); continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) { if (!/^\s*\|[\s:-|]+\|\s*$/.test(line)) out.push(`<p class="tbl">${inline(line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).join("  ·  "))}</p>`); continue; }
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return out.join("");
}
