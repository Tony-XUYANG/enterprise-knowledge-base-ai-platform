import type { AccessTokenPayload } from '../security/tokens.js';
import type { AppAccessContext } from '../modules/apps/app-access-keys.service.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AccessTokenPayload;
      appAccess?: AppAccessContext;
    }
  }
}

export {};
