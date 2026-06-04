import 'dotenv/config';
import pkg from '@croo-network/sdk';
const { UserClient, PrivateKeySigner } = pkg;
import { config } from './config.js';
import fs from 'fs';

const signer = new PrivateKeySigner(process.env.WALLET_PRIVATE_KEY);
const client = new UserClient(config, signer);

await client.login();
console.log('✅ Logged in');

const agent = await client.createAgent({
  name: 'VERIS',
  description: 'Trust Infrastructure for the Agent Economy. Audits Web3 projects and AI agents via live CROO orders.',
});
const agentId = agent.agentId;
console.log('✅ Agent created:', agentId);

await client.deployAgent(agentId);
console.log('✅ Agent deployed on-chain');

const service = await client.createService(agentId, {
  name: 'VERIS — Project & Agent Trust Audit',
  description: 'Submit a Web3 project or CROO agent for trust verification. Returns scored report across 5 dimensions with red flags, positive signals, and verdict.',
  price: '2000000',
  paymentToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  slaMinutes: 60,
  orderType: 'one_time',
  requirement: '',
  deliverableType: 'text',
});
console.log('✅ Service created:', service.serviceId);

await client.updateService(service.serviceId, { status: 'active' });
console.log('✅ Service activated');

const keys = await client.listSDKKeys(agentId);
console.log('✅ SDK Key:', keys[0]?.sdkKey);

fs.writeFileSync('veris-credentials.json', JSON.stringify({
  agentId,
  serviceId: service.serviceId,
  sdkKey: keys[0]?.sdkKey,
}, null, 2));

console.log('✅ All done — credentials saved to veris-credentials.json');