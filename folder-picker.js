'use strict';

const { spawn } = require('node:child_process');
let activePicker = null;

function buildFolderPickerScript(initialDirectory) {
  // 单引号加倍后作为 PowerShell 字符串使用，目录中的空格、中文和引号均可保留。
  const initial = String(initialDirectory || '').replace(/'/g, "''");
  return `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$picker = [System.Windows.Forms.FolderBrowserDialog]::new()
$picker.Description = '选择聊天原文的存档文件夹'
$picker.ShowNewFolderButton = $true
$picker.RootFolder = [System.Environment+SpecialFolder]::MyComputer
if ([System.IO.Directory]::Exists('${initial}')) { $picker.SelectedPath = '${initial}' }
# 透明的置顶宿主让选择窗口显示在应用前方，PowerShell 控制台保持隐藏。
$owner = [System.Windows.Forms.Form]::new()
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
try {
  $owner.Show()
  if ($picker.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Write($picker.SelectedPath)
  }
} finally {
  $picker.Dispose()
  $owner.Close()
  $owner.Dispose()
}
`;
}

function chooseFolder(initialDirectory) {
  if (process.platform !== 'win32') return Promise.reject(new Error('当前系统请直接输入存档目录'));
  if (activePicker) return Promise.reject(new Error('文件夹选择窗口已经打开，请先完成或取消选择'));
  return new Promise((resolve, reject) => {
    const script = Buffer.from(buildFolderPickerScript(initialDirectory), 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    activePicker = child;
    const chunks = [];
    let finished = false;
    const timer = setTimeout(() => { finish(new Error('选择文件夹超时，请重新选择或直接输入目录')); child.kill(); }, 5 * 60 * 1000);
    timer.unref();
    function finish(error, directory) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (activePicker === child) activePicker = null;
      if (error) reject(error); else resolve(directory || null);
    }
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.resume();
    child.on('error', () => finish(new Error('无法打开文件夹选择窗口，可以直接输入目录')));
    child.on('close', code => {
      if (code !== 0) finish(new Error('文件夹选择窗口已关闭，可以重新选择或直接输入目录'));
      else finish(null, Buffer.concat(chunks).toString('utf8').trim());
    });
  });
}

function closeFolderPicker() { activePicker?.kill(); }
module.exports = { buildFolderPickerScript, chooseFolder, closeFolderPicker };
