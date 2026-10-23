export const registerUnsupportedChatEvents = socket => {
    socket.on('message_reaction', (payload,ack) => {
        const response={status:'error',data:null,code:'FEATURE_UNSUPPORTED',
            error:{code:'FEATURE_UNSUPPORTED',message:'Mesaj tepkileri bu sürümde desteklenmiyor.'}};
        if(typeof ack==='function')ack(response);
        socket.emit('message_reaction_unsupported',response);
    });
};
