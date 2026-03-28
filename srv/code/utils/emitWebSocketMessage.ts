import cds from '@sap/cds';

const LOGGER = cds.log('websocket');

interface EmitWebSocketMessageParams {
    eventName: string;
    keys: Record<string, string>;
    sideEffectSource: string;
}

export default async function emitWebSocketMessage({ eventName, keys, sideEffectSource }: EmitWebSocketMessageParams): Promise<void> {
    try {
        if (!eventName || !keys || !sideEffectSource) {
            throw new Error('Missing required parameters');
        }
        let encodedSideEffectSource: string | undefined;
        for (const [, val] of Object.entries(keys)) {
            encodedSideEffectSource = sideEffectSource.replace(val, encodeURIComponent(val));
        }
        const WebSocketService = await cds.connect.to('WebSocketService');
        const msg = {
            event: eventName,
            data: {
                ...keys,
                serverAction: 'RaiseSideEffect',
                sideEffectSource: encodedSideEffectSource,
                sideEffectEventName: eventName
            }
        };
        await WebSocketService.emit(msg.event, msg.data);
        LOGGER.debug('emitted:', msg.event, msg.data);
    } catch (error) {
        LOGGER.error('Error emitting websocket event:', error);
    }
}
