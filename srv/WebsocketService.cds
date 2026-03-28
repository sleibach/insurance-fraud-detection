using { fraud as db } from '../db/schema.cds';

@protocol: 'ws'
@path: '/ws/WebSocketService'
@ws.format: 'pcp'
service WebSocketService
{
    @ws.pcp.action: 'ClaimCreated'
    event ClaimCreated : pcpEvent
    {
        ID : db.Claims:ID;
    }

    @ws.pcp.action: 'ClaimChanged'
    event ClaimChanged : pcpEvent
    {
        ID : db.Claims:ID;
    }

    type pcpEvent {
        serverAction : String;
        sideEffectSource : String;
        sideEffectEventName : String;
    }
}
