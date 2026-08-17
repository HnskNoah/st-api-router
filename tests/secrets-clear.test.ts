import { describe, expect, it } from 'vitest';
import { clearableQuickApiSecretIds, QUICK_API_SECRET_LABEL_PREFIX } from '../src/domain/secrets.js';

describe('domain/secrets > clearableQuickApiSecretIds', () => {
    it('只返回 quicker-api: 前缀的条目 id', () => {
        const ids = clearableQuickApiSecretIds([
            { id: 'a', label: 'quicker-api:硅基流动' },
            { id: 'b', label: '我的正式 Key' },
            { id: 'c', label: 'Quicker Api · No key' },
        ]);
        expect(ids).toEqual(['a']);
    });

    it('label 前缀大小写敏感，非 quicker-api: 的保留', () => {
        const ids = clearableQuickApiSecretIds([
            { id: 'a', label: 'Quicker-api:xxx' },
            { id: 'b', label: ' quicker-api:yyy' },
        ]);
        expect(ids).toEqual([]);
    });

    it('容忍空 label / 空 id / 空数组', () => {
        expect(clearableQuickApiSecretIds(undefined)).toEqual([]);
        expect(clearableQuickApiSecretIds([{ id: '', label: 'quicker-api:x' }, { id: 'ok', label: '' }])).toEqual([]);
        expect(QUICK_API_SECRET_LABEL_PREFIX).toBe('quicker-api:');
    });
});
