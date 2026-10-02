import { UseGuards } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { BusService } from './bus.service';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { authenticateSocket, requireSocketUser } from '../common/socket-auth';
import { getCorsOriginsForGateway } from '../config/environment';
import { SchoolAccessService } from '../marketplace/school-access.service';
import { SchoolAccessWsGuard, disconnectIfSuspended } from '../marketplace/school-access.ws-guard';

@WebSocketGateway({ namespace: '/bus', cors: { origin: getCorsOriginsForGateway(), credentials: true } })
// Every message obeys the billing lock, including location-update from a socket opened before it.
@UseGuards(SchoolAccessWsGuard)
export class BusGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(private busService: BusService, private readonly jwt: JwtService, private readonly schoolAccess: SchoolAccessService) {}

  async handleConnection(client: Socket) {
    try {
      await authenticateSocket(this.jwt, client);
    } catch {
      client.disconnect(true);
      return;
    }
    if (await disconnectIfSuspended(this.schoolAccess, client)) return;
    console.log(`Bus WS client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Bus WS client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe-to-bus')
  handleSubscribe(@MessageBody() data: { busId: string }, @ConnectedSocket() client: Socket) {
    requireSocketUser(client);
    client.join(`bus:${data.busId}`);
    return { event: 'subscribed', data: { busId: data.busId } };
  }

  @SubscribeMessage('location-update')
  async handleLocationUpdate(
    @MessageBody() data: { busId: string; latitude: number; longitude: number; speed?: number; heading?: number },
    @ConnectedSocket() client: Socket,
  ) {
    const user = requireSocketUser(client);
    if (!['SUPER_ADMIN', 'SCHOOL_ADMIN', 'ADMIN', 'WATTAMAN'].includes(user.role)) {
      throw new WsException('Not authorized to update bus location');
    }
    const location = await this.busService.recordLocation(data.busId, {
      latitude: data.latitude,
      longitude: data.longitude,
      speed: data.speed,
      heading: data.heading,
    });
    // Broadcast to all clients subscribed to this bus
    this.server.to(`bus:${data.busId}`).emit('bus-location', {
      busId: data.busId,
      latitude: data.latitude,
      longitude: data.longitude,
      speed: data.speed,
      heading: data.heading,
      timestamp: location.timestamp,
    });
    return { event: 'location-updated', data: location };
  }
}
