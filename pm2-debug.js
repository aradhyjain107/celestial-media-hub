const { execSync } = require('child_process');
const path = require('path');

const projectRoot = __dirname;
const configPath = path.join(projectRoot, 'ecosystem.config.js');

console.log('projectRoot:', projectRoot);
console.log('configPath:', configPath);

try {
  console.log('Cleaning up existing PM2 if any...');
  try {
    execSync('npx pm2 delete monitoring-runner', { cwd: projectRoot, stdio: 'inherit' });
  } catch (e) {
    console.log('No monitoring-runner to delete.');
  }

  console.log('\n--- Starting PM2 ---');
  const startOut = execSync(`npx pm2 start ${configPath}`, { cwd: projectRoot, encoding: 'utf8' });
  console.log('startOut:', startOut);

  console.log('\n--- Running pm2 jlist ---');
  const jlistOut = execSync('npx pm2 jlist', { cwd: projectRoot, encoding: 'utf8' });
  const list = JSON.parse(jlistOut);
  console.log('Parsed jlist length:', list.length);
  const runner = list.find((app) => app.name === 'monitoring-runner');
  if (runner) {
    console.log('Found monitoring-runner in jlist! Status:', runner.pm2_env.status);
  } else {
    console.log('monitoring-runner NOT found in jlist! Apps present:', list.map(app => app.name));
  }

  console.log('\n--- Running pm2 status ---');
  const statusOut = execSync('npx pm2 status', { cwd: projectRoot, encoding: 'utf8' });
  console.log('statusOut:', statusOut);

} catch (error) {
  console.error('Error occurred:', error);
}
