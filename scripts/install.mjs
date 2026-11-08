// One-time setup: write the launcher, make an icon, and put "GenAgent UI" on the desktop.
// Run: npm run setup
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;

// 1. Launcher: starts the server hidden (or reuses a running one) and opens the app window.
const vbs = `' GenAgent UI launcher (written by scripts/install.mjs)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "${ROOT}"
sh.Run """${node}"" ""${path.join(ROOT, "server", "index.js")}"" --open", 0, False
`;
fs.writeFileSync(path.join(ROOT, "GenAgent UI.vbs"), vbs);

// 2. Icon: render the SVG to PNG with the system browser, then wrap it in an .ico.
const ico = path.join(ROOT, "web", "icon.ico");
const browsers = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter((b) => fs.existsSync(b));
if (browsers.length) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "genui-ico-"));
  const html = path.join(tmp, "i.html");
  fs.writeFileSync(html, `<html><body style="margin:0;background:transparent">${fs.readFileSync(path.join(ROOT, "web", "icon.svg"), "utf8").replace("<svg ", '<svg width="256" height="256" ')}</body></html>`);
  const png = path.join(tmp, "i.png");
  try {
    execFileSync(browsers[0], ["--headless=new", "--disable-gpu", "--default-background-color=00000000", "--hide-scrollbars", "--window-size=256,256", `--user-data-dir=${path.join(tmp, "p")}`, `--screenshot=${png}`, "file:///" + html.replace(/\\/g, "/")], { stdio: "ignore", timeout: 60000 });
    const data = fs.readFileSync(png);
    const head = Buffer.alloc(22);
    head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
    head.writeUInt8(0, 6); head.writeUInt8(0, 7); head.writeUInt8(0, 8); head.writeUInt8(0, 9);
    head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12); head.writeUInt32LE(data.length, 14); head.writeUInt32LE(22, 18);
    fs.writeFileSync(ico, Buffer.concat([head, data]));
  } catch (e) { console.log("Icon skipped:", e.message); }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 3. Desktop shortcut.
const ps = `
$d = [Environment]::GetFolderPath('Desktop')
$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'GenAgent UI.lnk'))
$s.TargetPath = "$env:WINDIR\\System32\\wscript.exe"
$s.Arguments = '"${path.join(ROOT, "GenAgent UI.vbs")}"'
$s.WorkingDirectory = '${ROOT}'
${fs.existsSync(ico) ? `$s.IconLocation = '${ico},0'` : ""}
$s.Description = 'GenAgent UI'
$s.Save()
Write-Output (Join-Path $d 'GenAgent UI.lnk')`;
const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8" }).trim();
console.log("Launcher:", path.join(ROOT, "GenAgent UI.vbs"));
console.log("Shortcut:", out);
console.log("Double-click 'GenAgent UI' on your desktop to start.");
