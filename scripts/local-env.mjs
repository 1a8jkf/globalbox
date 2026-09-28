import {existsSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
if(existsSync('.env.local')){console.log('Existing .env.local retained.');process.exit(0);}
const postgres=randomBytes(24).toString('hex'),redis=randomBytes(24).toString('hex');
writeFileSync('.env.local',`DATABASE_URL=postgresql://globalterritory:${postgres}@127.0.0.1:55432/globalterritory?schema=public\nPOSTGRES_USER=globalterritory\nPOSTGRES_PASSWORD=${postgres}\nPOSTGRES_DB=globalterritory\nREDIS_URL=redis://:${redis}@127.0.0.1:56379\nREDIS_PASSWORD=${redis}\nPORT=3001\nTICK_MS=3000\nCOOKIE_SECURE=false\n`,{mode:0o600});console.log('Private local configuration created.');
