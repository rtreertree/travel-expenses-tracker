import { spawnSync } from 'node:child_process';
if (process.env.DEPLOY_TARGET !== 'production') {
  console.error(
    'Deployment stopped. Configure the Worker DATABASE_URL secret, review migrations, then run DEPLOY_TARGET=production npm run deploy.',
  );
  process.exit(1);
}
console.log('Deployment target: production Worker travel-expenses-tracker');
for (const args of [
  ['run', 'build'],
  ['exec', 'wrangler', '--', 'deploy'],
]) {
  const result = spawnSync('npm', args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
