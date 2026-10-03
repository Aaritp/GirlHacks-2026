import { createHttpApi } from './client';
import { createMockApi } from './mocks';

// Fail closed to real HTTP in production; development starts without credentials.
export const usingMocks = import.meta.env.VITE_USE_MOCKS === 'true'
  || (import.meta.env.DEV && import.meta.env.VITE_USE_MOCKS !== 'false');
export const api = usingMocks ? createMockApi() : createHttpApi(import.meta.env.VITE_API_BASE_URL || '/api');
