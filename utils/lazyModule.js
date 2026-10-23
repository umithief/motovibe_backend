export const lazyRouter = load => {
    let pending;
    return (req,res,next) => {
        pending ||= load().catch(error=>{pending=undefined;throw error;});
        return pending.then(module=>module.default(req,res,next)).catch(next);
    };
};
export const lazyHandler = (load,name) => {
    let pending;
    return (req,res,next) => {
        pending ||= load().catch(error=>{pending=undefined;throw error;});
        return pending.then(module=>module[name](req,res,next)).catch(next);
    };
};
