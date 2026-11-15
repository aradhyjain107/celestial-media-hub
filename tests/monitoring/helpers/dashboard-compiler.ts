import fs from 'fs';
import path from 'path';
import { parseLogContent, LogEntry } from './log-parser';

export function compileDashboard(logFilePath: string, outputHtmlPath: string): void {
  let logEntries: LogEntry[] = [];
  if (fs.existsSync(logFilePath)) {
    const content = fs.readFileSync(logFilePath, 'utf8');
    logEntries = parseLogContent(content);
  }

  // Define the 8 tools
  const tools = ['dashboard', 'converter', 'hevc', 'inspector', 'muter', 'spotify', 'trimmer', 'youtube'] as const;
  
  // Find the latest status for each tool and agentType
  const statusMap: Record<string, { frontend: { status: string; error: string | null }; backend: { status: string; error: string | null } }> = {};
  
  for (const tool of tools) {
    statusMap[tool] = {
      frontend: { status: 'healthy', error: null },
      backend: { status: 'healthy', error: null }
    };
  }

  // Iterate chronologically so later logs overwrite earlier ones
  for (const entry of logEntries) {
    if (tools.includes(entry.toolName as any)) {
      const toolStatus = statusMap[entry.toolName];
      if (entry.agentType === 'frontend') {
        toolStatus.frontend.status = entry.status;
        toolStatus.frontend.error = entry.error ? entry.error.message : null;
      } else if (entry.agentType === 'backend') {
        toolStatus.backend.status = entry.status;
        toolStatus.backend.error = entry.error ? entry.error.message : null;
      }
    }
  }

  // Determine global status
  let isDegraded = false;
  for (const tool of tools) {
    if (statusMap[tool].frontend.status === 'unhealthy' || statusMap[tool].backend.status === 'unhealthy') {
      isDegraded = true;
      break;
    }
  }

  const globalStatusText = isDegraded ? 'DEGRADED' : 'HEALTHY';
  const globalStatusClass = isDegraded ? 'status-degraded' : 'status-healthy';

  // Build the cards HTML
  let cardsHtml = '';
  for (const tool of tools) {
    const fStatus = statusMap[tool].frontend.status;
    const bStatus = statusMap[tool].backend.status;
    const fError = statusMap[tool].frontend.error;
    const bError = statusMap[tool].backend.error;

    cardsHtml += `
      <div class="tool-status-card" data-tool="${tool}">
        <h2>${tool.toUpperCase()}</h2>
        <div class="agent-status">
          <span>Frontend:</span>
          <span class="status-badge status-${fStatus}" data-tool="${tool}" data-agent="frontend" data-status="${fStatus}">
            ${fStatus.toUpperCase()}
          </span>
          ${fError ? `<div class="error-msg">${fError}</div>` : ''}
        </div>
        <div class="agent-status">
          <span>Backend:</span>
          <span class="status-badge status-${bStatus}" data-tool="${tool}" data-agent="backend" data-status="${bStatus}">
            ${bStatus.toUpperCase()}
          </span>
          ${bError ? `<div class="error-msg">${bError}</div>` : ''}
        </div>
      </div>
    `;
  }

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <title>Celestial Media Hub Monitoring Dashboard</title>
  <style>
    :root {
      color-scheme: dark;
    }
    @media (forced-colors: active) {
      .tool-status-card, .global-status, .status-badge {
        border-color: ButtonBorder !important;
        background: Canvas !important;
        color: CanvasText !important;
      }
    }
    body {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.875rem;
      line-height: 1.5;
      background-color: #0D0D0F;
      color: #f8fafc;
      padding: 2rem;
      max-width: 1000px;
      margin: 0 auto;
    }
    header {
      border-bottom: 2px solid #E8A838;
      padding-bottom: 1rem;
      margin-bottom: 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    h1 {
      color: #E8A838;
      margin: 0;
    }
    .global-status {
      font-size: 1.5rem;
      font-weight: bold;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      border: 1px solid #E8A838;
    }
    .status-healthy {
      background-color: rgba(16, 185, 129, 0.2);
      color: #10B981;
      border-color: #10B981;
    }
    .status-degraded {
      background-color: rgba(239, 68, 68, 0.2);
      color: #EF4444;
      border-color: #EF4444;
    }
    .status-unhealthy {
      background-color: rgba(239, 68, 68, 0.2);
      color: #EF4444;
      border-color: #EF4444;
    }
    #status-cards-container {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1.5rem;
    }
    .tool-status-card {
      background-color: #16161a;
      border: 1px solid #E8A838;
      border-radius: 6px;
      padding: 1.5rem;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    .tool-status-card h2 {
      margin-top: 0;
      color: #E8A838;
      border-bottom: 1px solid #2d2d34;
      padding-bottom: 0.5rem;
    }
    .agent-status {
      margin-top: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .status-badge {
      display: inline-block;
      width: fit-content;
      padding: 0.2rem 0.5rem;
      font-size: 0.8rem;
      font-weight: bold;
      border-radius: 3px;
    }
    .error-msg {
      color: #EF4444;
      font-size: 0.75rem;
      margin-top: 0.25rem;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <header>
    <h1>CELESTIAL MONITORING</h1>
    <div id="global-status-header" class="global-status ${globalStatusClass}">${globalStatusText}</div>
  </header>
  <main>
    <div id="status-cards-container">
      ${cardsHtml}
    </div>
  </main>
  <script>
    // Visibility-aware background polling to update dashboard safely without innerHTML sinks
    (() => {
      const POLL_MS = 2000;
      let timerId = null;
      let activeController = null;

      async function pollStatus() {
        if (document.hidden) return;
        if (activeController) activeController.abort();
        activeController = new AbortController();
        try {
          const res = await fetch(window.location.pathname, {
            signal: activeController.signal,
            priority: 'low',
            cache: 'no-store'
          });
          if (res.ok) {
            const text = await res.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/html');

            const newContainer = doc.getElementById('status-cards-container');
            const oldContainer = document.getElementById('status-cards-container');
            if (newContainer && oldContainer) {
              const imported = Array.from(newContainer.children, (node) => document.importNode(node, true));
              oldContainer.replaceChildren(...imported);
            }

            const newHeader = doc.getElementById('global-status-header');
            const oldHeader = document.getElementById('global-status-header');
            if (newHeader && oldHeader) {
              oldHeader.className = newHeader.className;
              oldHeader.textContent = newHeader.textContent;
            }
          }
        } catch (err) {
          if (err && err.name === 'AbortError') return;
          console.error('Polling update failed:', err);
        }
      }

      function syncPolling() {
        if (document.hidden) {
          if (timerId !== null) {
            clearInterval(timerId);
            timerId = null;
          }
          if (activeController) {
            activeController.abort();
            activeController = null;
          }
        } else if (timerId === null) {
          timerId = setInterval(pollStatus, POLL_MS);
        }
      }

      document.addEventListener('visibilitychange', () => {
        syncPolling();
        if (!document.hidden) pollStatus();
      });
      syncPolling();
    })();
  </script>
</body>
</html>`;

  const dir = path.dirname(outputHtmlPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outputHtmlPath, htmlContent, 'utf8');
}
