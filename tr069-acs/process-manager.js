'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const { MongoClient } = require('genieacs/node_modules/mongodb');

const executable = (name) => path.join(__dirname, 'node_modules', '.bin', name);
const services = [];
let stopping = false;

async function configureAuthentication() {
  const uri = process.env.GENIEACS_MONGODB_CONNECTION_URL;
  const username = process.env.TR069_PILOT_USERNAME;
  const password = process.env.TR069_PILOT_PASSWORD;
  if (!uri || !username || !password) {
    throw new Error('Missing MongoDB or TR-069 pilot authentication settings');
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const value = `AUTH(${JSON.stringify(username)}, ${JSON.stringify(password)})`;
    await client.db().collection('config').updateOne(
      { _id: 'cwmp.auth' },
      { $set: { value } },
      { upsert: true },
    );
    console.log('[acs] CPE authentication configured');
  } finally {
    await client.close();
  }
}

function startService(name) {
  const child = spawn(executable(name), [], {
    env: process.env,
    stdio: 'inherit',
  });
  child.on('exit', (code, signal) => {
    console.error(`[acs] ${name} stopped (code=${code}, signal=${signal || 'none'})`);
    shutdown(code || 1);
  });
  services.push(child);
}

function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of services) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(exitCode), 1500).unref();
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

configureAuthentication()
  .then(() => {
    startService('genieacs-cwmp');
    startService('genieacs-nbi');
  })
  .catch((error) => {
    console.error(`[acs] startup failed: ${error.message}`);
    process.exit(1);
  });
