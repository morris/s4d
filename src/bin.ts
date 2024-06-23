#!/usr/bin/env node

import { DevServer } from './DevServer.js';

DevServer.cli(process.argv.slice(2))
  .then((exitCode) => {
    if (typeof exitCode === 'number') {
      process.exit(exitCode);
    }
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
