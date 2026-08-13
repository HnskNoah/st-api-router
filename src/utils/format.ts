// 格式归一化（纯函数）
import { FORMATS } from '../constants.js';
import type { FormatName } from '../types.js';

export function normalizeFormat(value: unknown): FormatName {
    return Object.hasOwn(FORMATS, value as string) ? (value as FormatName) : 'openai';
}
