import 'dotenv/config';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import app from './app.js';
import { validateRuntimeEnv } from './config/env.js';
import { connectDatabase } from './config/database.js';
import { initializeFirebase } from './config/firebase.js';
import redis from './config/redis.js';
import { initSync } from './socket.js';
import { stopRadarBroadcastLoop } from './radarSocket.js';
import { initLeaderboardCron } from './modules/leaderboards/service.js';
import { initBusinessFlashExpiryCron } from './modules/business/businessFlashExpiryService.service.js';

export const startServer = async ({connect=connectDatabase,initialize=initializeFirebase,
    connectCache=()=>redis.raw.status==='wait' ? redis.raw.connect().catch(()=>{}) : undefined}={}) => {
    validateRuntimeEnv(); initialize();
    await connect(); await connectCache();
    const server=http.createServer(app);
    let io;const jobs=[];let closing;
    const shutdown=()=>closing ||= (async()=>{
        const deadline=setTimeout(()=>{server.closeAllConnections();process.exitCode=1;},10000);
        deadline.unref();
        try {
            process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
            jobs.forEach(job=>job.stop());stopRadarBroadcastLoop();
            if(io)await new Promise(resolve=>io.close(resolve));
            if(server.listening)await new Promise(resolve=>server.close(resolve));
            redis.raw.disconnect();await mongoose.disconnect();
        } finally {clearTimeout(deadline);}
    })();
    try {
        io=initSync(server);
        jobs.push(...[initLeaderboardCron(),initBusinessFlashExpiryCron()].filter(Boolean));
        const port=Number(process.env.PORT || 5001);
        await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'0.0.0.0',()=>{server.removeListener('error',reject);resolve();});});
        process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
        console.info('Motonom API listening on port',server.address().port);
        return {app,server,io,shutdown};
    } catch(error){await shutdown();throw error;}
};
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
    startServer().catch(error=>{
        console.error('Backend startup failed:',error.message);
        stopRadarBroadcastLoop();redis.raw.disconnect();
        void mongoose.disconnect().finally(()=>{process.exitCode=1;});
    });
}
export default app;
