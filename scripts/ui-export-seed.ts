import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seedDatabase } from '../src/services/storageService';

const out = path.join(os.homedir(), '.cursor/skills/ui-explore/fixtures/seed-db.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(seedDatabase(), null, 2));
console.log('Wrote', out);
