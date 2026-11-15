const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { compileDashboard } = require('./compiler');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const LOG_FILE = process.env.LOG_FILE || path.join(__dirname, '../monitoring.log');
const daemonId = `daemon-[heartbeat]-session-${Date.now()}`;

const tools = ['dashboard', 'converter', 'hevc', 'muter', 'spotify', 'trimmer', 'youtube'];

const frontendAgents = {
  dashboard: require('./agents/frontend/dashboard_check'),
  converter: require('./agents/frontend/converter_check'),
  hevc: require('./agents/frontend/hevc_check'),
  inspector: require('./agents/frontend/inspector_check'),
  muter: require('./agents/frontend/muter_check'),
  spotify: require('./agents/frontend/spotify_check'),
  trimmer: require('./agents/frontend/trimmer_check'),
  youtube: require('./agents/frontend/youtube_check'),
};

const backendAgents = {
  dashboard: require('./agents/backend/dashboard_check'),
  converter: require('./agents/backend/converter_check'),
  hevc: require('./agents/backend/hevc_check'),
  inspector: require('./agents/backend/inspector_check'),
  muter: require('./agents/backend/muter_check'),
  spotify: require('./agents/backend/spotify_check'),
  trimmer: require('./agents/backend/trimmer_check'),
  youtube: require('./agents/backend/youtube_check'),
};

function formatLogEntry(toolName, agentType, result) {
  const timestamp = new Date().toISOString();
  
  let errorObj = null;
  if (!result.success) {
    if (result.error && typeof result.error === 'object') {
      errorObj = {
        message: result.error.message || 'Unknown backend error',
        code: result.error.code || 'ERR_UNKNOWN'
      };
    } else {
      errorObj = {
        message: String(result.error || 'Unknown frontend error'),
        code: 'ERR_FRONTEND_FAIL'
      };
    }
  }

  return JSON.stringify({
    timestamp,
    daemonId,
    agentType,
    toolName,
    status: result.success ? 'healthy' : 'unhealthy',
    durationMs: result.durationMs || 0,
    error: errorObj,
    metrics: result.metrics || {}
  });
}

function writeInitialLogs() {
  const initialEntries = [];
  const timestamp = new Date().toISOString();
  for (const tool of tools) {
    for (const agentType of ['frontend', 'backend']) {
      initialEntries.push(JSON.stringify({
        timestamp,
        daemonId,
        agentType,
        toolName: tool,
        status: 'healthy',
        durationMs: 0,
        error: null,
        metrics: { httpStatus: 200 }
      }));
    }
  }
  // Ensure the directory exists
  const logDir = path.dirname(LOG_FILE);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  fs.writeFileSync(LOG_FILE, initialEntries.join('\n') + '\n', 'utf8');
  compileDashboard(LOG_FILE, path.join(__dirname, '../public/status.html'));
}

let activeBrowser = null;
let isRunning = false;

async function runCycle() {
  if (isRunning) return;
  isRunning = true;

  const logsToAppend = [];

  // 1. Run frontend checks
  let browser;
  try {
    try {
      browser = await chromium.launch({ headless: true });
    } catch {
      browser = await chromium.launch({ headless: true, channel: 'chrome' });
    }
    activeBrowser = browser;
    const context = await browser.newContext();
    const page = await context.newPage();

    for (const tool of tools) {
      try {
        const result = await frontendAgents[tool].runCheck(page, BASE_URL);
        logsToAppend.push(formatLogEntry(tool, 'frontend', result));
      } catch (err) {
        logsToAppend.push(formatLogEntry(tool, 'frontend', {
          success: false,
          durationMs: 0,
          error: err.message
        }));
      }
    }
  } catch (err) {
    console.error('Failed to run frontend checks:', err);
    for (const tool of tools) {
      logsToAppend.push(formatLogEntry(tool, 'frontend', {
        success: false,
        durationMs: 0,
        error: `Browser launch failed: ${err.message}`
      }));
    }
  } finally {
    activeBrowser = null;
    if (browser) {
      try {
        await browser.close();
      } catch (err) {
        console.error('Failed to close browser:', err);
      }
    }
  }

  // 2. Run backend checks
  for (const tool of tools) {
    try {
      const result = await backendAgents[tool].runCheck(BASE_URL);
      logsToAppend.push(formatLogEntry(tool, 'backend', result));
    } catch (err) {
      logsToAppend.push(formatLogEntry(tool, 'backend', {
        success: false,
        durationMs: 0,
        error: {
          message: err.message,
          code: 'ERR_RUNNER_EXCEPTION'
        }
      }));
    }
  }

  // 3. Write to log file and compile dashboard
  if (logsToAppend.length > 0) {
    try {
      const logString = logsToAppend.join('\n') + '\n';
      console.log(logString.trim());
      fs.appendFileSync(LOG_FILE, logString, 'utf8');
      if (fs.existsSync(LOG_FILE)) {
        const fileContent = fs.readFileSync(LOG_FILE, 'utf8');
        const lines = fileContent.split('\n').filter(line => line.trim() !== '');
        if (lines.length > 1000) {
          const truncated = lines.slice(-1000);
          fs.writeFileSync(LOG_FILE, truncated.join('\n') + '\n', 'utf8');
        }
      }
      compileDashboard(LOG_FILE, path.join(__dirname, '../public/status.html'));
    } catch (err) {
      console.error('Failed to write logs or compile dashboard:', err);
    }
  }

  isRunning = false;
}

// Startup
writeInitialLogs();
runCycle();

// Interval every 10 seconds
const intervalId = setInterval(runCycle, 10000);

// Shutdown handling
async function shutdown(signal) {
  console.log(`Monitoring runner received ${signal}. Shutting down...`);
  clearInterval(intervalId);
  if (activeBrowser) {
    try {
      await activeBrowser.close();
    } catch (err) {
      console.error('Failed to close browser during shutdown:', err);
    }
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
