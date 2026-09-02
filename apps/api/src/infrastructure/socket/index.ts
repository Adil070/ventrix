import { Server as SocketServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { logger } from '../logger';
import { prisma } from '../database';

interface SocketUser {
  userId: string;
  organizationId: string;
  role: string;
}

const connectedUsers = new Map<string, Set<string>>(); // userId -> Set<socketId>

export function setupSocketHandlers(io: SocketServer): void {
  // Authentication middleware
  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const payload = jwt.verify(token, config.JWT_SECRET) as any;
      socket.data.user = payload as SocketUser;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as SocketUser;
    logger.debug({ userId: user.userId, socketId: socket.id }, 'Socket connected');

    // Track connected users
    if (!connectedUsers.has(user.userId)) {
      connectedUsers.set(user.userId, new Set());
    }
    connectedUsers.get(user.userId)!.add(socket.id);

    // Join organization room for broadcasts
    socket.join(`org:${user.organizationId}`);
    socket.join(`user:${user.userId}`);

    // Handle real-time events
    socket.on('join:room', (room: string) => {
      socket.join(room);
    });

    socket.on('leave:room', (room: string) => {
      socket.leave(room);
    });

    // Low stock alert subscription
    socket.on('subscribe:stock-alerts', () => {
      socket.join(`stock-alerts:${user.organizationId}`);
    });

    // Invoice updates
    socket.on('subscribe:invoices', () => {
      socket.join(`invoices:${user.organizationId}`);
    });

    socket.on('disconnect', () => {
      const sockets = connectedUsers.get(user.userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          connectedUsers.delete(user.userId);
        }
      }
      logger.debug({ userId: user.userId, socketId: socket.id }, 'Socket disconnected');
    });
  });
}

// Emit helpers (call from services)
export class SocketEmitter {
  constructor(private readonly io: SocketServer) {}

  toOrganization(organizationId: string, event: string, data: unknown): void {
    this.io.to(`org:${organizationId}`).emit(event, data);
  }

  toUser(userId: string, event: string, data: unknown): void {
    this.io.to(`user:${userId}`).emit(event, data);
  }

  // Domain events
  emitInvoiceCreated(organizationId: string, invoice: unknown): void {
    this.toOrganization(organizationId, 'invoice:created', invoice);
  }

  emitInvoicePaid(organizationId: string, invoice: unknown): void {
    this.toOrganization(organizationId, 'invoice:paid', invoice);
  }

  emitLowStockAlert(organizationId: string, alert: unknown): void {
    this.io.to(`stock-alerts:${organizationId}`).emit('stock:low', alert);
  }

  emitNotification(userId: string, notification: unknown): void {
    this.toUser(userId, 'notification:new', notification);
  }

  emitDashboardUpdate(organizationId: string, data: unknown): void {
    this.toOrganization(organizationId, 'dashboard:update', data);
  }
}
