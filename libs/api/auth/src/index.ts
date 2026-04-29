import type {ShipfoxModule} from '@shipfox/node-module';
import {db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import {createJwtAuthMethod} from '#presentation/auth/jwt-auth.js';
import {authE2eRoutes} from '#presentation/e2eRoutes/index.js';
import {authRoutes} from '#presentation/routes/index.js';

export type {User, UserStatus} from '#core/entities/user.js';

export const authModule: ShipfoxModule = {
  name: 'auth',
  database: {db, migrationsPath},
  auth: [createJwtAuthMethod()],
  routes: [authRoutes],
  e2eRoutes: [authE2eRoutes],
};
