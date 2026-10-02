import { UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { authenticateSocket, requireSocketUser } from '../common/socket-auth';
import { getCorsOriginsForGateway } from '../config/environment';
import { SchoolAccessService } from '../marketplace/school-access.service';
import { SchoolAccessWsGuard, disconnectIfSuspended } from '../marketplace/school-access.ws-guard';

/** Core-owned socket surface used only for namespaced plugin notifications. */
@WebSocketGateway({
  cors: { origin: getCorsOriginsForGateway(), credentials: true },
})
@UseGuards(SchoolAccessWsGuard)
export class PluginRealtimeGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(private readonly jwt: JwtService, private readonly schoolAccess: SchoolAccessService) {}

  async handleConnection(client: Socket) {
    try {
      await authenticateSocket(this.jwt, client);
    } catch {
      client.disconnect(true);
      return;
    }
    await disconnectIfSuspended(this.schoolAccess, client);
  }

  @SubscribeMessage('plugin:join-user')
  joinUser(@MessageBody() userId: string, @ConnectedSocket() client: Socket) {
    const user = requireSocketUser(client);
    if (userId !== user.userId) throw new WsException('Cannot join another user room');
    client.join(`user-${user.userId}`);
  }
}
