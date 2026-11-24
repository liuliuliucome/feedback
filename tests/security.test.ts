import {describe,it,expect} from 'vitest';
import {randomToken,digest,passwordHash,verifyPassword,ownsTicket} from '../worker/security';
describe('credential security',()=>{
 it('generates independent 256-bit tokens and stores digest',async()=>{const a=randomToken(),b=randomToken();expect(a).toHaveLength(64);expect(a).not.toBe(b);expect(await digest(a)).not.toBe(a);});
 it('verifies correct password and rejects incorrect password',async()=>{const hash=await passwordHash('test-password-long');expect(await verifyPassword('test-password-long',hash)).toBe(true);expect(await verifyPassword('wrong-password',hash)).toBe(false);expect(await passwordHash('test-password-long')).not.toBe(hash);});
 it('isolates anonymous identities and permits staff access',()=>{const ticket={installation_id:'a'};expect(ownsTicket(ticket,{kind:'user',id:'a'})).toBe(true);expect(ownsTicket(ticket,{kind:'user',id:'b'})).toBe(false);expect(ownsTicket(ticket,{kind:'staff',id:'s'})).toBe(true);});
});
