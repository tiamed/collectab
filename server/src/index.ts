import 'dotenv/config';
import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import { auth } from './auth/auth.js';
import { createApp } from './app.js';
import { WsRelayManager } from './server/loro-manager.js';
import { ShadowDocManager } from './server/shadow-doc-manager.js';
import { SyncBatcher } from './server/sync-batcher.js';
import { setSpaceInvalidator } from './server/space-invalidate.js';
import { getPool } from './database/client.js';
import { runMigrations } from './database/migrate.js';
import { getEnv } from './config/env.js';

async function main() {
  await runMigrations();

  const env = getEnv();
  const app = createApp();

  const shadowDocManager = new ShadowDocManager();
  const syncBatcher = new SyncBatcher(shadowDocManager);
  const roomManager = new WsRelayManager(shadowDocManager, syncBatcher);

  setSpaceInvalidator(async (spaceId) => {
    await syncBatcher.flushNow(spaceId);
    shadowDocManager.evict(spaceId);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, flushing pending CRDT order writes…`);
    const force = setTimeout(() => process.exit(1), 5000);
    try {
      await syncBatcher.flushPendingAll();
    } catch (err) {
      console.error('Shutdown flush failed:', err);
    }
    clearTimeout(force);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  setInterval(() => shadowDocManager.cleanStaleRooms(), 60 * 60 * 1000);

  const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
    console.log(`Server running on http://localhost:${info.port}`);
  });

  const wss = new WebSocketServer({ noServer: true });

  async function hasSpaceAccess(userId: string, spaceId: string): Promise<boolean> {
    const pool = getPool();
    const r = await pool.query(
      `SELECT 1 FROM spaces s
       LEFT JOIN space_members sm ON sm.space_id = s.id AND sm.user_id = $2
       WHERE s.id = $1
         AND (s.owner_id = $2 OR sm.user_id = $2
              OR s.org_id IN (SELECT id FROM organizations WHERE owner_id = $2))`,
      [spaceId, userId],
    );
    return r.rows.length > 0;
  }

  (server as any).on('upgrade', (request: any, socket: any, head: any) => {
    void (async () => {
      try {
        const url = new URL(request.url || '', `http://${request.headers.host}`);
        const match = url.pathname.match(/^\/ws\/space\/(.+)$/);
        if (!match) {
          socket.destroy();
          return;
        }

        const spaceId = match[1];
        const token = url.searchParams.get('token');
        if (!token) {
          socket.destroy();
          return;
        }

        const session = await auth.api.getSession({
          headers: new Headers({ Authorization: `Bearer ${token}` }),
        });
        if (!session) {
          socket.destroy();
          return;
        }

        if (!(await hasSpaceAccess(session.user.id, spaceId))) {
          socket.destroy();
          return;
        }

        wss.handleUpgrade(request, socket, head, (ws) => {
          void (async () => {
            roomManager.addClient(spaceId, ws);

            try {
              const snapshot = await roomManager.ensureRoomReady(spaceId);
              if (snapshot) ws.send(snapshot);
            } catch (err) {
              console.error(`Failed to prepare CRDT room ${spaceId}:`, err);
            }

            ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
              const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
              void roomManager.handleUpdate(spaceId, new Uint8Array(buf), ws).catch((err) => {
                console.error(`CRDT update failed for space ${spaceId}:`, err);
              });
            });

            ws.on('close', () => roomManager.removeClient(spaceId, ws));
            ws.on('error', (err) => {
              console.error(`WebSocket error in space ${spaceId}:`, err.message);
              roomManager.removeClient(spaceId, ws);
            });
          })();
        });
      } catch (err) {
        console.error('WebSocket upgrade error:', err);
        socket.destroy();
      }
    })();
  });

  console.log(`WebSocket ready on ws://localhost:${env.PORT}/ws/space/:id`);
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
