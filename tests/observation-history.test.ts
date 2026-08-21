import { describe, it, expect } from 'vitest';
import { appendModelObservation, MODEL_OBSERVATION_HISTORY_LIMIT } from '../src/domain/model-health.js';
import { normalizeObservationHistory } from '../src/domain/vendor.js';
import type { ModelObservationRecord } from '../src/types.js';

function makeRecord(overrides?: Partial<ModelObservationRecord>): ModelObservationRecord {
    return {
        occurredAt: 1_000,
        groupId: 'g1',
        vendorId: 'v1',
        entryId: 'e1',
        realModel: 'gpt-4o',
        logicalModelId: 'lm1',
        kind: 'temp',
        message: 'timeout',
        ...overrides,
    };
}

describe('appendModelObservation', () => {
    it('appends a record to an empty history', () => {
        const history = appendModelObservation(undefined, makeRecord());
        expect(history).toHaveLength(1);
        expect(history[0].kind).toBe('temp');
        expect(history[0].message).toBe('timeout');
    });

    it('keeps the newest records when over the limit (sliding window)', () => {
        let history: ModelObservationRecord[] | undefined;
        for (let i = 0; i < MODEL_OBSERVATION_HISTORY_LIMIT + 10; i++) {
            history = appendModelObservation(history, makeRecord({ occurredAt: i, message: `msg-${i}` }));
        }
        expect(history).toHaveLength(MODEL_OBSERVATION_HISTORY_LIMIT);
        expect(history![0].occurredAt).toBe(10);
        expect(history![history!.length - 1].occurredAt).toBe(MODEL_OBSERVATION_HISTORY_LIMIT + 9);
    });

    it('appends in place when a history array is given', () => {
        const source: ModelObservationRecord[] = [makeRecord()];
        const result = appendModelObservation(source, makeRecord({ occurredAt: 2 }));
        expect(result).toBe(source);
        expect(source).toHaveLength(2);
        expect(source[1].occurredAt).toBe(2);
    });

    it('truncates long messages to 500 chars', () => {
        const history = appendModelObservation(undefined, makeRecord({ message: 'x'.repeat(600) }));
        expect(history[0].message).toHaveLength(500);
    });

    it('records empty_response observations as-is', () => {
        const history = appendModelObservation(undefined, makeRecord({ kind: 'empty_response', message: '[EMPTY_RESPONSE]' }));
        expect(history[0].kind).toBe('empty_response');
    });
});

describe('normalizeObservationHistory', () => {
    it('returns [] for non-array input', () => {
        expect(normalizeObservationHistory(undefined)).toEqual([]);
        expect(normalizeObservationHistory('nope')).toEqual([]);
    });

    it('drops records with invalid kind or timestamp', () => {
        const raw = [
            makeRecord(),
            { ...makeRecord(), kind: 'nonsense' },
            { ...makeRecord(), occurredAt: 'bad' },
            { ...makeRecord(), kind: 'empty_response' },
        ];
        const result = normalizeObservationHistory(raw);
        expect(result).toHaveLength(2);
        expect(result.map(r => r.kind)).toEqual(['temp', 'empty_response']);
    });

    it('keeps only the newest 200 records', () => {
        const raw = Array.from({ length: MODEL_OBSERVATION_HISTORY_LIMIT + 5 }, (_, i) => makeRecord({ occurredAt: i }));
        const result = normalizeObservationHistory(raw);
        expect(result).toHaveLength(MODEL_OBSERVATION_HISTORY_LIMIT);
        expect(result[0].occurredAt).toBe(5);
    });

    it('normalizes and truncates text fields', () => {
        const result = normalizeObservationHistory([makeRecord({ realModel: '  Gpt-4O  ', message: 'm'.repeat(600) })]);
        expect(result[0].realModel).toBe('Gpt-4O');
        expect(result[0].message).toHaveLength(500);
    });
});
