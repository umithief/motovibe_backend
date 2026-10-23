import redis from '../../config/redis.js';
export const createSummaryCache = ({client=redis,ttlMs=30000,now=Date.now,maxEntries=32}={}) => {
    const local=new Map();const pending=new Map();
    return {
        async get(key,load) {
            const entry=local.get(key);
            if (entry && entry.expires>now()) return entry.data;
            if (pending.has(key)) return pending.get(key);
            const operation=(async()=>{
                let cached;
                try { const raw=await client.get(key); if(raw) {const entry=JSON.parse(raw);if(entry.expires>now())cached=entry;} } catch {}
                const data=cached ? cached.data : await load();
                const expires=cached ? cached.expires : now()+ttlMs;
                for(const [key,entry] of local) if(entry.expires<=now()) local.delete(key);
                if(local.size>=maxEntries)local.delete(local.keys().next().value);
                local.set(key,{data,expires});
                if(!cached)try {await client.set(key,JSON.stringify({data,expires}),'EX',Math.ceil(ttlMs/1000));}catch{}
                return data;
            })();
            pending.set(key,operation);
            try{return await operation;}finally{pending.delete(key);}
        },
        clear(){local.clear();}
    };
};
export const publicSummaryCache=createSummaryCache();
