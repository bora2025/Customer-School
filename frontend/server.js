const { execSync } = require('child_process');
const port = process.env.PORT || 3000;
const host = process.env.HOSTNAME || '0.0.0.0';

// Bind explicitly so the gateway service can reach web over Railway private networking.
execSync(`npx next start -H ${host} -p ${port}`, { stdio: 'inherit' });
