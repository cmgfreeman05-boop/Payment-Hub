import { loadConfig } from '../config.js';
import { createDatabase } from './index.js';
import { seedCatalog } from './seed.js';

const config = loadConfig(process.env, false);
const connection = await createDatabase(config);
try {
  await connection.migrate();
  await seedCatalog(connection.db);
  console.log('Database migrations and catalog seed completed.');
} finally {
  await connection.close();
}