import fs from 'fs';
import path from 'path';

export type BugSeverity = 'Broken' | 'Ugly' | 'Fragile' | 'Security';
export type BugCategory = 'Frontend UI' | 'Backend Engine' | 'State Management' | 'Security';
export type BugStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'VERIFIED';

export interface BugRecord {
  scenarioId: string;
  severity: BugSeverity;
  category: BugCategory;
  route: string;
  component: string;
  failureSignature: string;
  consoleLogs?: string[];
  screenshotPath?: string;
  reproductionCommand: string;
  assignedFixer: 'fixer-frontend' | 'fixer-state' | 'fixer-backend' | 'fixer-security';
  fixRecommendation: string;
  status: BugStatus;
}

const BUGS_FILE = path.resolve(process.cwd(), 'tests/stress/bugs.json');

export function loadBugs(): BugRecord[] {
  try {
    if (fs.existsSync(BUGS_FILE)) {
      const data = fs.readFileSync(BUGS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to load bugs.json', err);
  }
  return [];
}

export function saveBug(bug: BugRecord): void {
  const bugs = loadBugs();
  const existingIdx = bugs.findIndex(b => b.scenarioId === bug.scenarioId);
  if (existingIdx >= 0) {
    bugs[existingIdx] = bug;
  } else {
    bugs.push(bug);
  }
  fs.mkdirSync(path.dirname(BUGS_FILE), { recursive: true });
  fs.writeFileSync(BUGS_FILE, JSON.stringify(bugs, null, 2), 'utf-8');
}

export function updateBugStatus(scenarioId: string, status: BugStatus): void {
  const bugs = loadBugs();
  const bug = bugs.find(b => b.scenarioId === scenarioId);
  if (bug) {
    bug.status = status;
    fs.writeFileSync(BUGS_FILE, JSON.stringify(bugs, null, 2), 'utf-8');
  }
}
