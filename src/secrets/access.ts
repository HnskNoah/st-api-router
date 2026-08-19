// 密钥状态访问（secret_state）

import { secret_state } from '@sillytavern/scripts/secrets';
import type { SecretEntry } from '../types.js';

export function getSecretEntries(key: string): SecretEntry[] {
    return Array.isArray(secret_state[key]) ? secret_state[key] : [];
}

