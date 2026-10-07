import { spawn } from 'node:child_process';
// Cross-platform alternative to NODE_ENV=development npm start.
const child = spawn(process.execPath, ['--watch', 'src/server.js'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'development' },
});
child.on('error', () => {
  console.error('Não foi possível iniciar o processo de desenvolvimento.');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
