const { spawn } = require('child_process');
const http = require('http');

function startServer() {
  console.log('Starting server...');
  const server = spawn('node', ['index.js'], { stdio: 'inherit', shell: true });

  server.on('close', (code) => {
    console.log(`Server exited with code ${code}.`);
    process.exit(code);
  });

  // Ping functionality
  const performPing = () => {
    console.log('Sending keep-alive ping...');
    const url = process.env.BACKEND_URL || 'http://localhost:3005';
    const client = url.startsWith('https') ? require('https') : require('http');
    
    client.get(url, (res) => {
      console.log(`Ping response: ${res.statusCode}`);
    }).on('error', (err) => {
      console.error('Ping failed:', err.message);
    });

    // Schedule next ping randomly between 5 and 10 minutes
    // 5 to 10 minutes in milliseconds
    const minTime = 5 * 60 * 1000;
    const maxTime = 10 * 60 * 1000;
    const nextPing = Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
    
    console.log(`Next ping in ${(nextPing / 60000).toFixed(2)} minutes.`);
    setTimeout(performPing, nextPing);
  };

  // Start ping loop after initial delay (e.g. 1 minute)
  setTimeout(performPing, 60 * 1000);
}

startServer();
