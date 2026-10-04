import fs from 'node:fs';

const required = (name) => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} ortam degiskeni zorunludur.`);
    return value;
};

export const getSshConfig = () => {
    const privateKeyPath = process.env.DEPLOY_PRIVATE_KEY_PATH?.trim();
    const password = process.env.DEPLOY_PASSWORD?.trim();
    if (!privateKeyPath && !password) {
        throw new Error('DEPLOY_PRIVATE_KEY_PATH veya DEPLOY_PASSWORD zorunludur.');
    }

    return {
        host: required('DEPLOY_HOST'),
        port: Number.parseInt(process.env.DEPLOY_PORT || '22', 10),
        username: required('DEPLOY_USERNAME'),
        ...(privateKeyPath
            ? { privateKey: fs.readFileSync(privateKeyPath) }
            : { password }),
    };
};
