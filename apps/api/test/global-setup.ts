import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

export default function setup() {
  // Fresh, isolated test database with shim + all migrations + seed.
  execSync(`bash ${resolve(__dirname, '../../../scripts/db-local.sh')} reset vlf_test`, { stdio: 'inherit' });
}
