import { api, usingMocks } from '../api';
import { createHttpAccountsApi, createMockAccountsApi } from './api';
import { createAccountsDemo } from './fixtures';

export { AccountsApp } from './AccountsApp';
// Same switch as the shared API: mocks in development unless disabled, real HTTP otherwise.
export const accountsApi = usingMocks
  ? createMockAccountsApi(createAccountsDemo())
  : createHttpAccountsApi(api, import.meta.env.VITE_API_BASE_URL || '/api');
