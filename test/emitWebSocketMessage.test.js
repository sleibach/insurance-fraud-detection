'use strict';

const cds = require('@sap/cds');
const emitWebSocketMessage = require('../srv/code/utils/emitWebSocketMessage').default;

describe('emitWebSocketMessage', () => {
  let originalConnect;
  let emitted;

  beforeEach(() => {
    emitted = [];
    originalConnect = cds.connect.to;
    cds.connect.to = jest.fn(async () => ({
      emit: jest.fn(async (event, data) => { emitted.push({ event, data }); })
    }));
  });

  afterEach(() => { cds.connect.to = originalConnect; });

  test('emits a RaiseSideEffect message with encoded source', async () => {
    await emitWebSocketMessage({
      eventName: 'ClaimChanged',
      keys: { ID: 'abc 123' },
      sideEffectSource: '/Claims(abc 123)'
    });
    expect(emitted.length).toBe(1);
    expect(emitted[0].event).toBe('ClaimChanged');
    expect(emitted[0].data.serverAction).toBe('RaiseSideEffect');
    expect(emitted[0].data.sideEffectSource).toContain(encodeURIComponent('abc 123'));
  });

  test('swallows errors when required parameters are missing', async () => {
    await expect(emitWebSocketMessage({ eventName: '', keys: null, sideEffectSource: '' }))
      .resolves.toBeUndefined();
    expect(cds.connect.to).not.toHaveBeenCalled();
  });
});
